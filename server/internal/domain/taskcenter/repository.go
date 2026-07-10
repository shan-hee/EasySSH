package taskcenter

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository interface {
	CreateWithEvent(ctx context.Context, run *TaskRun, event *TaskEvent) error
	UpdateIfStatus(ctx context.Context, id uuid.UUID, statuses []Status, updates map[string]interface{}) (bool, error)
	Complete(ctx context.Context, id uuid.UUID, updates map[string]interface{}) (bool, error)
	Get(ctx context.Context, userID, id uuid.UUID) (*TaskRun, error)
	GetAny(ctx context.Context, id uuid.UUID) (*TaskRun, error)
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	Statistics(ctx context.Context, userID uuid.UUID) (*Statistics, error)
	ListActive(ctx context.Context) ([]TaskRun, error)
	AppendEvent(ctx context.Context, event *TaskEvent) error
	ListEvents(ctx context.Context, userID, runID uuid.UUID) ([]TaskEvent, error)
	CleanupTerminalBefore(ctx context.Context, userID uuid.UUID, before time.Time) (*CleanupResult, error)
}

type repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) Repository { return &repository{db: db} }

func (r *repository) CreateWithEvent(ctx context.Context, run *TaskRun, event *TaskEvent) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(run).Error; err != nil {
			return err
		}
		event.TaskRunID = run.ID
		event.UserID = run.UserID
		return tx.Create(event).Error
	})
}

func (r *repository) UpdateIfStatus(ctx context.Context, id uuid.UUID, statuses []Status, updates map[string]interface{}) (bool, error) {
	result := r.db.WithContext(ctx).Model(&TaskRun{}).Where("id = ? AND status IN ?", id, statuses).Updates(updates)
	return result.RowsAffected > 0, result.Error
}

func (r *repository) Complete(ctx context.Context, id uuid.UUID, updates map[string]interface{}) (bool, error) {
	result := r.db.WithContext(ctx).Model(&TaskRun{}).
		Where("id = ? AND status IN ?", id, []Status{StatusQueued, StatusRunning, StatusCanceling}).
		Updates(updates)
	return result.RowsAffected > 0, result.Error
}

func (r *repository) Get(ctx context.Context, userID, id uuid.UUID) (*TaskRun, error) {
	var run TaskRun
	if err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).First(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *repository) GetAny(ctx context.Context, id uuid.UUID) (*TaskRun, error) {
	var run TaskRun
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *repository) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	query := r.db.WithContext(ctx).Model(&TaskRun{}).Where("user_id = ?", req.UserID)
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
	var runs []*TaskRun
	if err := query.Order("created_at DESC").Offset((req.Page - 1) * req.PageSize).Limit(req.PageSize).Find(&runs).Error; err != nil {
		return nil, err
	}
	totalPages := int(total) / req.PageSize
	if int(total)%req.PageSize != 0 {
		totalPages++
	}
	return &ListResponse{Runs: runs, Total: total, Page: req.Page, PageSize: req.PageSize, TotalPages: totalPages}, nil
}

func (r *repository) Statistics(ctx context.Context, userID uuid.UUID) (*Statistics, error) {
	stats := &Statistics{}
	base := func() *gorm.DB { return r.db.WithContext(ctx).Model(&TaskRun{}).Where("user_id = ?", userID) }
	if err := base().Count(&stats.Total).Error; err != nil {
		return nil, err
	}
	counts := []struct {
		status Status
		target *int64
	}{
		{StatusQueued, &stats.Queued}, {StatusRunning, &stats.Running}, {StatusCanceling, &stats.Canceling}, {StatusSucceeded, &stats.Succeeded},
		{StatusFailed, &stats.Failed}, {StatusPartialSuccess, &stats.PartialSuccess}, {StatusCanceled, &stats.Canceled},
		{StatusTimeout, &stats.Timeout},
	}
	for _, item := range counts {
		if err := base().Where("status = ?", item.status).Count(item.target).Error; err != nil {
			return nil, err
		}
	}
	return stats, nil
}

