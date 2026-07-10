package taskcenter

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrNotFound      = errors.New("task run not found")
	ErrNotCancelable = errors.New("task run is not cancelable")
)

const (
	retentionCleanupInterval    = 24 * time.Hour
	defaultSuccessRetentionDays = 90
	defaultFailureRetentionDays = 180
)

type CompletionNotifier interface {
	NotifyTaskFinished(ctx context.Context, run *TaskRun) error
}

type CancelHandler interface {
	CancelTask(id uuid.UUID) bool
}

type DefinitionStatusUpdater interface {
	UpdateDefinitionStatus(id uuid.UUID, status Status)
}

type Service interface {
	Create(ctx context.Context, run *TaskRun) error
	Start(ctx context.Context, id uuid.UUID, stage string) error
	UpdateProgress(ctx context.Context, id uuid.UUID, progress int, stage, progressJSON string, successCount, failureCount int) error
	Complete(ctx context.Context, id uuid.UUID, status Status, resultJSON, errorCode, errorMessage string, successCount, failureCount int) error
	AppendEvent(ctx context.Context, runID, userID uuid.UUID, level, message, dataJSON string) error
	Get(ctx context.Context, userID, id uuid.UUID) (*TaskRun, error)
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	Statistics(ctx context.Context, userID uuid.UUID) (*Statistics, error)
	Events(ctx context.Context, userID, runID uuid.UUID) ([]TaskEvent, error)
	Cleanup(ctx context.Context, userID uuid.UUID, retentionDays int) (*CleanupResult, error)
	StartRetention(ctx context.Context)
	StopRetention()
	RequestCancel(ctx context.Context, userID, id uuid.UUID) error
	RecoverInterrupted(ctx context.Context) error
	SetNotifier(notifier CompletionNotifier)
	SetCanceler(canceler CancelHandler)
	SetDefinitionStatusUpdater(updater DefinitionStatusUpdater)
}

type service struct {
	repo     Repository
	notifier CompletionNotifier
	canceler CancelHandler
	updater  DefinitionStatusUpdater
	events   *realtime.Hub

	retentionMu     sync.Mutex
	retentionCancel context.CancelFunc
	retentionWG     sync.WaitGroup
}

func NewService(repo Repository, events *realtime.Hub) Service {
	return &service{repo: repo, events: events}
}

func (s *service) SetNotifier(notifier CompletionNotifier) { s.notifier = notifier }
func (s *service) SetCanceler(canceler CancelHandler)      { s.canceler = canceler }
func (s *service) SetDefinitionStatusUpdater(updater DefinitionStatusUpdater) {
	s.updater = updater
}

func (s *service) Create(ctx context.Context, run *TaskRun) error {
	if err := s.repo.CreateWithEvent(ctx, run, &TaskEvent{Level: "info", Message: "任务已进入队列"}); err != nil {
		return err
	}
	s.publishTask("task.created", run)
	return nil
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
	if isTerminalStatus(run.Status) {
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
	_ = s.AppendEvent(ctx, id, run.UserID, "info", "任务开始执行", "")
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
	updated, err := s.repo.UpdateIfStatus(ctx, id, []Status{StatusQueued, StatusRunning, StatusCanceling}, map[string]interface{}{
		"progress": progress, "stage": stage, "progress_json": progressJSON,
		"success_count": successCount, "failure_count": failureCount,
	})
	if err == nil && updated {
		if run, findErr := s.repo.GetAny(ctx, id); findErr == nil {
			s.publishTask("task.updated", run)
		}
	}
	return err
}

func (s *service) Complete(ctx context.Context, id uuid.UUID, status Status, resultJSON, errorCode, errorMessage string, successCount, failureCount int) error {
	existing, err := s.repo.GetAny(ctx, id)
	if err != nil {
		return err
	}
	if isTerminalStatus(existing.Status) {
		return nil
	}
	now := time.Now()
	progress := existing.Progress
	if status == StatusSucceeded || status == StatusPartialSuccess {
		progress = 100
	}
	completed, err := s.repo.Complete(ctx, id, map[string]interface{}{
		"status": status, "progress": progress, "result_json": resultJSON, "error_code": errorCode,
		"error_message": errorMessage, "success_count": successCount, "failure_count": failureCount, "finished_at": &now,
	})
	if err != nil {
		return err
	}
	if !completed {
		return nil
	}
	run, err := s.findByID(ctx, id)
	if err != nil {
		return nil
	}
	level := "info"
	message := "任务执行完成"
	if status == StatusFailed || status == StatusTimeout {
		level, message = "error", "任务执行失败"
	}
	if status == StatusPartialSuccess {
		level, message = "warning", "任务部分成功"
	}
	if status == StatusCanceled {
		level, message = "warning", "任务已取消"
	}
	_ = s.AppendEvent(ctx, id, run.UserID, level, message, "")
	s.publishTask("task.updated", run)
	if run.DefinitionID != nil && s.updater != nil {
		s.updater.UpdateDefinitionStatus(*run.DefinitionID, status)
	}
	if s.notifier != nil {
		if err := s.notifier.NotifyTaskFinished(context.Background(), run); err != nil {
			_ = s.AppendEvent(context.Background(), id, run.UserID, "warning", "任务通知入队失败", err.Error())
		}
	}
	return nil
}

func isTerminalStatus(status Status) bool {
	return status == StatusSucceeded || status == StatusFailed || status == StatusPartialSuccess || status == StatusCanceled || status == StatusTimeout
}

func (s *service) findByID(ctx context.Context, id uuid.UUID) (*TaskRun, error) {
	run, err := s.repo.GetAny(ctx, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	return run, err
}

func (s *service) AppendEvent(ctx context.Context, runID, userID uuid.UUID, level, message, dataJSON string) error {
	return s.repo.AppendEvent(ctx, &TaskEvent{TaskRunID: runID, UserID: userID, Level: level, Message: message, DataJSON: dataJSON})
}

func (s *service) Get(ctx context.Context, userID, id uuid.UUID) (*TaskRun, error) {
	run, err := s.repo.Get(ctx, userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	return run, err
}

func (s *service) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	return s.repo.List(ctx, req)
}
func (s *service) Statistics(ctx context.Context, userID uuid.UUID) (*Statistics, error) {
	return s.repo.Statistics(ctx, userID)
}
func (s *service) Events(ctx context.Context, userID, runID uuid.UUID) ([]TaskEvent, error) {
	return s.repo.ListEvents(ctx, userID, runID)
}

func (s *service) Cleanup(ctx context.Context, userID uuid.UUID, retentionDays int) (*CleanupResult, error) {
	if retentionDays <= 0 {
		retentionDays = 90
	}
	result, err := s.repo.CleanupTerminalBefore(ctx, userID, time.Now().AddDate(0, 0, -retentionDays))
	if err != nil {
		return nil, err
	}
	s.publishCleanup(userID, result, map[string]interface{}{"policy": "manual", "retention_days": retentionDays})
	return result, nil
}

func (s *service) StartRetention(ctx context.Context) {
	s.retentionMu.Lock()
	defer s.retentionMu.Unlock()
	if s.retentionCancel != nil {
		return
	}
	workerCtx, cancel := context.WithCancel(ctx)
	s.retentionCancel = cancel
	s.retentionWG.Add(1)
	go s.runRetentionWorker(workerCtx)
}

func (s *service) StopRetention() {
	s.retentionMu.Lock()
	defer s.retentionMu.Unlock()
	cancel := s.retentionCancel
	if cancel == nil {
		return
	}
	cancel()
	s.retentionWG.Wait()
	s.retentionCancel = nil
}

func (s *service) runRetentionWorker(ctx context.Context) {
	defer s.retentionWG.Done()
	s.applyDefaultRetention(ctx)
	ticker := time.NewTicker(retentionCleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.applyDefaultRetention(ctx)
		case <-ctx.Done():
			return
		}
	}
}

func (s *service) applyDefaultRetention(ctx context.Context) {
	result, err := s.repo.CleanupDefaultRetention(ctx, time.Now())
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			log.Printf("[TaskCenter] default retention cleanup failed: %v", err)
		}
		return
	}
	if result.DeletedCount > 0 {
		log.Printf("[TaskCenter] default retention cleanup completed: runs=%d events=%d notifications=%d", result.DeletedCount, result.DeletedEvents, result.DeletedNotifications)
	}
	for _, userID := range result.AffectedUserIDs {
		s.publishDefaultRetention(userID)
	}
}

