package taskexecutor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/domain/transferjob"
	"github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
)

// TriggerType 触发类型
type TriggerType string

const (
	TriggerSchedule TriggerType = "schedule"
	TriggerManual   TriggerType = "manual"
)

type ExecutionSource string

const (
	SourceScheduledTask ExecutionSource = "scheduled_task"
	SourceBatchTask     ExecutionSource = "batch_task"
)

const QueueJobKind = "task.execute"

type QueuePayload struct {
	DefinitionVersion string          `json:"definition_version"`
	RunID             uuid.UUID       `json:"run_id"`
	TaskID            uuid.UUID       `json:"task_id"`
	Trigger           TriggerType     `json:"trigger"`
	Source            ExecutionSource `json:"source"`
	RetryOfID         *uuid.UUID      `json:"retry_of_id,omitempty"`
	Attempt           int             `json:"attempt"`
}

type ExecutionOutcome struct {
	Status       taskcenter.Status
	SuccessCount int
	FailureCount int
	ErrorMessage string
	StorageError error
}

type executionStatus string

const (
	executionStatusPending  executionStatus = "pending"
	executionStatusRunning  executionStatus = "running"
	executionStatusSuccess  executionStatus = "success"
	executionStatusFailed   executionStatus = "failed"
	executionStatusPartial  executionStatus = "partial"
	executionStatusTimeout  executionStatus = "timeout"
	executionStatusCanceled executionStatus = "canceled"
	executionStatusUnknown  executionStatus = "unknown"
)

// Executor 任务执行引擎
type Executor struct {
	serverService   server.Service
	scriptService   script.Service
	taskRepo        scheduledtask.Repository
	encryptor       *crypto.Encryptor
	hostKeyCallback sshutil.HostKeyPolicy
	transferJobs    transferjob.Service
	taskRuns        taskcenter.Service
	queue           jobqueue.Enqueuer
	maxConcurrency  int
	cancelMu        sync.Mutex
	cancels         map[uuid.UUID]context.CancelFunc
	stopped         bool
	stopOnce        sync.Once
	workWG          sync.WaitGroup
	stoppedDone     chan struct{}
	stopErr         error
}

// NewExecutor 创建执行引擎
func NewExecutor(
	serverService server.Service,
	scriptService script.Service,
	taskRepo scheduledtask.Repository,
	encryptor *crypto.Encryptor,
	maxConcurrency int,
	taskRuns taskcenter.Service,
) *Executor {
	if maxConcurrency <= 0 {
		maxConcurrency = 10
	}
	executor := &Executor{
		serverService:  serverService,
		scriptService:  scriptService,
		taskRepo:       taskRepo,
		encryptor:      encryptor,
		maxConcurrency: maxConcurrency,
		taskRuns:       taskRuns,
		cancels:        make(map[uuid.UUID]context.CancelFunc),
		stoppedDone:    make(chan struct{}),
	}
	return executor
}

// SetHostKeyCallback 设置主机密钥验证回调
func (e *Executor) SetHostKeyPolicy(callback sshutil.HostKeyPolicy) {
	e.hostKeyCallback = callback
}

func (e *Executor) SetTransferJobService(service transferjob.Service) {
	e.transferJobs = service
}

func (e *Executor) SetQueue(queue jobqueue.Enqueuer) {
	e.queue = queue
}

// Execute 执行任务
func (e *Executor) Execute(ctx context.Context, task *scheduledtask.ScheduledTask, trigger TriggerType, source ExecutionSource) ExecutionOutcome {
	return e.execute(ctx, uuid.Nil, task, trigger, source, nil, 1, "parallel")
}

func (e *Executor) ExecuteBatch(ctx context.Context, runID uuid.UUID, task *scheduledtask.ScheduledTask, trigger TriggerType, source ExecutionSource, executionMode string) ExecutionOutcome {
	return e.execute(ctx, runID, task, trigger, source, nil, 1, executionMode)
}

