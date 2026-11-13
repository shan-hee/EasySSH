package taskcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/storage/accessquery"
	"github.com/easyssh/shared/protocol"
	"strings"
	"time"

	"github.com/easyssh/shared/taskprotocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository interface {
	Details(context.Context, uuid.UUID) (protocol.TaskRunDetails, error)
	CreateWithEvent(ctx context.Context, run *TaskRun, event *TaskEvent) error
	UpdateIfStatus(ctx context.Context, id uuid.UUID, statuses []Status, updates map[string]interface{}) (bool, error)
	Complete(ctx context.Context, id uuid.UUID, sourceType string, updates map[string]interface{}) (bool, error)
	Get(ctx context.Context, id uuid.UUID) (*TaskRun, error)
	GetAny(ctx context.Context, id uuid.UUID) (*TaskRun, error)
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	Statistics(ctx context.Context) (*Statistics, error)
	ListRecoveryCandidates(ctx context.Context, after uuid.UUID) ([]RecoveryCandidate, error)
	AppendEvent(ctx context.Context, event *TaskEvent) error
	ListEvents(ctx context.Context, runID uuid.UUID, input protocol.TaskEventInput) (*protocol.TaskEventPage, error)
	CleanupTerminalBefore(ctx context.Context, before time.Time) (*CleanupResult, error)
}

// Bodies is the host's existing immutable body store. It owns the backup
// lock; the caller commits the file reference and event in the same transaction.
type Bodies interface {
	PutTaskBody(*gorm.DB, TaskRun, []byte) (protocol.ContentReference, error)
	LoadTaskBody(*gorm.DB, TaskRun, protocol.ContentReference) ([]byte, error)
	WithStorage(func() error) error
	PutTaskEvent(*gorm.DB, TaskRun, []byte) (protocol.ContentReference, error)
}

type repository struct {
	inTransaction bool
	db            *gorm.DB
	bodies        Bodies
}

func NewRepository(db *gorm.DB, bodies Bodies) Repository {
	return &repository{db: db, bodies: bodies}
}

func (r *repository) CreateWithEvent(ctx context.Context, run *TaskRun, event *TaskEvent) error {
	requestedRun, requestedEvent := run, event
	candidate, candidateEvent := *run, *event
	candidate.ContentID, candidate.ContentSize, candidate.ContentSHA256 = nil, 0, ""
	run, event = &candidate, &candidateEvent
	err := r.transaction(ctx, func(tx *gorm.DB) error {
		if run.RetryOfID != nil {
			var previous TaskRun
			if err := tx.Where("id = ?", *run.RetryOfID).First(&previous).Error; err != nil {
				return err
			}
			if previous.Actor.Kind == protocol.Visitor && previous.Actor != run.Actor {
				return access.ErrForbidden
			}
			if previous.Actor.Kind == protocol.Owner && (run.Actor.Kind != protocol.Owner || previous.Actor.ID != run.Actor.ID) {
				return access.ErrForbidden
			}
			run.WorkID, run.WorkStartedAt, run.ParentWorkID = previous.WorkID, previous.WorkStartedAt, previous.ParentWorkID
			run.Attempt = previous.Attempt + 1
		}
		if run.ServerID != nil && run.ServerName == "" {
			var snapshot struct{ Name string }
			if err := tx.Table("servers").Select("name").Where("id = ? AND deleted_at IS NULL", *run.ServerID).Scan(&snapshot).Error; err != nil {
				return err
			}
			run.ServerName = snapshot.Name
		}
		if err := tx.Create(run).Error; err != nil {
			return err
		}
		if err := StoreBody(tx, r.bodies, run); err != nil {
			return err
		}
		event.TaskRunID = run.ID
		if err := tx.Create(event).Error; err != nil {
			return err
		}
		return projectRun(tx, run)
	})
	if err == nil {
		*requestedRun, *requestedEvent = *run, *event
	}
	return err
}

