package batchtask

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"strings"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/domain/taskexecutor"
	"github.com/google/uuid"
)

var (
	ErrBatchTaskNotFound    = errors.New("batch task not found")
	ErrInvalidBatchTaskData = errors.New("invalid batch task data")
)

type TaskExecutor interface {
	ExecuteBatch(context.Context, uuid.UUID, *scheduledtask.ScheduledTask, taskexecutor.TriggerType, taskexecutor.ExecutionSource, string) taskexecutor.ExecutionOutcome
}
type Service interface {
	CreateBatchTask(context.Context, *protocol.CreateBatchTaskRequest) (*BatchTask, error)
	UpdateBatchTask(context.Context, uuid.UUID, *protocol.UpdateBatchTaskRequest) (*BatchTask, error)
	DeleteBatchTask(context.Context, uuid.UUID) error
	GetBatchTask(context.Context, uuid.UUID) (*BatchTask, error)
	ListBatchTasks(context.Context, *protocol.ListBatchTasksRequest) (*protocol.ListBatchTasksResponse, error)
	GetStatistics(context.Context) (*protocol.BatchTaskStatistics, error)
	StartBatchTask(context.Context, uuid.UUID) error
	SetExecutor(TaskExecutor)
	SetTaskCenter(taskcenter.Service)
	SetQueue(jobqueue.Queue)
	HandleQueueJob(context.Context, *jobqueue.Job) error
}
type service struct {
	repo     Repository
	scripts  script.Service
	executor TaskExecutor
	runs     taskcenter.Service
	queue    jobqueue.Queue
}

func NewService(repo Repository, scripts script.Service) Service {
	return &service{repo: repo, scripts: scripts}
}
func (s *service) SetExecutor(e TaskExecutor)         { s.executor = e }
func (s *service) SetTaskCenter(r taskcenter.Service) { s.runs = r }
func (s *service) SetQueue(q jobqueue.Queue)          { s.queue = q }

