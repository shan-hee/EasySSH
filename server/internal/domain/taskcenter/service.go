package taskcenter

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"log"
	"time"

	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrNotFound                = errors.New("task run not found")
	ErrNotCancelable           = errors.New("task run is not cancelable")
	ErrObservedOutcomeConflict = errors.New("task outcome conflicts with the observed result")
	ErrTransferOutcomeConflict = errors.New("task outcome conflicts with the transfer source")
)

type CancelHandler interface {
	CancelTask(ctx context.Context, id uuid.UUID) error
}

// CancelHandlerFunc adapts the application-owned dispatch to source executors.
type CancelHandlerFunc func(context.Context, uuid.UUID) error

func (f CancelHandlerFunc) CancelTask(ctx context.Context, id uuid.UUID) error { return f(ctx, id) }

type Service interface {
	Details(context.Context, uuid.UUID) (protocol.TaskRunDetails, error)
	Create(ctx context.Context, run *TaskRun) error
	PublishCreated(run *TaskRun)
	Start(ctx context.Context, id uuid.UUID, stage string) error
	MarkTransferCanceling(context.Context, uuid.UUID) error
	UpdateProgress(ctx context.Context, id uuid.UUID, progress int, stage, progressJSON string, successCount, failureCount int) error
	Complete(ctx context.Context, id uuid.UUID, status Status, resultJSON, errorCode, errorMessage string, successCount, failureCount int) error
	CompleteDocker(ctx context.Context, id uuid.UUID, status Status, resultJSON, errorCode, errorMessage string, successCount, failureCount int, finishedAt time.Time) error
	CompleteExecution(ctx context.Context, expected TaskRun, status Status, resultJSON, errorCode, errorMessage string, successCount, failureCount int, finishedAt time.Time) error
	ObserveExecution(ctx context.Context, expected TaskRun, resultJSON string, completed, successCount, failureCount int) error
	CompleteTransfer(ctx context.Context, id uuid.UUID, status Status, resultJSON, errorCode, errorMessage string, successCount, failureCount int) error
	AppendEvent(ctx context.Context, runID uuid.UUID, level, message, dataJSON string) error
	Get(ctx context.Context, id uuid.UUID) (*TaskRun, error)
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	Statistics(ctx context.Context) (*Statistics, error)
	Events(ctx context.Context, runID uuid.UUID, input protocol.TaskEventInput) (*protocol.TaskEventPage, error)
	// CleanupBefore removes finished runs older than the retention cutoff. The
	// retention service decides the cutoff; nothing else removes runs by age.
	CleanupBefore(ctx context.Context, before time.Time) (*CleanupResult, error)
	RequestCancel(ctx context.Context, id uuid.UUID) error
	RecoverInterrupted(ctx context.Context) error
	SetCanceler(canceler CancelHandler)
}

type service struct {
	repo     Repository
	canceler CancelHandler
	events   *realtime.Hub
}

func NewService(repo Repository, events *realtime.Hub) Service {
	return &service{repo: repo, events: events}
}

func (s *service) SetCanceler(canceler CancelHandler) { s.canceler = canceler }
func (s *service) Create(ctx context.Context, run *TaskRun) error {
	if !run.Actor.Valid() {
		run.Actor = access.Current(ctx).Actor()
	}
	if !run.Actor.Valid() {
		return access.ErrUnauthenticated
	}
	if err := s.repo.CreateWithEvent(ctx, run, &TaskEvent{Level: "info", Message: "任务已进入队列"}); err != nil {
		return err
	}
	s.PublishCreated(run)
	return nil
}

// PublishCreated is called only after a source-owned transaction commits its
// TaskRun and event/activity projections. It never creates or replays work.
func (s *service) PublishCreated(run *TaskRun) {
	s.publishTask("task.created", run)
}