func (s *service) publishDefaultRetention(userID uuid.UUID) {
	if s.events == nil {
		return
	}
	payload := map[string]interface{}{
		"policy": "default", "success_retention_days": defaultSuccessRetentionDays, "failure_retention_days": defaultFailureRetentionDays,
	}
	s.events.Publish(userID, "task.cleanup.completed", payload)
	s.events.Publish(userID, "notification.cleanup.completed", payload)
}

func (s *service) publishCleanup(userID uuid.UUID, result *CleanupResult, extra map[string]interface{}) {
	if s.events == nil || result == nil {
		return
	}
	payload := map[string]interface{}{
		"deleted_count":         result.DeletedCount,
		"deleted_events":        result.DeletedEvents,
		"deleted_notifications": result.DeletedNotifications,
	}
	for key, value := range extra {
		payload[key] = value
	}
	s.events.Publish(userID, "task.cleanup.completed", payload)
	if result.DeletedNotifications > 0 {
		s.events.Publish(userID, "notification.cleanup.completed", payload)
	}
}

func (s *service) RequestCancel(ctx context.Context, userID, id uuid.UUID) error {
	run, err := s.Get(ctx, userID, id)
	if err != nil {
		return err
	}
	if !run.Cancelable || (run.Status != StatusQueued && run.Status != StatusRunning) {
		return ErrNotCancelable
	}
	now := time.Now()
	requested, err := s.repo.UpdateIfStatus(ctx, id, []Status{StatusQueued, StatusRunning}, map[string]interface{}{"status": StatusCanceling, "cancel_requested_at": &now})
	if err != nil {
		return err
	}
	if !requested {
		return ErrNotCancelable
	}
	if s.canceler == nil || !s.canceler.CancelTask(id) {
		_, _ = s.repo.UpdateIfStatus(ctx, id, []Status{StatusCanceling}, map[string]interface{}{"status": run.Status, "cancel_requested_at": nil})
		return ErrNotCancelable
	}
	run.Status = StatusCanceling
	run.CancelRequestedAt = &now
	s.publishTask("task.updated", run)
	return nil
}

func (s *service) publishTask(eventType string, run *TaskRun) {
	if s.events == nil || run == nil {
		return
	}
	s.events.Publish(run.UserID, eventType, map[string]interface{}{
		"task_id": run.ID, "status": run.Status, "progress": run.Progress, "stage": run.Stage,
	})
}

func (s *service) RecoverInterrupted(ctx context.Context) error {
	runs, err := s.repo.ListActive(ctx)
	if err != nil {
		return err
	}
	for i := range runs {
		if err := s.Complete(ctx, runs[i].ID, StatusFailed, "", "server_restarted", "任务因服务重启而中断", runs[i].SuccessCount, runs[i].FailureCount); err != nil {
			return err
		}
	}
	return nil
}