func (r *repository) UpdateIfStatus(ctx context.Context, id uuid.UUID, statuses []Status, updates map[string]interface{}) (bool, error) {
	return r.updateIfStatus(ctx, id, statuses, updates, nil)
}

func (r *repository) updateIfStatus(ctx context.Context, id uuid.UUID, statuses []Status, updates map[string]interface{}, sourceType *string) (bool, error) {
	changed := false
	err := r.transaction(ctx, func(tx *gorm.DB) error {
		query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND status IN ?", id, statuses)
		if sourceType != nil {
			query = query.Where("source_type = ?", *sourceType)
		}
		var run TaskRun
		if err := query.First(&run).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if err := r.restoreBody(tx, &run); err != nil {
			return err
		}
		original := run.Body()
		body := original
		columns := make(map[string]interface{}, len(updates))
		for key, value := range updates {
			var field *string
			switch key {
			case "description":
				field = &body.Description
			case "payload_json":
				field = &body.PayloadJSON
			case "result_json":
				field = &body.ResultJSON
			case "progress_json":
				field = &body.ProgressJSON
			default:
				columns[key] = value
				continue
			}
			text, ok := value.(string)
			if !ok {
				return errors.New("task body updates must be strings")
			}
			*field = text
		}
		if len(columns) > 0 {
			if err := tx.Model(&TaskRun{}).Where("id=?", id).Updates(columns).Error; err != nil {
				return err
			}
		}
		if body != original {
			run.applyBody(body)
			if err := StoreBody(tx, r.bodies, &run); err != nil {
				return err
			}
		}
		var current TaskRun
		if err := tx.First(&current, "id=?", id).Error; err != nil {
			return err
		}
		run = current
		run.applyBody(body)
		changed = true
		if _, changesStatus := updates["status"]; changesStatus {
			if IsTerminalStatus(run.Status) && run.DefinitionID != nil {
				if err := projectDefinitionOutcome(tx, &run); err != nil {
					return err
				}
			}
			level, message := "info", "任务状态已更新"
			switch run.Status {
			case StatusQueued:
				message = "任务已进入队列"
			case StatusRunning:
				message = "任务开始执行"
			case StatusCanceling:
				message = "已请求取消任务"
			case StatusSucceeded:
				message = "任务执行完成"
			case StatusFailed, StatusTimeout:
				level, message = "error", "任务执行失败"
			case StatusPartialSuccess:
				level, message = "warning", "任务部分成功"
			case StatusUnknown:
				level, message = "warning", "任务结果未知，请先核对远端效果"
			case StatusCanceled:
				level, message = "warning", "任务已取消"
			}
			if err := tx.Create(&TaskEvent{TaskRunID: run.ID, Level: level, Message: message}).Error; err != nil {
				return err
			}
		}
		return projectRun(tx, &run)
	})
	return changed && err == nil, err
}
func (r *repository) Complete(ctx context.Context, id uuid.UUID, sourceType string, updates map[string]interface{}) (bool, error) {
	return r.updateIfStatus(ctx, id, []Status{StatusQueued, StatusRunning, StatusCanceling}, updates, &sourceType)
}

func (r *repository) Get(ctx context.Context, id uuid.UUID) (*TaskRun, error) {
	return r.get(ctx, id, true)
}
func (r *repository) GetAny(ctx context.Context, id uuid.UUID) (*TaskRun, error) {
	return r.get(ctx, id, false)
}

func (r *repository) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	if req == nil {
		req = &ListRequest{}
	}
	request := *req
	opts := &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true}
	if r.db.Dialector.Name() == "sqlite" {
		opts = &sql.TxOptions{}
	}
	var result *ListResponse
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = (&repository{db: tx}).listSnapshot(ctx, &request)
		return err
	}, opts)
	return result, err
}