func (s *service) Start(ctx context.Context, id uuid.UUID, stage string) error {
	run, err := s.repo.GetAny(ctx, id)
	if err != nil {
		return err
	}
	if run.Status == StatusRunning {
		updated, err := s.repo.UpdateIfStatus(ctx, id, []Status{StatusRunning}, map[string]interface{}{"stage": stage})
		if err == nil && updated {
			run.Stage = stage
			s.publishTask("task.updated", run)
		}
		return err
	}
	if IsTerminalStatus(run.Status) {
		return nil
	}
	now := time.Now()
	started, err := s.repo.UpdateIfStatus(ctx, id, []Status{StatusQueued}, map[string]interface{}{"status": StatusRunning, "stage": stage, "started_at": &now})
	if err != nil {
		return err
	}
	if !started {
		return nil
	}
	run.Status = StatusRunning
	run.Stage = stage
	run.StartedAt = &now
	s.publishTask("task.updated", run)
	return nil
}

func (s *service) UpdateProgress(ctx context.Context, id uuid.UUID, progress int, stage, progressJSON string, successCount, failureCount int) error {
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	updates := map[string]interface{}{
		"progress": progress, "stage": stage, "progress_json": progressJSON, "success_count": successCount, "failure_count": failureCount,
	}
	var bytes struct {
		Total     *int64 `json:"bytes_total"`
		Processed *int64 `json:"bytes_processed"`
	}
	if json.Unmarshal([]byte(progressJSON), &bytes) == nil {
		if bytes.Total != nil && *bytes.Total >= 0 {
			updates["bytes_total"] = *bytes.Total
		}
		if bytes.Processed != nil && *bytes.Processed >= 0 {
			updates["bytes_processed"] = *bytes.Processed
		}
	}
	updated, err := s.repo.UpdateIfStatus(ctx, id, []Status{StatusQueued, StatusRunning, StatusCanceling}, updates)
	if err == nil && updated {
		if run, findErr := s.repo.GetAny(ctx, id); findErr == nil {
			s.publishTask("task.updated", run)
		}
	}
	return err
}

// MarkTransferCanceling mirrors a cancellation already accepted by the source;
// it does not dispatch a second cancellation through the task executor.
func (s *service) MarkTransferCanceling(ctx context.Context, id uuid.UUID) error {
	run, err := s.repo.GetAny(ctx, id)
	if err != nil {
		return err
	}
	if run.SourceType != "transfer_job" {
		return errors.New("task is not owned by a transfer")
	}
	now := time.Now().UTC()
	updated, err := s.repo.UpdateIfStatus(ctx, id, []Status{StatusQueued, StatusRunning}, map[string]interface{}{
		"status": StatusCanceling, "cancel_requested_at": &now,
	})
	if err == nil && updated {
		run.Status, run.CancelRequestedAt = StatusCanceling, &now
		s.publishTask("task.updated", run)
	}
	return err
}

func (s *service) Complete(ctx context.Context, id uuid.UUID, status Status, resultJSON, errorCode, errorMessage string, successCount, failureCount int) error {
	return s.complete(ctx, id, status, &resultJSON, errorCode, errorMessage, successCount, failureCount, false, nil, nil)
}

func (s *service) CompleteTransfer(ctx context.Context, id uuid.UUID, status Status, resultJSON, errorCode, errorMessage string, successCount, failureCount int) error {
	return s.complete(ctx, id, status, &resultJSON, errorCode, errorMessage, successCount, failureCount, true, nil, nil)
}

// CompleteDocker retains the observed end time when storage must be retried.
func (s *service) CompleteDocker(ctx context.Context, id uuid.UUID, status Status, resultJSON, errorCode, errorMessage string, successCount, failureCount int, finishedAt time.Time) error {
	if finishedAt.IsZero() || !IsTerminalStatus(status) {
		return errors.New("invalid Docker outcome")
	}
	return s.complete(ctx, id, status, &resultJSON, errorCode, errorMessage, successCount, failureCount, false, &finishedAt, nil)
}