func (r *repository) ListActive(ctx context.Context) ([]TaskRun, error) {
	var runs []TaskRun
	err := r.db.WithContext(ctx).
		Where("status IN ?", []Status{StatusQueued, StatusRunning, StatusCanceling}).
		Order("created_at ASC").
		Find(&runs).Error
	return runs, err
}

func (r *repository) AppendEvent(ctx context.Context, event *TaskEvent) error {
	return r.db.WithContext(ctx).Create(event).Error
}

func (r *repository) ListEvents(ctx context.Context, userID, runID uuid.UUID) ([]TaskEvent, error) {
	var events []TaskEvent
	err := r.db.WithContext(ctx).Where("user_id = ? AND task_run_id = ?", userID, runID).Order(clause.OrderByColumn{Column: clause.Column{Name: "created_at"}}).Find(&events).Error
	return events, err
}

func (r *repository) CleanupTerminalBefore(ctx context.Context, userID uuid.UUID, before time.Time) (*CleanupResult, error) {
	result := &CleanupResult{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var runIDs []uuid.UUID
		if err := tx.Model(&TaskRun{}).
			Where("user_id = ? AND finished_at IS NOT NULL AND finished_at < ? AND status IN ?", userID, before, terminalTaskStatuses()).
			Pluck("id", &runIDs).Error; err != nil {
			return err
		}

		const batchSize = 500
		for start := 0; start < len(runIDs); start += batchSize {
			end := start + batchSize
			if end > len(runIDs) {
				end = len(runIDs)
			}
			batch := runIDs[start:end]

			var notificationIDs []uuid.UUID
			if err := tx.Table("inbox_notifications").
				Where("user_id = ? AND source_type = ? AND source_id IN ?", userID, "task_run", batch).
				Pluck("id", &notificationIDs).Error; err != nil {
				return err
			}
			if len(notificationIDs) > 0 {
				if err := tx.Table("notification_deliveries").Where("user_id = ? AND notification_id IN ?", userID, notificationIDs).Delete(&taskNotificationDelivery{}).Error; err != nil {
					return err
				}
				deletedNotifications := tx.Table("inbox_notifications").Where("user_id = ? AND id IN ?", userID, notificationIDs).Delete(&taskNotification{})
				if deletedNotifications.Error != nil {
					return deletedNotifications.Error
				}
				result.DeletedNotifications += deletedNotifications.RowsAffected
			}

			if err := tx.Table("transfer_jobs").Where("user_id = ? AND task_run_id IN ?", userID, batch).Update("task_run_id", nil).Error; err != nil {
				return err
			}
			if err := tx.Model(&TaskRun{}).Where("user_id = ? AND retry_of_id IN ?", userID, batch).Update("retry_of_id", nil).Error; err != nil {
				return err
			}

			deletedEvents := tx.Where("user_id = ? AND task_run_id IN ?", userID, batch).Delete(&TaskEvent{})
			if deletedEvents.Error != nil {
				return deletedEvents.Error
			}
			result.DeletedEvents += deletedEvents.RowsAffected

			deletedRuns := tx.Where("user_id = ? AND id IN ? AND status IN ?", userID, batch, terminalTaskStatuses()).Delete(&TaskRun{})
			if deletedRuns.Error != nil {
				return deletedRuns.Error
			}
			result.DeletedCount += deletedRuns.RowsAffected
		}
		return nil
	})
	return result, err
}

func terminalTaskStatuses() []Status {
	return []Status{StatusSucceeded, StatusFailed, StatusPartialSuccess, StatusCanceled, StatusTimeout}
}

type taskNotification struct {
	ID uuid.UUID
}

func (taskNotification) TableName() string { return "inbox_notifications" }

type taskNotificationDelivery struct {
	ID uint
}

func (taskNotificationDelivery) TableName() string { return "notification_deliveries" }