// The queue owns pre-execution rejection atomically with its terminal state.
// After admission, only the executor's observation can settle this task.
func (e *Executor) HandleQueueJob(ctx context.Context, job *jobqueue.Job) error {
	payload, err := scheduledDispatch(job)
	if err != nil {
		return err
	}
	if job.Actor != access.Current(ctx).Actor() || e.taskRuns == nil {
		return access.ErrForbidden
	}
	run, err := e.taskRuns.Get(ctx, payload.RunID)
	if err != nil {
		return err
	}
	if run.Actor != job.Actor || run.DefinitionID == nil || *run.DefinitionID != payload.TaskID || run.DefinitionVersion != payload.DefinitionVersion || run.Attempt != payload.Attempt || (run.SourceType != "scheduled_task" && run.SourceType != "transfer_job") {
		return access.ErrForbidden
	}
	expectedTrigger := taskcenter.TriggerManual
	if payload.Trigger == TriggerSchedule {
		expectedTrigger = taskcenter.TriggerScheduled
	}
	if run.TriggerType != expectedTrigger {
		return access.ErrForbidden
	}
	if run.SourceType == "transfer_job" || run.Status != taskcenter.StatusQueued {
		return nil
	}
	if run.SourceID != payload.TaskID.String() {
		return access.ErrForbidden
	}
	task, err := e.taskRepo.GetByID(payload.TaskID)
	if err != nil {
		return fmt.Errorf("load scheduled task: %w", err)
	}
	if payload.DefinitionVersion != task.Version() {
		return access.ErrResourceChanged
	}
	if payload.Trigger == TriggerSchedule && !task.Enabled {
		if e.queue == nil {
			return errors.New("scheduled task is disabled")
		}
		return e.queue.CancelBySource(ctx, "task_run", payload.RunID.String())
	}
	outcome := e.execute(ctx, payload.RunID, task, payload.Trigger, payload.Source, payload.RetryOfID, payload.Attempt, "parallel")
	return outcome.StorageError
}

func scheduledDispatch(job *jobqueue.Job) (QueuePayload, error) {
	var payload QueuePayload
	if job == nil || job.Kind != QueueJobKind || job.SourceType != "task_run" || !job.Actor.Valid() || job.MaxAttempts != 1 {
		return payload, access.ErrForbidden
	}
	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		return payload, err
	}
	if payload.RunID == uuid.Nil || payload.TaskID == uuid.Nil || payload.Source != SourceScheduledTask || payload.Attempt < 1 || (payload.Trigger != TriggerManual && payload.Trigger != TriggerSchedule) || payload.DefinitionVersion == "" || job.SourceID != payload.RunID.String() || job.DedupeKey == nil || *job.DedupeKey != "task-run:"+payload.RunID.String() {
		return payload, access.ErrForbidden
	}
	return payload, nil
}