// ObserveExecution saves completed targets while the executor still owns a live
// run. Like completion, saving observed effects does not require a live lease.
// The executor serializes snapshots so a late writer cannot regress its results.
func (s *service) ObserveExecution(ctx context.Context, expected TaskRun, resultJSON string, completed, successCount, failureCount int) error {
	if expected.ID == uuid.Nil || !expected.Actor.Valid() || expected.SourceID == "" || (expected.SourceType != "batch_task" && expected.SourceType != "scheduled_task") || (expected.TaskType != "command" && expected.TaskType != "script") {
		return ErrObservedOutcomeConflict
	}
	run, err := s.repo.GetAny(ctx, expected.ID)
	if err != nil {
		return err
	}
	if run.Actor != expected.Actor || run.SourceType != expected.SourceType || run.SourceID != expected.SourceID || run.TaskType != expected.TaskType || completed < 1 || completed > run.TotalCount || successCount < 0 || failureCount < 0 || successCount+failureCount > completed {
		return ErrObservedOutcomeConflict
	}
	updated, err := s.repo.UpdateIfStatus(ctx, run.ID, []Status{StatusRunning, StatusCanceling}, map[string]interface{}{
		"result_json": resultJSON, "progress": completed * 100 / run.TotalCount, "success_count": successCount, "failure_count": failureCount,
	})
	if err != nil {
		return err
	}
	if !updated {
		return ErrObservedOutcomeConflict
	}
	if current, err := s.repo.GetAny(ctx, run.ID); err == nil {
		s.publishTask("task.updated", current)
	}
	return nil
}

// CompleteExecution records an executor-owned observation, including its original
// completion time. It requires no live permission lease: revocation may stop work,
// but must not prevent saving the effects already observed by that executor.
func (s *service) CompleteExecution(ctx context.Context, expected TaskRun, status Status, resultJSON, errorCode, errorMessage string, successCount, failureCount int, finishedAt time.Time) error {
	if expected.ID == uuid.Nil || !expected.Actor.Valid() || expected.SourceID == "" || (expected.SourceType != "batch_task" && expected.SourceType != "scheduled_task" && expected.SourceType != "sftp_delete" && expected.SourceType != "sftp_operation") || finishedAt.IsZero() || !IsTerminalStatus(status) {
		return ErrObservedOutcomeConflict
	}
	return s.complete(ctx, expected.ID, status, &resultJSON, errorCode, errorMessage, successCount, failureCount, false, &finishedAt, &expected)
}

