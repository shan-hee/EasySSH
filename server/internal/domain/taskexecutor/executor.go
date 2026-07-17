package taskexecutor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/domain/transferjob"
	"github.com/easyssh/server/internal/pkg/crypto"
	"github.com/google/uuid"
	gossh "golang.org/x/crypto/ssh"
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
	TaskID    uuid.UUID       `json:"task_id"`
	Trigger   TriggerType     `json:"trigger"`
	Source    ExecutionSource `json:"source"`
	RetryOfID *uuid.UUID      `json:"retry_of_id,omitempty"`
	Attempt   int             `json:"attempt"`
}

type ExecutionOutcome struct {
	Status       taskcenter.Status
	SuccessCount int
	FailureCount int
	ErrorMessage string
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
)

// Executor 任务执行引擎
type Executor struct {
	serverService    server.Service
	scriptService    script.Service
	taskRepo         scheduledtask.Repository
	operationRecords operationrecord.Service
	encryptor        *crypto.Encryptor
	hostKeyCallback  gossh.HostKeyCallback
	transferJobs     transferjob.Service
	taskRuns         taskcenter.Service
	maxConcurrency   int
	cancelMu         sync.Mutex
	cancels          map[uuid.UUID]context.CancelFunc
}

// NewExecutor 创建执行引擎
func NewExecutor(
	serverService server.Service,
	scriptService script.Service,
	taskRepo scheduledtask.Repository,
	encryptor *crypto.Encryptor,
	maxConcurrency int,
	operationRecords operationrecord.Service,
	taskRuns taskcenter.Service,
) *Executor {
	if maxConcurrency <= 0 {
		maxConcurrency = 10
	}
	executor := &Executor{
		serverService:    serverService,
		scriptService:    scriptService,
		taskRepo:         taskRepo,
		encryptor:        encryptor,
		maxConcurrency:   maxConcurrency,
		operationRecords: operationRecords,
		taskRuns:         taskRuns,
		cancels:          make(map[uuid.UUID]context.CancelFunc),
	}
	return executor
}

// SetHostKeyCallback 设置主机密钥验证回调
func (e *Executor) SetHostKeyCallback(callback gossh.HostKeyCallback) {
	e.hostKeyCallback = callback
}

func (e *Executor) SetTransferJobService(service transferjob.Service) {
	e.transferJobs = service
}

// Execute 执行任务
func (e *Executor) Execute(ctx context.Context, task *scheduledtask.ScheduledTask, trigger TriggerType, source ExecutionSource) ExecutionOutcome {
	return e.execute(ctx, task, trigger, source, nil, 1, "parallel")
}

func (e *Executor) ExecuteBatch(ctx context.Context, task *scheduledtask.ScheduledTask, trigger TriggerType, source ExecutionSource, executionMode string) ExecutionOutcome {
	return e.execute(ctx, task, trigger, source, nil, 1, executionMode)
}

func (e *Executor) ExecuteRetry(ctx context.Context, task *scheduledtask.ScheduledTask, retryOfID uuid.UUID, attempt int) ExecutionOutcome {
	if attempt < 2 {
		attempt = 2
	}
	return e.execute(ctx, task, TriggerManual, SourceScheduledTask, &retryOfID, attempt, "parallel")
}

func (e *Executor) HandleQueueJob(ctx context.Context, job *jobqueue.Job) error {
	var payload QueuePayload
	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		return fmt.Errorf("decode task execution payload: %w", err)
	}
	if payload.TaskID == uuid.Nil {
		return errors.New("task execution payload is missing task_id")
	}
	task, err := e.taskRepo.GetByID(payload.TaskID)
	if err != nil {
		return fmt.Errorf("load scheduled task: %w", err)
	}
	if payload.Trigger == TriggerSchedule && !task.Enabled {
		return nil
	}
	if payload.Source == "" {
		payload.Source = SourceScheduledTask
	}
	if payload.Trigger == "" {
		payload.Trigger = TriggerManual
	}
	if payload.RetryOfID != nil {
		e.ExecuteRetry(ctx, task, *payload.RetryOfID, payload.Attempt)
	} else {
		e.Execute(ctx, task, payload.Trigger, payload.Source)
	}
	return ctx.Err()
}