func (s *service) validate(ctx context.Context, task *BatchTask) error {
	if strings.TrimSpace(task.TaskName) == "" || len(task.TaskName) > 100 || len(task.ServerIDs) == 0 || len(task.ServerIDs) > 100 {
		return ErrInvalidBatchTaskData
	}
	if task.ExecutionMode != "parallel" && task.ExecutionMode != "sequential" {
		return ErrInvalidBatchTaskData
	}
	seen := map[string]bool{}
	for _, id := range task.ServerIDs {
		parsed, err := uuid.Parse(id)
		if err != nil || parsed == uuid.Nil || parsed.String() != id || seen[id] {
			return ErrInvalidBatchTaskData
		}
		seen[id] = true
	}
	switch task.TaskType {
	case "command":
		if task.Content == "" || len(task.Content) > 1<<20 || task.ScriptID != nil || len(task.Parameters) > 0 || task.ScriptVersion != "" {
			return ErrInvalidBatchTaskData
		}
		for _, id := range task.ServerIDs {
			if err := access.Current(ctx).Check(ctx, access.Requirement{Action: protocol.TerminalConnect, ServerID: id}); err != nil {
				return err
			}
		}
	case "script":
		if task.ScriptID == nil || task.Content != "" {
			return ErrInvalidBatchTaskData
		}
		execution, err := s.scripts.Resolve(ctx, *task.ScriptID, task.ServerIDs, task.Parameters, task.ScriptVersion)
		if err != nil {
			return err
		}
		task.ScriptVersion = execution.Version
	default:
		return ErrInvalidBatchTaskData
	}
	return nil
}
func (s *service) CreateBatchTask(ctx context.Context, req *protocol.CreateBatchTaskRequest) (*BatchTask, error) {
	if err := access.Current(ctx).Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	if req == nil {
		return nil, ErrInvalidBatchTaskData
	}
	task := &BatchTask{Actor: access.Current(ctx).Actor(), TaskName: strings.TrimSpace(req.TaskName), TaskType: string(req.TaskType), Content: req.Content, ServerIDs: append([]string(nil), req.ServerIDs...), ExecutionMode: string(req.ExecutionMode), ScriptVersion: req.ScriptVersion, Parameters: req.Parameters, Status: "pending"}
	if task.ExecutionMode == "" {
		task.ExecutionMode = "parallel"
	}
	if req.ScriptID != nil {
		id, err := uuid.Parse(*req.ScriptID)
		if err != nil || id == uuid.Nil || id.String() != *req.ScriptID {
			return nil, ErrInvalidBatchTaskData
		}
		task.ScriptID = &id
	}
	if err := s.validate(ctx, task); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, task); err != nil {
		return nil, err
	}
	return task, nil
}
func mutable(ctx context.Context, task *BatchTask) error {
	scope := access.Current(ctx)
	if task.Actor == scope.Actor() {
		return scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead})
	}
	if task.Actor.Kind == protocol.Owner && task.Actor.ID == scope.Actor().ID {
		return scope.RequireOwner(ctx, protocol.ResourcesManage)
	}
	return access.ErrForbidden
}
func (s *service) UpdateBatchTask(ctx context.Context, id uuid.UUID, req *protocol.UpdateBatchTaskRequest) (*BatchTask, error) {
	if req == nil {
		return nil, ErrInvalidBatchTaskData
	}
	task, err := s.repo.GetVisible(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := mutable(ctx, task); err != nil {
		return nil, err
	}
	if task.Status != "pending" {
		return nil, ErrInvalidBatchTaskData
	}
	if req.TaskName != "" {
		task.TaskName = req.TaskName
	}
	if req.Content != "" {
		task.Content = req.Content
	}
	if req.ServerIDs != nil {
		task.ServerIDs = req.ServerIDs
	}
	if req.ExecutionMode != "" {
		task.ExecutionMode = string(req.ExecutionMode)
	}
	if req.ScriptVersion != nil {
		task.ScriptVersion = *req.ScriptVersion
	}
	if req.Parameters != nil {
		task.Parameters = *req.Parameters
	}
	if err := s.validate(ctx, task); err != nil {
		return nil, err
	}
	changed, err := s.repo.UpdateIfStatus(ctx, id, []string{"pending"}, map[string]interface{}{"task_name": task.TaskName, "content": task.Content, "server_ids": task.ServerIDs, "execution_mode": task.ExecutionMode, "script_version": task.ScriptVersion, "parameters": task.Parameters})
	if err != nil {
		return nil, err
	}
	if !changed {
		return nil, ErrInvalidBatchTaskData
	}
	return s.repo.GetVisible(ctx, id)
}
func (s *service) DeleteBatchTask(ctx context.Context, id uuid.UUID) error {
	if _, err := s.repo.GetVisible(ctx, id); err != nil {
		return err
	}
	return s.repo.Delete(ctx, id)
}
func (s *service) GetBatchTask(ctx context.Context, id uuid.UUID) (*BatchTask, error) {
	return s.repo.GetVisible(ctx, id)
}
func (s *service) ListBatchTasks(ctx context.Context, req *protocol.ListBatchTasksRequest) (*protocol.ListBatchTasksResponse, error) {
	if req == nil {
		req = &protocol.ListBatchTasksRequest{}
	}
	if req.Page < 0 || req.Page > 1000000 || req.Limit < 0 || req.Limit > 100 || req.Status != "" && !req.Status.Valid() || req.TaskType != "" && !req.TaskType.Valid() {
		return nil, ErrInvalidBatchTaskData
	}
	req.Page = max(1, req.Page)
	if req.Limit < 1 {
		req.Limit = 20
	}
	req.Limit = min(100, req.Limit)
	rows, total, err := s.repo.List(ctx, req)
	if err != nil {
		return nil, err
	}
	items := make([]protocol.BatchTask, 0, len(rows))
	for _, row := range rows {
		items = append(items, row.Public())
	}
	return &protocol.ListBatchTasksResponse{Data: items, Total: total, Page: req.Page, PageSize: req.Limit, TotalPages: int((total + int64(req.Limit) - 1) / int64(req.Limit))}, nil
}
func (s *service) GetStatistics(ctx context.Context) (*protocol.BatchTaskStatistics, error) {
	return s.repo.GetStatistics(ctx)
}
func (s *service) StartBatchTask(ctx context.Context, id uuid.UUID) error {
	task, err := s.repo.GetVisible(ctx, id)
	if err != nil {
		return err
	}
	if err := mutable(ctx, task); err != nil {
		return err
	}
	if s.queue == nil || s.runs == nil {
		return errors.New("task execution is unavailable")
	}
	if err := s.validate(ctx, task); err != nil {
		return err
	}
	run, err := s.repo.Dispatch(ctx, task)
	if err != nil {
		return err
	}
	// Both side effects observe a committed source/run/event/activity/outbox.
	s.runs.PublishCreated(run)
	s.queue.NotifyEnqueued()
	return nil
}

func (s *service) HandleQueueJob(ctx context.Context, job *jobqueue.Job) error {
	id, err := batchDispatchID(job)
	if err != nil {
		return err
	}
	task, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if task.Actor != job.Actor || task.Actor != access.Current(ctx).Actor() {
		return access.ErrForbidden
	}
	if task.Status != "queued" {
		return nil
	}
	if err := s.validate(ctx, task); err != nil {
		return err
	}
	input, _ := json.Marshal(script.ExecutionInput{ScriptID: task.ScriptID, Version: task.ScriptVersion, Parameters: task.Parameters})
	definition := &scheduledtask.ScheduledTask{ID: task.ID, TaskName: task.TaskName, TaskType: task.TaskType, Command: task.Content, ScriptID: task.ScriptID, ServerIDs: task.ServerIDs, PayloadJSON: string(input)}
	if s.executor == nil {
		return fmt.Errorf("batch executor is unavailable")
	}
	outcome := s.executor.ExecuteBatch(ctx, task.ID, definition, taskexecutor.TriggerManual, taskexecutor.SourceBatchTask, task.ExecutionMode)
	return outcome.StorageError
}