func (e *Executor) execute(ctx context.Context, runID uuid.UUID, task *scheduledtask.ScheduledTask, trigger TriggerType, source ExecutionSource, retryOfID *uuid.UUID, attempt int, executionMode string) (outcome ExecutionOutcome) {
	if task == nil || e.taskRuns == nil {
		return ExecutionOutcome{StorageError: errors.New("task execution is unavailable")}
	}
	executionID := runID
	if executionID == uuid.Nil {
		executionID = uuid.New()
	}
	executionCtx, done, err := e.begin(ctx, executionID)
	if err != nil {
		return ExecutionOutcome{StorageError: err}
	}
	defer done()
	var record *taskExecutionRecord
	var expected *taskcenter.TaskRun
	defer func() {
		if recovered := recover(); recovered != nil {
			success, failed := 0, 0
			if record != nil {
				_, success, failed = summarizeServerExecution(record.ServerResults)
			}
			outcome = makeExecutionOutcome(executionStatusUnknown, success, failed, "执行器异常中断，远端效果需核对")
			log.Printf("[TaskExecutor] execution panic: run=%s", executionID)
		}
		if expected == nil || (record != nil && record.SkipTaskCenter) || outcome.Status == "" {
			return
		}
		var results []ServerExecutionResult
		if record != nil {
			results = record.ServerResults
		}
		encoded, encodeErr := json.Marshal(results)
		if encodeErr != nil {
			outcome.StorageError = encodeErr
			return
		}
		finished := time.Now().UTC().Truncate(time.Millisecond)
		if record != nil && record.EndTime != nil {
			finished = record.EndTime.UTC().Truncate(time.Millisecond)
		}
		outcome.StorageError = e.saveResult(ctx, *expected, outcome.Status, string(encoded), outcome.ErrorMessage, outcome.SuccessCount, outcome.FailureCount, finished)
	}()
	scope := access.Current(ctx)
	if source == SourceScheduledTask && (scope.Actor().Kind != protocol.Owner || scope.Actor().ID != task.OwnerID.String()) {
		return makeExecutionOutcome(executionStatusFailed, 0, 0, access.ErrForbidden.Error())
	}
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return makeExecutionOutcome(executionStatusFailed, 0, 0, err.Error())
	}
	log.Printf("[TaskExecutor] 开始执行任务: taskID=%s, type=%s, trigger=%s",
		task.ID, task.TaskType, trigger)

	startTime := time.Now()

	record = &taskExecutionRecord{
		Actor:                 scope.Actor(),
		ID:                    executionID,
		TaskName:              task.TaskName,
		TaskType:              task.TaskType,
		TriggerType:           trigger,
		SourceType:            source,
		SourceID:              task.ID,
		Command:               task.Command,
		Status:                executionStatusRunning,
		TotalServers:          len(task.ServerIDs),
		StartTime:             startTime,
		IsScheduledDefinition: source == SourceScheduledTask,
	}
	if record.IsScheduledDefinition {
		record.ScheduledTaskID = task.ID
	}
	if e.taskRuns != nil && runID == uuid.Nil {
		triggerType := taskcenter.TriggerManual
		if trigger == TriggerSchedule {
			triggerType = taskcenter.TriggerScheduled
		}
		run := &taskcenter.TaskRun{
			ID: executionID, RetryOfID: retryOfID, Attempt: attempt, MaxAttempts: attempt,
			SourceType: string(source), SourceID: task.ID.String(), TaskType: task.TaskType,
			Title: task.TaskName, Description: task.Description, TriggerType: triggerType, Runner: "server",
			Status: taskcenter.StatusQueued, Resource: strings.Join(task.ServerIDs, ","), TotalCount: len(task.ServerIDs), PayloadJSON: task.PayloadJSON,
			Cancelable: !isTransferTask(task.TaskType), Retryable: record.IsScheduledDefinition,
		}
		if record.IsScheduledDefinition {
			definitionID := task.ID
			run.DefinitionID = &definitionID
			run.DefinitionVersion = task.Version()
		}
		if err := e.taskRuns.Create(ctx, run); err != nil {
			log.Printf("[TaskExecutor] 创建任务运行记录失败: runID=%s, error=%v", executionID, err)
			return makeExecutionOutcome(executionStatusFailed, 0, 0, err.Error())
		}
	}
	if e.taskRuns != nil {
		observed, err := e.taskRuns.Get(ctx, executionID)
		if err != nil {
			return ExecutionOutcome{StorageError: err}
		}
		if observed.Actor != scope.Actor() || observed.SourceType != string(source) || observed.SourceID != task.ID.String() || observed.TaskType != task.TaskType {
			return ExecutionOutcome{StorageError: access.ErrForbidden}
		}
		// A running identity is never an instruction to issue its commands again.
		if observed.Status != taskcenter.StatusQueued {
			return ExecutionOutcome{Status: observed.Status}
		}
		expected = observed
		if err := e.taskRuns.Start(executionCtx, executionID, "executing"); err != nil {
			log.Printf("[TaskExecutor] 启动任务运行记录失败: runID=%s, error=%v", executionID, err)
			return makeExecutionOutcome(executionStatusFailed, 0, 0, err.Error())
		}
		currentRun, err := e.taskRuns.Get(ctx, executionID)
		if err != nil {
			return makeExecutionOutcome(executionStatusFailed, 0, 0, err.Error())
		}
		if currentRun.Status != taskcenter.StatusRunning {
			if currentRun.Status != taskcenter.StatusCanceling || currentRun.StartedAt == nil {
				// No command was issued; retain a concurrent terminal decision.
				expected = nil
				return ExecutionOutcome{Status: currentRun.Status}
			}
			return makeExecutionOutcome(executionStatusCanceled, 0, 0, "任务已取消")
		}
	}

	if source == SourceScheduledTask {
		if err := e.taskRepo.CheckStage(executionCtx, task.ID, task.Version(), task.OwnerID, trigger == TriggerSchedule, ""); err != nil {
			e.completeExecution(record, executionStatusFailed, err.Error(), 0, 0, nil)
			return makeExecutionOutcome(executionStatusFailed, 0, 0, err.Error())
		}
	}
	if isTransferTask(task.TaskType) {
		return e.executeTransferTask(executionCtx, task, record)
	}

	// 根据任务类型获取要执行的命令
	command, scriptVersion, err := e.resolveCommand(executionCtx, task)
	if err != nil {
		log.Printf("[TaskExecutor] 解析命令失败: %v", err)
		status := executionStatusFailed
		if errors.Is(executionCtx.Err(), context.Canceled) {
			status = executionStatusCanceled
		}
		e.completeExecution(record, status, err.Error(), 0, 0, nil)
		return makeExecutionOutcome(status, 0, 0, err.Error())
	}
	requirements := make([]access.Requirement, 0, len(task.ServerIDs))
	for _, id := range task.ServerIDs {
		req := access.Requirement{Action: protocol.TerminalConnect, ServerID: id}
		if task.TaskType == "script" && task.ScriptID != nil {
			req.Action = protocol.ScriptsExecute
			req.ScriptID = task.ScriptID.String()
			req.ScriptVersion = scriptVersion
		}
		requirements = append(requirements, req)
	}
	lease, err := scope.OpenWork(executionCtx, access.Task, requirements...)
	if err != nil {
		e.completeExecution(record, executionStatusFailed, err.Error(), 0, len(task.ServerIDs), nil)
		return makeExecutionOutcome(executionStatusFailed, 0, len(task.ServerIDs), err.Error())
	}
	defer lease.Close(nil)
	executionCtx = lease.Context()
	record.Command = command

	// 并发执行到所有服务器
	results := e.executeOnServers(executionCtx, task, command, scriptVersion, executionMode, source, trigger, func(observed []ServerExecutionResult) error {
		// Keep the latest observation for final settlement even if a checkpoint
		// cannot be stored. This callback is serialized by executeOnServers.
		record.ServerResults = append(record.ServerResults[:0], observed...)
		return e.saveTargets(ctx, *expected, observed)
	})

	finalStatus, successCount, failedCount := summarizeServerExecution(results)

	// 完成执行记录
	e.completeExecution(record, finalStatus, "", successCount, failedCount, results)

	log.Printf("[TaskExecutor] 任务执行完成: taskID=%s, status=%s, success=%d, failed=%d",
		task.ID, finalStatus, successCount, failedCount)
	return makeExecutionOutcome(finalStatus, successCount, failedCount, "")
}