func (s *service) complete(ctx context.Context, id uuid.UUID, status Status, resultJSON *string, errorCode, errorMessage string, successCount, failureCount int, transfer bool, observedAt *time.Time, expected *TaskRun) error {
	existing, err := s.repo.GetAny(ctx, id)
	if err != nil {
		return err
	}
	if expected != nil && (existing.Actor != expected.Actor || existing.SourceType != expected.SourceType || existing.SourceID != expected.SourceID || existing.TaskType != expected.TaskType) {
		return ErrObservedOutcomeConflict
	}
	if observedAt != nil && expected == nil && existing.SourceType != "docker" {
		return ErrObservedOutcomeConflict
	}
	if (existing.SourceType == "transfer_job") != transfer {
		if transfer {
			return errors.New("task outcome is not owned by a transfer")
		}
		// Preparation/rejection cannot settle a transfer after durable handoff.
		return nil
	}
	// A nil result belongs only to restart settlement: keep already observed
	// bytes and counters instead of inventing an empty execution receipt.
	resultValue := existing.ResultJSON
	if resultJSON != nil {
		resultValue = *resultJSON
	} else {
		successCount, failureCount = existing.SuccessCount, existing.FailureCount
	}
	matches := func(run *TaskRun) bool {
		return run.Status == status && run.ResultJSON == resultValue && run.ErrorCode == errorCode && run.ErrorMessage == errorMessage && run.SuccessCount == successCount && run.FailureCount == failureCount && (observedAt == nil || run.FinishedAt != nil && run.FinishedAt.Equal(*observedAt))
	}
	if IsTerminalStatus(existing.Status) {
		if (transfer || observedAt != nil) && !matches(existing) {
			if transfer {
				return ErrTransferOutcomeConflict
			}
			return ErrObservedOutcomeConflict
		}
		return nil
	}
	now := time.Now()
	if observedAt != nil {
		now = *observedAt
	}
	progress := existing.Progress
	if status == StatusSucceeded || status == StatusPartialSuccess {
		progress = 100
	}
	updates := map[string]interface{}{
		"status": status, "progress": progress, "error_code": errorCode, "error_message": errorMessage, "success_count": successCount, "failure_count": failureCount, "finished_at": &now, "cancelable": false, "retryable": existing.Retryable && (status == StatusFailed || status == StatusPartialSuccess || status == StatusTimeout || status == StatusCanceled),
	}
	if resultJSON != nil {
		updates["result_json"] = resultValue
	}
	completed, err := s.repo.Complete(ctx, id, existing.SourceType, updates)

	if err != nil {
		return err
	}
	if !completed {
		if transfer || observedAt != nil {
			current, err := s.repo.GetAny(ctx, id)
			if err != nil {
				return err
			}
			if !matches(current) {
				if transfer {
					return ErrTransferOutcomeConflict
				}
				return ErrObservedOutcomeConflict
			}
		}
		return nil
	}
	run, err := s.findByID(ctx, id)
	if err != nil {
		return nil
	}
	s.publishTask("task.updated", run)

	return nil
}

func IsTerminalStatus(status Status) bool {
	return status == StatusSucceeded || status == StatusFailed || status == StatusPartialSuccess || status == StatusCanceled || status == StatusTimeout || status == StatusUnknown
}