func (r *repository) listSnapshot(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx).Model(&TaskRun{}))
	if err != nil {
		return nil, err
	}
	if len(req.Statuses) > 0 {
		query = query.Where("status IN ?", req.Statuses)
	}
	if len(req.TaskTypes) > 0 {
		query = query.Where("task_type IN ?", req.TaskTypes)
	}
	if len(req.TriggerTypes) > 0 {
		query = query.Where("trigger_type IN ?", req.TriggerTypes)
	}
	if keyword := strings.TrimSpace(req.Keyword); keyword != "" {
		like := "%" + strings.ToLower(keyword) + "%"
		query = query.Where("LOWER(title) LIKE ? OR LOWER(task_type) LIKE ? OR LOWER(resource) LIKE ? OR LOWER(server_name) LIKE ? OR LOWER(error_message) LIKE ?", like, like, like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	if req.Page < 1 {
		req.Page = 1
	}
	if req.PageSize < 1 {
		req.PageSize = 20
	}
	if req.PageSize > 100 {
		req.PageSize = 100
	}
	var runs []*TaskRunSummary
	if err := query.Select(taskSummarySelect).Order("created_at DESC,id DESC").Offset((req.Page - 1) * req.PageSize).Limit(req.PageSize).Find(&runs).Error; err != nil {
		return nil, err
	}
	totalPages := int(total) / req.PageSize
	if int(total)%req.PageSize != 0 {
		totalPages++
	}
	return &ListResponse{Runs: runs, Total: total, Page: req.Page, PageSize: req.PageSize, TotalPages: totalPages}, nil
}

func (r *repository) Statistics(ctx context.Context) (*Statistics, error) {
	stats := &Statistics{}
	var rows []struct {
		Status Status
		Count  int64
	}
	query, err := accessquery.Visible(ctx, r.db.WithContext(ctx).Model(&TaskRun{}))
	if err != nil {
		return nil, err
	}
	if err := query.Select("status, COUNT(*) AS count").
		Group("status").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		stats.Total += row.Count
		switch row.Status {
		case StatusQueued:
			stats.Queued = row.Count
		case StatusRunning:
			stats.Running = row.Count
		case StatusCanceling:
			stats.Canceling = row.Count
		case StatusSucceeded:
			stats.Succeeded = row.Count
		case StatusFailed:
			stats.Failed = row.Count
		case StatusPartialSuccess:
			stats.PartialSuccess = row.Count
		case StatusCanceled:
			stats.Canceled = row.Count
		case StatusTimeout:
			stats.Timeout = row.Count
		case StatusUnknown:
			stats.Unknown = row.Count
		}
	}
	return stats, nil
}

const recoveryPageSize = 100

type RecoveryCandidate struct {
	ID         uuid.UUID
	SourceType string
	Status     Status
}

func (r *repository) ListRecoveryCandidates(ctx context.Context, after uuid.UUID) ([]RecoveryCandidate, error) {
	query := r.db.WithContext(ctx).Model(&TaskRun{}).Select("id,source_type,status").Where("status IN ?", []Status{StatusQueued, StatusRunning, StatusCanceling})
	if after != uuid.Nil {
		query = query.Where("id > ?", after)
	}
	var runs []RecoveryCandidate
	err := query.Order("id ASC").Limit(recoveryPageSize).Find(&runs).Error
	return runs, err
}