func (e *Executor) CancelTask(ctx context.Context, id uuid.UUID) error {
	if e.queue != nil {
		if err := e.queue.CancelBySource(ctx, "task_run", id.String()); err != nil {
			return fmt.Errorf("cancel queued task: %w", err)
		}
	}
	e.cancelMu.Lock()
	cancel := e.cancels[id]
	e.cancelMu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func isTransferTask(taskType string) bool {
	return taskType == string(transferjob.JobKindSFTPUpload) || taskType == string(transferjob.JobKindSFTPDownload)
}

func (e *Executor) executeTransferTask(ctx context.Context, task *scheduledtask.ScheduledTask, record *taskExecutionRecord) ExecutionOutcome {
	if e.transferJobs == nil {
		err := "transfer job service is not initialized"
		e.completeExecution(record, executionStatusFailed, err, 0, 1, nil)
		return makeExecutionOutcome(executionStatusFailed, 0, 1, err)
	}

	job, err := e.transferJobs.RunScheduledTask(ctx, transferjob.RunScheduledRequest{
		ScheduledTaskID: task.ID,
		TaskName:        task.TaskName,
		TaskType:        task.TaskType,
		PayloadJSON:     task.PayloadJSON,
		TaskRunID:       record.ID,
	})
	if job != nil {
		// Admission already owns a stable transfer identity, even if its
		// source/queue transaction is awaiting a receipt. Preparation must not
		// complete the TaskRun while that handoff is being retried.
		record.SkipTaskCenter = true
	}
	if err != nil {
		if job != nil {
			return ExecutionOutcome{StorageError: err}
		}
		log.Printf("[TaskExecutor] 触发传输任务失败: taskID=%s, error=%v", task.ID, err)
		e.completeExecution(record, executionStatusFailed, err.Error(), 0, 1, nil)
		return makeExecutionOutcome(executionStatusFailed, 0, 1, err.Error())
	}

	record.TransferJobID = job.ID
	record.SkipTaskCenter = true
	record.Command = fmt.Sprintf("transfer_job:%s", job.ID)
	switch job.Status {
	case transferjob.JobStatusFailed:
		return makeExecutionOutcome(executionStatusFailed, 0, 1, job.ErrorMessage)
	case transferjob.JobStatusCancelled:
		return makeExecutionOutcome(executionStatusCanceled, 0, 0, job.ErrorMessage)
	case transferjob.JobStatusUnknown:
		return makeExecutionOutcome(executionStatusUnknown, 0, 0, job.ErrorMessage)
	}
	record.TotalServers = 1
	var serverID uuid.UUID
	if job.TargetServerID != nil {
		serverID = *job.TargetServerID
	} else if job.SourceServerID != nil {
		serverID = *job.SourceServerID
	}
	result := ServerExecutionResult{
		ServerID:  serverID,
		Status:    executionStatusSuccess,
		Output:    fmt.Sprintf("transfer job queued: %s", job.ID),
		StartTime: record.StartTime,
	}
	endTime := time.Now()
	result.EndTime = &endTime
	result.Duration = endTime.Sub(record.StartTime).Milliseconds()
	e.completeExecution(record, executionStatusSuccess, "", 1, 0, []ServerExecutionResult{result})
	log.Printf("[TaskExecutor] 传输任务已触发: taskID=%s, jobID=%s, type=%s",
		task.ID, job.ID, task.TaskType)
	return makeExecutionOutcome(executionStatusSuccess, 1, 0, "")
}

func makeExecutionOutcome(status executionStatus, successCount, failureCount int, errorMessage string) ExecutionOutcome {
	statusMap := map[executionStatus]taskcenter.Status{
		executionStatusSuccess:  taskcenter.StatusSucceeded,
		executionStatusFailed:   taskcenter.StatusFailed,
		executionStatusPartial:  taskcenter.StatusPartialSuccess,
		executionStatusTimeout:  taskcenter.StatusTimeout,
		executionStatusCanceled: taskcenter.StatusCanceled,
		executionStatusUnknown:  taskcenter.StatusUnknown,
	}
	return ExecutionOutcome{
		Status:       statusMap[status],
		SuccessCount: successCount,
		FailureCount: failureCount,
		ErrorMessage: errorMessage,
	}
}

// ServerExecutionResult 服务器执行结果
type ServerExecutionResult struct {
	ServerID     uuid.UUID
	ServerName   string
	ServerHost   string
	Status       executionStatus
	ExitCode     *int
	Output       string
	ErrorMessage string
	StartTime    time.Time
	EndTime      *time.Time
	Duration     int64
}

// resolveCommand 解析要执行的命令
func (e *Executor) resolveCommand(ctx context.Context, task *scheduledtask.ScheduledTask) (string, string, error) {
	switch task.TaskType {
	case "command":
		if task.Command == "" {
			return "", "", fmt.Errorf("command is empty")
		}
		return task.Command, "", nil

	case "script":
		if task.ScriptID == nil {
			return "", "", fmt.Errorf("script_id is required for script type")
		}
		var input script.ExecutionInput
		if task.PayloadJSON != "" {
			if err := json.Unmarshal([]byte(task.PayloadJSON), &input); err != nil {
				return "", "", err
			}
		}
		execution, err := e.scriptService.Resolve(ctx, *task.ScriptID, task.ServerIDs, input.Parameters, input.Version)
		if err != nil {
			return "", "", err
		}
		return execution.Command, execution.Version, nil

	default:
		return "", "", fmt.Errorf("unknown task type: %s", task.TaskType)
	}
}

// executeOnServers 并发执行到多个服务器
func (e *Executor) executeOnServers(
	ctx context.Context,
	task *scheduledtask.ScheduledTask,
	command, scriptVersion string,
	executionMode string,
	source ExecutionSource,
	trigger TriggerType,
	observe func([]ServerExecutionResult) error,
) []ServerExecutionResult {
	serverIDs := task.ServerIDs
	if len(serverIDs) == 0 {
		return nil
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	results := make([]ServerExecutionResult, len(serverIDs))
	var mu sync.Mutex
	storageFailed := false
	store := func(index int, result ServerExecutionResult) {
		mu.Lock()
		defer mu.Unlock()
		results[index] = result
		if result.Status == executionStatusUnknown {
			cancel()
		}
		if storageFailed {
			return
		}
		observed := make([]ServerExecutionResult, 0, len(results))
		for _, target := range results {
			if target.Status != "" {
				observed = append(observed, target)
			}
		}
		if err := observe(observed); err != nil {
			storageFailed = true
			cancel()
		}
	}
	if executionMode == "sequential" {
		for index, serverID := range serverIDs {
			store(index, e.executeOnSingleServer(ctx, task, serverID, command, scriptVersion, source, trigger))
		}
		return results
	}

	// 使用信号量控制并发
	sem := make(chan struct{}, e.maxConcurrency)
	var wg sync.WaitGroup

	for i, serverIDStr := range serverIDs {
		wg.Add(1)
		go func(index int, sidStr string) {
			defer wg.Done()

			// 获取信号量
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				end := time.Now()
				id, _ := uuid.Parse(sidStr)
				store(index, ServerExecutionResult{ServerID: id, Status: executionStatusCanceled, StartTime: end, EndTime: &end, ErrorMessage: ctx.Err().Error()})
				return
			}

			result := e.executeOnSingleServer(ctx, task, sidStr, command, scriptVersion, source, trigger)
			store(index, result)
		}(i, serverIDStr)
	}

	wg.Wait()
	return results
}

// executeOnSingleServer 在单个服务器上执行命令
func (e *Executor) executeOnSingleServer(
	ctx context.Context,
	task *scheduledtask.ScheduledTask,
	serverIDStr string,
	command, scriptVersion string,
	source ExecutionSource,
	trigger TriggerType,
) (result ServerExecutionResult) {
	startTime := time.Now()
	result = ServerExecutionResult{
		StartTime: startTime,
		Status:    executionStatusFailed,
	}
	commandAttempted := false
	defer func() {
		if recovered := recover(); recovered != nil {
			result.Status = executionStatusFailed
			if commandAttempted {
				result.Status = executionStatusUnknown
			}
			result.ErrorMessage = "执行器异常中断，远端效果需核对"
			end := time.Now()
			result.EndTime, result.Duration = &end, end.Sub(startTime).Milliseconds()
		}
		if !commandAttempted && ctx.Err() != nil {
			result.Status = executionStatusCanceled
			result.ErrorMessage = ctx.Err().Error()
		}
	}()
	if err := ctx.Err(); err != nil {
		result.ServerID, _ = uuid.Parse(serverIDStr)
		end := time.Now()
		result.EndTime = &end
		return result
	}

	// 解析服务器ID
	serverID, err := uuid.Parse(serverIDStr)
	if err != nil {
		result.ErrorMessage = fmt.Sprintf("invalid server id: %v", err)
		endTime := time.Now()
		result.EndTime = &endTime
		result.Duration = endTime.Sub(startTime).Milliseconds()
		return result
	}
	result.ServerID = serverID

	req := access.Requirement{Action: protocol.TerminalConnect, ServerID: serverIDStr}
	if task.TaskType == "script" && task.ScriptID != nil {
		req.Action = protocol.ScriptsExecute
		req.ScriptID = task.ScriptID.String()
		req.ScriptVersion = scriptVersion
	}
	if err := access.Current(ctx).Check(ctx, req); err != nil {
		end := time.Now()
		result.EndTime = &end
		result.ErrorMessage = err.Error()
		result.Duration = end.Sub(startTime).Milliseconds()
		return result
	}
	if source == SourceScheduledTask {
		if err := e.taskRepo.CheckStage(ctx, task.ID, task.Version(), task.OwnerID, trigger == TriggerSchedule, serverIDStr); err != nil {
			end := time.Now()
			result.EndTime = &end
			result.Duration = end.Sub(startTime).Milliseconds()
			result.ErrorMessage = err.Error()
			return result
		}
	}
	// 获取服务器信息
	srv, err := e.serverService.GetByID(ctx, access.Current(ctx), serverID)
	if err != nil {
		result.ErrorMessage = fmt.Sprintf("failed to get server: %v", err)
		endTime := time.Now()
		result.EndTime = &endTime
		result.Duration = endTime.Sub(startTime).Milliseconds()
		return result
	}
	result.ServerName = srv.Name
	result.ServerHost = fmt.Sprintf("%s:%d", srv.Host, srv.Port)

	// 创建SSH客户端
	client, err := ssh.NewClient(ctx, srv, e.encryptor, e.hostKeyCallback)
	if err != nil {
		result.ErrorMessage = fmt.Sprintf("failed to create ssh client: %v", err)
		endTime := time.Now()
		result.EndTime = &endTime
		result.Duration = endTime.Sub(startTime).Milliseconds()
		return result
	}
	defer client.Close()

	// 连接服务器
	if err := client.ConnectContext(ctx, srv.Host, srv.Port); err != nil {
		result.ErrorMessage = fmt.Sprintf("failed to connect: %v", err)
		endTime := time.Now()
		result.EndTime = &endTime
		result.Duration = endTime.Sub(startTime).Milliseconds()
		return result
	}

	if task.TaskType == "script" && task.ScriptID != nil {
		var input script.ExecutionInput
		if task.PayloadJSON != "" {
			if err := json.Unmarshal([]byte(task.PayloadJSON), &input); err != nil {
				result.ErrorMessage = err.Error()
				end := time.Now()
				result.EndTime = &end
				return result
			}
		}
		if err := e.scriptService.RecordExecution(ctx, *task.ScriptID, serverIDStr, scriptVersion, input.Parameters); err != nil {
			result.ErrorMessage = err.Error()
			end := time.Now()
			result.EndTime = &end
			return result
		}
	}
	// 执行命令
	commandAttempted = true
	commandResult, err := client.ExecuteCommandDetailedContext(ctx, command)
	endTime := time.Now()
	result.EndTime = &endTime
	result.Duration = endTime.Sub(startTime).Milliseconds()
	if commandResult == nil {
		commandAttempted = false
		if err != nil {
			result.ErrorMessage = err.Error()
		}
		return result
	}
	result.Output, result.ExitCode, result.ErrorMessage = commandResult.Output, commandResult.ExitCode, commandResult.Error
	switch commandResult.Outcome {
	case "succeeded":
		result.Status = executionStatusSuccess
	case "unknown":
		result.Status = executionStatusUnknown
	default:
		result.Status = executionStatusFailed
	}

	return result
}

// completeExecution 完成执行记录
func (e *Executor) completeExecution(
	execution *taskExecutionRecord,
	status executionStatus,
	errorMsg string,
	successCount, failedCount int,
	serverResults []ServerExecutionResult,
) {
	endTime := time.Now()
	duration := endTime.Sub(execution.StartTime).Milliseconds()
	execution.Status = status
	execution.EndTime = &endTime
	execution.Duration = duration
	execution.SuccessCount = successCount
	execution.FailedCount = failedCount
	execution.ErrorMessage = errorMsg
	execution.ServerResults = serverResults

}

type taskExecutionRecord struct {
	Actor                 protocol.Actor
	ID                    uuid.UUID
	ScheduledTaskID       uuid.UUID
	TransferJobID         uuid.UUID
	SourceID              uuid.UUID
	TaskName              string
	TaskType              string
	TriggerType           TriggerType
	SourceType            ExecutionSource
	Command               string
	Status                executionStatus
	TotalServers          int
	SuccessCount          int
	FailedCount           int
	StartTime             time.Time
	EndTime               *time.Time
	Duration              int64
	ErrorMessage          string
	ServerResults         []ServerExecutionResult
	SkipTaskCenter        bool
	IsScheduledDefinition bool
}

// Unknown/canceled targets are not confirmed failures. A late parent cancel
// cannot overwrite a set of already confirmed remote exits.
func summarizeServerExecution(results []ServerExecutionResult) (executionStatus, int, int) {
	success, failed, canceled, unknown := 0, 0, 0, 0
	for _, result := range results {
		switch result.Status {
		case executionStatusSuccess:
			success++
		case executionStatusFailed:
			failed++
		case executionStatusCanceled:
			canceled++
		case executionStatusUnknown:
			unknown++
		}
	}
	switch {
	case unknown > 0:
		return executionStatusUnknown, success, failed
	case canceled > 0:
		return executionStatusCanceled, success, failed
	case success == len(results) && success > 0:
		return executionStatusSuccess, success, failed
	case success > 0:
		return executionStatusPartial, success, failed
	default:
		return executionStatusFailed, success, failed
	}
}