func (e *Executor) execute(ctx context.Context, task *scheduledtask.ScheduledTask, trigger TriggerType, source ExecutionSource, retryOfID *uuid.UUID, attempt int, executionMode string) ExecutionOutcome {
	log.Printf("[TaskExecutor] 开始执行任务: taskID=%s, type=%s, trigger=%s",
		task.ID, task.TaskType, trigger)

	startTime := time.Now()
	executionID := uuid.New()
	executionCtx, cancel := context.WithCancel(ctx)
	e.cancelMu.Lock()
	e.cancels[executionID] = cancel
	e.cancelMu.Unlock()
	defer func() {
		cancel()
		e.cancelMu.Lock()
		delete(e.cancels, executionID)
		e.cancelMu.Unlock()
	}()

	record := taskExecutionRecord{
		ID:                    executionID,
		UserID:                task.UserID,
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
	if e.taskRuns != nil {
		triggerType := taskcenter.TriggerManual
		if trigger == TriggerSchedule {
			triggerType = taskcenter.TriggerScheduled
		}
		run := &taskcenter.TaskRun{
			ID: executionID, UserID: task.UserID,
			RetryOfID: retryOfID, Attempt: attempt, MaxAttempts: attempt,
			SourceType: string(source), SourceID: task.ID.String(), TaskType: task.TaskType,
			Title: task.TaskName, Description: task.Description, TriggerType: triggerType, Runner: "server",
			Status: taskcenter.StatusQueued, Resource: strings.Join(task.ServerIDs, ","), PayloadJSON: task.PayloadJSON,
			Cancelable: !isTransferTask(task.TaskType), Retryable: record.IsScheduledDefinition,
		}
		if record.IsScheduledDefinition {
			definitionID := task.ID
			run.DefinitionID = &definitionID
		}
		if err := e.taskRuns.Create(ctx, run); err == nil {
			_ = e.taskRuns.Start(ctx, executionID, "executing")
		}
	}
	e.upsertOperationRecord(record)

	if isTransferTask(task.TaskType) {
		return e.executeTransferTask(executionCtx, task, &record)
	}

	// 根据任务类型获取要执行的命令
	command, err := e.resolveCommand(executionCtx, task)
	if err != nil {
		log.Printf("[TaskExecutor] 解析命令失败: %v", err)
		status := executionStatusFailed
		if errors.Is(executionCtx.Err(), context.Canceled) {
			status = executionStatusCanceled
		}
		e.completeExecution(&record, status, err.Error(), 0, 0, nil)
		return makeExecutionOutcome(status, 0, 0, err.Error())
	}
	record.Command = command
	e.upsertOperationRecord(record)

	// 并发执行到所有服务器
	results := e.executeOnServers(executionCtx, task.UserID, task.ServerIDs, command, executionMode)

	// 统计结果
	successCount := 0
	failedCount := 0

	for _, result := range results {
		if result.Status == executionStatusSuccess {
			successCount++
		} else {
			failedCount++
		}
	}

	// 确定最终状态
	var finalStatus executionStatus
	if errors.Is(executionCtx.Err(), context.Canceled) {
		finalStatus = executionStatusCanceled
	} else if failedCount == 0 && successCount > 0 {
		finalStatus = executionStatusSuccess
	} else if successCount == 0 {
		finalStatus = executionStatusFailed
	} else {
		finalStatus = executionStatusPartial
	}

	// 完成执行记录
	e.completeExecution(&record, finalStatus, "", successCount, failedCount, results)

	log.Printf("[TaskExecutor] 任务执行完成: taskID=%s, status=%s, success=%d, failed=%d",
		task.ID, finalStatus, successCount, failedCount)
	return makeExecutionOutcome(finalStatus, successCount, failedCount, "")
}

func (e *Executor) CancelTask(id uuid.UUID) bool {
	e.cancelMu.Lock()
	cancel := e.cancels[id]
	e.cancelMu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
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
		UserID:          task.UserID,
		ScheduledTaskID: task.ID,
		TaskName:        task.TaskName,
		TaskType:        task.TaskType,
		PayloadJSON:     task.PayloadJSON,
		TaskRunID:       record.ID,
	})
	if err != nil {
		log.Printf("[TaskExecutor] 触发传输任务失败: taskID=%s, error=%v", task.ID, err)
		e.completeExecution(record, executionStatusFailed, err.Error(), 0, 1, nil)
		return makeExecutionOutcome(executionStatusFailed, 0, 1, err.Error())
	}

	record.TransferJobID = job.ID
	record.SkipTaskCenter = true
	record.Command = fmt.Sprintf("transfer_job:%s", job.ID)
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
func (e *Executor) resolveCommand(ctx context.Context, task *scheduledtask.ScheduledTask) (string, error) {
	switch task.TaskType {
	case "command":
		if task.Command == "" {
			return "", fmt.Errorf("command is empty")
		}
		return task.Command, nil

	case "script":
		if task.ScriptID == nil {
			return "", fmt.Errorf("script_id is required for script type")
		}
		scriptObj, err := e.scriptService.GetScript(task.UserID, *task.ScriptID)
		if err != nil {
			return "", fmt.Errorf("failed to get script: %w", err)
		}
		return scriptObj.Content, nil

	default:
		return "", fmt.Errorf("unknown task type: %s", task.TaskType)
	}
}