func (r *repository) AppendEvent(ctx context.Context, requested *TaskEvent) error {
	copy := *requested
	event := &copy
	// Serialize diagnostics with task transitions so cursor order is commit order.
	write := func() error {
		return r.transaction(ctx, func(tx *gorm.DB) error {
			var run TaskRun
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "actor_kind", "actor_id", "actor_session_id", "actor_grant_id").Where("id=?", event.TaskRunID).First(&run).Error; err != nil {
				return err
			}
			// Allocate the database event ID before producing its immutable public JSON.
			message, data := event.Message, event.DataJSON
			event.Message, event.DataJSON = "", ""
			event.ContentID, event.ContentSize, event.ContentSHA256 = nil, 0, ""
			if err := tx.Create(event).Error; err != nil {
				event.Message, event.DataJSON = message, data
				return err
			}
			event.Message, event.DataJSON = message, data
			raw, err := json.Marshal(wireTaskEvent(*event))
			if err != nil {
				return err
			}
			if len(raw) > taskprotocol.MaxInlineEventBytes {
				if r.bodies == nil {
					return errors.New("task event body storage is required")
				}
				ref, err := r.bodies.PutTaskEvent(tx, run, raw)
				if err != nil {
					return err
				}
				event.ContentID, event.ContentSize, event.ContentSHA256 = &ref.ID, ref.Size, ref.Sha256
				event.Message, event.DataJSON = "", ""
			}
			return tx.Model(&TaskEvent{}).Where("id=?", event.ID).Updates(map[string]any{"message": event.Message, "data_json": event.DataJSON, "content_id": event.ContentID, "content_size": event.ContentSize, "content_sha256": event.ContentSHA256}).Error
		})
	}
	err := write()
	if err == nil {
		*requested = copy
	}
	return err
}

func (r *repository) requireVisibleEventRun(ctx context.Context, runID uuid.UUID) error {
	visible, err := accessquery.Visible(ctx, r.db.WithContext(ctx).Model(&TaskRun{}))
	if err != nil {
		return err
	}
	var run TaskRun
	return visible.Select("id").Where("id = ?", runID).Take(&run).Error
}
func wireTaskEvent(event TaskEvent) protocol.TaskEvent {
	result := protocol.TaskEvent{ID: event.ID, TaskRunID: event.TaskRunID.String(), Level: event.Level, Message: event.Message, DataJSON: event.DataJSON, CreatedAt: event.CreatedAt}
	if event.ContentID != nil {
		result.Content = &protocol.ContentReference{ID: *event.ContentID, Size: event.ContentSize, Sha256: event.ContentSHA256, MediaType: "application/json"}
	}
	return result
}

func (r *repository) ListEvents(ctx context.Context, runID uuid.UUID, input protocol.TaskEventInput) (*protocol.TaskEventPage, error) {
	input, err := taskprotocol.NormalizeEventInput(input)
	if err != nil {
		return nil, err
	}
	if err := r.requireVisibleEventRun(ctx, runID); err != nil {
		return nil, err
	}
	query := r.db.WithContext(ctx).Model(&TaskEvent{}).Where("task_run_id = ? AND id > ?", runID, input.AfterID).Order("id ASC").Limit(input.Limit + 1)
	rows, err := query.Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return taskprotocol.BuildEventPage(runID.String(), input, func() (protocol.TaskEvent, bool, error) {
		if !rows.Next() {
			return protocol.TaskEvent{}, false, rows.Err()
		}
		var event TaskEvent
		if err := r.db.ScanRows(rows, &event); err != nil {
			return protocol.TaskEvent{}, false, err
		}
		return wireTaskEvent(event), true, nil
	})
}

func (r *repository) CleanupTerminalBefore(ctx context.Context, before time.Time) (*CleanupResult, error) {
	result := &CleanupResult{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var runs []cleanupRunRef
		if err := tx.Model(&TaskRun{}).
			Select("id", "actor_kind", "actor_id", "actor_session_id", "actor_grant_id").
			Where("finished_at IS NOT NULL AND finished_at < ? AND status IN ?", before, terminalTaskStatuses()).
			Scan(&runs).Error; err != nil {
			return err
		}
		return cleanupTaskRuns(tx, runs, result)
	})
	return result, err
}