func (s *service) findByID(ctx context.Context, id uuid.UUID) (*TaskRun, error) {
	run, err := s.repo.GetAny(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	return run, err
}

func (s *service) AppendEvent(ctx context.Context, runID uuid.UUID, level, message, dataJSON string) error {
	return s.repo.AppendEvent(ctx, &TaskEvent{TaskRunID: runID, Level: level, Message: message, DataJSON: dataJSON})
}

func (s *service) Details(ctx context.Context, id uuid.UUID) (protocol.TaskRunDetails, error) {
	detail, err := s.repo.Details(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return detail, ErrNotFound
	}
	return detail, err
}

func (s *service) Get(ctx context.Context, id uuid.UUID) (*TaskRun, error) {
	run, err := s.repo.Get(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	return run, err
}

func (s *service) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	return s.repo.List(ctx, req)
}
func (s *service) Statistics(ctx context.Context) (*Statistics, error) {
	return s.repo.Statistics(ctx)
}
func (s *service) Events(ctx context.Context, runID uuid.UUID, input protocol.TaskEventInput) (*protocol.TaskEventPage, error) {
	return s.repo.ListEvents(ctx, runID, input)
}

func (s *service) CleanupBefore(ctx context.Context, before time.Time) (*CleanupResult, error) {
	result, err := s.repo.CleanupTerminalBefore(ctx, before)
	if err != nil {
		return nil, err
	}
	if s.events != nil {
		for _, actor := range result.AffectedActors {
			s.events.Publish(actor, "task.cleanup.completed", map[string]interface{}{"policy": "retention"})
			s.events.Publish(actor, "notification.cleanup.completed", map[string]interface{}{"policy": "retention"})
		}
	}
	return result, nil
}

func (s *service) RequestCancel(ctx context.Context, id uuid.UUID) error {
	run, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if !run.Cancelable || (run.Status != StatusQueued && run.Status != StatusRunning) {
		return ErrNotCancelable
	}
	if s.canceler == nil {
		return ErrNotCancelable
	}
	now := time.Now()
	updates := map[string]interface{}{"status": StatusCanceling, "cancel_requested_at": &now}
	// Preserve the state we actually replaced. A stale queued read cannot prove
	// that the executor has not started in the meantime.
	requested, err := s.repo.UpdateIfStatus(ctx, id, []Status{run.Status}, updates)
	if err != nil {
		return err
	}
	if !requested && run.Status == StatusQueued {
		run, err = s.Get(ctx, id)
		if err != nil {
			return err
		}
		if !run.Cancelable || run.Status != StatusRunning {
			return ErrNotCancelable
		}
		requested, err = s.repo.UpdateIfStatus(ctx, id, []Status{StatusRunning}, updates)
		if err != nil {
			return err
		}
	}
	if !requested {
		return ErrNotCancelable
	}
	wasQueued := run.Status == StatusQueued
	if err := s.canceler.CancelTask(ctx, id); err != nil {
		if _, rollbackErr := s.repo.UpdateIfStatus(ctx, id, []Status{StatusCanceling}, map[string]interface{}{"status": run.Status, "cancel_requested_at": nil}); rollbackErr != nil {
			log.Printf("[TaskCenter] rollback cancel state failed: run=%s error=%v", id, rollbackErr)
		}
		return err
	}
	if wasQueued && run.SourceType != "sftp_delete" {
		return s.Complete(ctx, id, StatusCanceled, "", "", "任务在开始执行前已取消", 0, 0)
	}
	// The source may already have committed an observation while cancel was
	// dispatched. Re-read instead of publishing the pre-dispatch snapshot.
	// Notifications remain refresh hints; committed rows are authoritative.
	current, readErr := s.repo.GetAny(ctx, id)
	if readErr != nil {
		log.Printf("[TaskCenter] read after accepted cancellation failed: run=%s error=%v", id, readErr)
	} else if current.Status == StatusCanceling {
		s.publishTask("task.updated", current)
	}
	return nil
}

// PublishCommittedUpdate is for source transactions that already persisted the
// task and activity together. It must be called after the outer commit.
func PublishCommittedUpdate(events *realtime.Hub, run *TaskRun) {
	publishTaskEvent(events, "task.updated", run)
}
func (s *service) publishTask(eventType string, run *TaskRun) {
	publishTaskEvent(s.events, eventType, run)
}
func publishTaskEvent(events *realtime.Hub, eventType string, run *TaskRun) {
	if events == nil || run == nil {
		return
	}
	events.Publish(run.Actor, "activity.updated", map[string]interface{}{"work_id": run.WorkID, "task_id": run.ID, "status": run.Status})
	events.Publish(run.Actor, eventType, map[string]interface{}{
		"task_id": run.ID, "status": run.Status, "progress": run.Progress, "stage": run.Stage,
	})
}

func (s *service) RecoverInterrupted(ctx context.Context) error {
	after := uuid.Nil
	for {
		runs, err := s.repo.ListRecoveryCandidates(ctx, after)
		if err != nil {
			return err
		}
		if len(runs) == 0 {
			return nil
		}
		for _, run := range runs {
			after = run.ID
			if run.SourceType == "transfer_job" {
				continue
			}
			if (run.SourceType == "scheduled_task" || run.SourceType == "batch_task") && run.Status == StatusQueued {
				continue
			}
			status, message := StatusUnknown, "任务因服务重启而中断，远端效果未知；保留已有结果，未自动重试"
			if run.Status == StatusQueued {
				status, message = StatusCanceled, "任务在执行前因服务重启而取消，未自动重试"
			}
			if err := s.complete(ctx, run.ID, status, nil, "server_restarted", message, 0, 0, false, nil, nil); err != nil {
				return err
			}
		}
		if len(runs) < recoveryPageSize {
			return nil
		}
	}
}