// executeOnServers 并发执行到多个服务器
func (e *Executor) executeOnServers(
	ctx context.Context,
	userID uuid.UUID,
	serverIDs []string,
	command string,
	executionMode string,
) []ServerExecutionResult {
	if len(serverIDs) == 0 {
		return nil
	}

	results := make([]ServerExecutionResult, len(serverIDs))
	if executionMode == "sequential" {
		for index, serverID := range serverIDs {
			if ctx.Err() != nil {
				break
			}
			results[index] = e.executeOnSingleServer(ctx, userID, serverID, command)
		}
		return results
	}

	// 使用信号量控制并发
	sem := make(chan struct{}, e.maxConcurrency)
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i, serverIDStr := range serverIDs {
		wg.Add(1)
		go func(index int, sidStr string) {
			defer wg.Done()

			// 获取信号量
			sem <- struct{}{}
			defer func() { <-sem }()

			result := e.executeOnSingleServer(ctx, userID, sidStr, command)

			mu.Lock()
			results[index] = result
			mu.Unlock()
		}(i, serverIDStr)
	}

	wg.Wait()
	return results
}

// executeOnSingleServer 在单个服务器上执行命令
func (e *Executor) executeOnSingleServer(
	ctx context.Context,
	userID uuid.UUID,
	serverIDStr string,
	command string,
) ServerExecutionResult {
	startTime := time.Now()
	result := ServerExecutionResult{
		StartTime: startTime,
		Status:    executionStatusFailed,
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

	// 获取服务器信息
	srv, err := e.serverService.GetByID(ctx, userID, serverID)
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
	client, err := ssh.NewClient(srv, e.encryptor, e.hostKeyCallback)
	if err != nil {
		result.ErrorMessage = fmt.Sprintf("failed to create ssh client: %v", err)
		endTime := time.Now()
		result.EndTime = &endTime
		result.Duration = endTime.Sub(startTime).Milliseconds()
		return result
	}
	defer client.Close()

	// 连接服务器
	if err := client.Connect(srv.Host, srv.Port); err != nil {
		result.ErrorMessage = fmt.Sprintf("failed to connect: %v", err)
		endTime := time.Now()
		result.EndTime = &endTime
		result.Duration = endTime.Sub(startTime).Milliseconds()
		return result
	}

	// 执行命令
	commandResult, err := client.ExecuteCommandDetailedContext(ctx, command)
	endTime := time.Now()
	result.EndTime = &endTime
	result.Duration = endTime.Sub(startTime).Milliseconds()
	if commandResult != nil {
		result.Output = commandResult.Output
		exitCode := commandResult.ExitCode
		result.ExitCode = &exitCode
	}

	if err != nil {
		result.ErrorMessage = err.Error()
		if result.ExitCode == nil {
			exitCode := 1
			result.ExitCode = &exitCode
		}
		result.Status = executionStatusFailed
	} else {
		if result.ExitCode == nil {
			exitCode := 0
			result.ExitCode = &exitCode
		}
		result.Status = executionStatusSuccess
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
	e.upsertOperationRecord(*execution)
	if e.taskRuns != nil && !execution.SkipTaskCenter {
		statusMap := map[executionStatus]taskcenter.Status{
			executionStatusSuccess:  taskcenter.StatusSucceeded,
			executionStatusFailed:   taskcenter.StatusFailed,
			executionStatusPartial:  taskcenter.StatusPartialSuccess,
			executionStatusTimeout:  taskcenter.StatusTimeout,
			executionStatusCanceled: taskcenter.StatusCanceled,
		}
		taskStatus, ok := statusMap[status]
		if ok {
			resultJSON, _ := json.Marshal(serverResults)
			_ = e.taskRuns.Complete(context.Background(), execution.ID, taskStatus, string(resultJSON), "", errorMsg, successCount, failedCount)
		}
	}
}

type taskExecutionRecord struct {
	ID                    uuid.UUID
	ScheduledTaskID       uuid.UUID
	TransferJobID         uuid.UUID
	UserID                uuid.UUID
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

func (e *Executor) upsertOperationRecord(execution taskExecutionRecord) {
	if e.operationRecords == nil || execution.UserID == uuid.Nil || execution.ID == uuid.Nil {
		return
	}

	status := operationrecord.StatusRunning
	switch execution.Status {
	case executionStatusPending:
		status = operationrecord.StatusPending
	case executionStatusSuccess:
		status = operationrecord.StatusSuccess
	case executionStatusFailed:
		status = operationrecord.StatusFailure
	case executionStatusPartial:
		status = operationrecord.StatusPartial
	case executionStatusTimeout:
		status = operationrecord.StatusTimeout
	case executionStatusCanceled:
		status = operationrecord.StatusCanceled
	}
	detail, _ := json.Marshal(map[string]interface{}{
		"scheduled_task_id": execution.ScheduledTaskID,
		"transfer_job_id":   execution.TransferJobID,
		"source_type":       execution.SourceType,
		"source_id":         execution.SourceID,
		"task_type":         execution.TaskType,
		"trigger_type":      execution.TriggerType,
		"server_results":    execution.ServerResults,
	})
	now := time.Now()

	record := &operationrecord.OperationRecord{
		UserID:       execution.UserID,
		Type:         operationrecord.TypeExecution,
		Action:       "task_execute",
		Status:       status,
		Title:        execution.TaskName,
		Resource:     execution.Command,
		Source:       string(execution.TriggerType),
		StartedAt:    &execution.StartTime,
		FinishedAt:   execution.EndTime,
		DurationMs:   execution.Duration,
		TotalCount:   execution.TotalServers,
		SuccessCount: execution.SuccessCount,
		FailureCount: execution.FailedCount,
		ErrorMessage: execution.ErrorMessage,
		DetailJSON:   string(detail),
		SourceTable:  "task_runs",
		SourceID:     execution.ID.String(),
		CreatedAt:    execution.StartTime,
		UpdatedAt:    now,
	}

	_ = e.operationRecords.Upsert(context.Background(), record)
}

// updateTaskStatus 更新任务状态
func (e *Executor) updateTaskStatus(taskID uuid.UUID, status string) {
	now := time.Now()

	// 获取当前任务
	task, err := e.taskRepo.GetByID(taskID)
	if err != nil {
		log.Printf("[TaskExecutor] 获取任务失败: %v", err)
		return
	}

	updates := map[string]interface{}{
		"last_run_at": now,
		"last_status": status,
		"run_count":   task.RunCount + 1,
	}

	if status == "failed" {
		updates["failure_count"] = task.FailureCount + 1
	}

	if err := e.taskRepo.Update(taskID, updates); err != nil {
		log.Printf("[TaskExecutor] 更新任务状态失败: %v", err)
	}
}

func (e *Executor) UpdateDefinitionStatus(taskID uuid.UUID, status taskcenter.Status) {
	definitionStatus := "failed"
	if status == taskcenter.StatusSucceeded {
		definitionStatus = "success"
	} else if status == taskcenter.StatusCanceled {
		definitionStatus = "canceled"
	}
	e.updateTaskStatus(taskID, definitionStatus)
}