func cleanupTaskRuns(tx *gorm.DB, runs []cleanupRunRef, result *CleanupResult) error {
	runIDs := make([]uuid.UUID, 0, len(runs))
	affectedActors := make(map[protocol.Actor]struct{})
	for _, run := range runs {
		runIDs = append(runIDs, run.ID)
		if _, exists := affectedActors[run.Actor]; !exists {
			affectedActors[run.Actor] = struct{}{}
			result.AffectedActors = append(result.AffectedActors, run.Actor)
		}
	}

	const batchSize = 500
	for start := 0; start < len(runIDs); start += batchSize {
		end := start + batchSize
		if end > len(runIDs) {
			end = len(runIDs)
		}
		batch := runIDs[start:end]

		if err := tx.Where("source_type=? AND source_id IN ?", "task_run", batch).Delete(&NotificationDelivery{}).Error; err != nil {
			return err
		}
		deletedNotifications := tx.Table("inbox_notifications").Where("source_type=? AND source_id IN ?", "task_run", batch).Delete(&taskNotification{})
		if deletedNotifications.Error != nil {
			return deletedNotifications.Error
		}
		result.DeletedNotifications += deletedNotifications.RowsAffected

		if err := tx.Table("transfer_jobs").Where("task_run_id IN ?", batch).Update("task_run_id", nil).Error; err != nil {
			return err
		}
		if err := tx.Model(&TaskRun{}).Where("retry_of_id IN ?", batch).Update("retry_of_id", nil).Error; err != nil {
			return err
		}

		deletedEvents := tx.Where("task_run_id IN ?", batch).Delete(&TaskEvent{})
		if deletedEvents.Error != nil {
			return deletedEvents.Error
		}
		result.DeletedEvents += deletedEvents.RowsAffected

		deletedRuns := tx.Where("id IN ? AND status IN ?", batch, terminalTaskStatuses()).Delete(&TaskRun{})
		if deletedRuns.Error != nil {
			return deletedRuns.Error
		}
		result.DeletedCount += deletedRuns.RowsAffected
	}
	return nil
}

func terminalTaskStatuses() []Status {
	return []Status{StatusSucceeded, StatusFailed, StatusPartialSuccess, StatusCanceled, StatusTimeout, StatusUnknown}
}

type cleanupRunRef struct {
	ID    uuid.UUID
	Actor protocol.Actor `gorm:"embedded;embeddedPrefix:actor_"`
}

type taskNotification struct {
	ID uuid.UUID
}

func (taskNotification) TableName() string { return "inbox_notifications" }

// Count the attempt in the same transaction as its terminal TaskRun. A lost
// commit response can neither lose nor duplicate scheduled-definition counts.
func projectDefinitionOutcome(tx *gorm.DB, run *TaskRun) error {
	status, failed := "failed", 1
	switch run.Status {
	case StatusSucceeded:
		status, failed = "success", 0
	case StatusCanceled:
		status, failed = "canceled", 0
	case StatusUnknown:
		status, failed = "unknown", 0
	}
	return tx.Table("scheduled_tasks").Where("id = ?", *run.DefinitionID).Updates(map[string]interface{}{
		"run_count":     gorm.Expr("COALESCE(run_count, 0) + 1"),
		"failure_count": gorm.Expr("COALESCE(failure_count, 0) + ?", failed),
		"last_run_at":   gorm.Expr("CASE WHEN last_run_at IS NULL OR last_run_at < ? THEN ? ELSE last_run_at END", run.FinishedAt, run.FinishedAt),
		"last_status":   gorm.Expr("CASE WHEN last_run_at IS NULL OR last_run_at <= ? THEN ? ELSE last_status END", run.FinishedAt, status),
	}).Error
}

const taskSummarySelect = "work_id, parent_work_id, work_started_at, actor_kind, actor_id, actor_session_id, actor_grant_id, id, definition_id, retry_of_id, source_type, source_id, task_type, SUBSTR(title,1,513) AS title, trigger_type, runner, status, SUBSTR(stage,1,513) AS stage, server_id, SUBSTR(server_name,1,513) AS server_name, SUBSTR(resource,1,513) AS resource, progress, total_count, success_count, failure_count, bytes_total, bytes_processed, cancelable, retryable, attempt, max_attempts, error_code, SUBSTR(error_message,1,513) AS error_message, cancel_requested_at, started_at, finished_at, created_at, updated_at"
