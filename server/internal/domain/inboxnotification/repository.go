package inboxnotification

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"gorm.io/gorm/clause"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository interface {
	Create(ctx context.Context, notification *Notification) error
	CompletionTask(context.Context, *Delivery) (*taskcenter.TaskRun, error)
	CommitCompletion(context.Context, *Delivery, *Notification, bool, []*Delivery) (bool, error)
	UpdateDelivery(ctx context.Context, id uint, updates map[string]interface{}) error
	ClaimDueDeliveries(ctx context.Context, now, staleBefore time.Time, limit int) ([]Delivery, error)
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	MarkRead(ctx context.Context, ownerID, id uuid.UUID) error
	MarkAllRead(ctx context.Context, ownerID uuid.UUID) error
	Delete(ctx context.Context, ownerID, id uuid.UUID) error
	ClearRead(ctx context.Context, ownerID uuid.UUID) error
}

type repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) Repository { return &repository{db: db} }

func (r *repository) Create(ctx context.Context, notification *Notification) error {
	return r.db.WithContext(ctx).Create(notification).Error
}

func (r *repository) CompletionTask(ctx context.Context, delivery *Delivery) (*taskcenter.TaskRun, error) {
	var run taskcenter.TaskRun
	if delivery.SourceType != "task_run" {
		return nil, errors.New("invalid completion source")
	}
	err := r.db.WithContext(ctx).Select("id,task_type,title,status,resource,success_count,failure_count,error_message,started_at,finished_at").Where("id=? AND status IN ?", delivery.SourceID, []taskcenter.Status{taskcenter.StatusSucceeded, taskcenter.StatusFailed, taskcenter.StatusPartialSuccess, taskcenter.StatusCanceled, taskcenter.StatusTimeout, taskcenter.StatusUnknown}).First(&run).Error
	return &run, err
}

// Inbox insertion, external-channel enqueue and preparation settlement are one
// transaction. Repeating it cannot duplicate a notification or recreate a read item.
func (r *repository) CommitCompletion(ctx context.Context, delivery *Delivery, item *Notification, inApp bool, channels []*Delivery) (bool, error) {
	created := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var pending Delivery
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND channel='completion' AND status='sending'", delivery.ID).First(&pending).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&taskcenter.TaskRun{}).Where("id=?", pending.SourceID).Count(&count).Error; err != nil {
			return err
		}
		if count == 1 && item != nil {
			if item.ID != pending.NotificationID || item.SourceType != pending.SourceType || item.SourceID != pending.SourceID {
				return errors.New("completion notification source mismatch")
			}
			if inApp {
				result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoNothing: true}).Create(item)
				if result.Error != nil {
					return result.Error
				}
				created = result.RowsAffected == 1
			}
			for _, channel := range channels {
				if channel.NotificationID != pending.NotificationID || channel.SourceID != pending.SourceID || channel.SourceType != pending.SourceType || channel.Channel == "completion" {
					return errors.New("invalid completion channel")
				}
				candidate := *channel
				candidate.ID = 0
				if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "notification_id"}, {Name: "channel"}}, DoNothing: true}).Create(&candidate).Error; err != nil {
					return err
				}
			}
		}
		return tx.Model(&Delivery{}).Where("id=?", pending.ID).Updates(map[string]any{"status": "sent", "sent_at": time.Now().UTC(), "locked_at": nil, "error_message": ""}).Error
	})
	return created && err == nil, err
}

func (r *repository) UpdateDelivery(ctx context.Context, id uint, updates map[string]interface{}) error {
	return r.db.WithContext(ctx).Model(&Delivery{}).Where("id = ? AND status = ?", id, "sending").Updates(updates).Error
}

func (r *repository) ClaimDueDeliveries(ctx context.Context, now, staleBefore time.Time, limit int) ([]Delivery, error) {
	if limit < 1 {
		limit = 20
	}
	db := r.db.WithContext(ctx)
	if err := db.Model(&Delivery{}).
		Where("status = ? AND locked_at IS NOT NULL AND locked_at < ?", "sending", staleBefore).
		Updates(map[string]interface{}{"status": gorm.Expr("CASE WHEN channel <> 'completion' AND attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END"), "locked_at": nil, "next_attempt_at": now, "error_message": "delivery interrupted before its result was saved"}).Error; err != nil {
		return nil, err
	}

	var candidates []Delivery
	if err := db.Where("status = ? AND next_attempt_at <= ? AND (channel = 'completion' OR attempt_count < max_attempts)", "queued", now).
		Order("next_attempt_at ASC, id ASC").Limit(limit).Find(&candidates).Error; err != nil {
		return nil, err
	}

	claimed := make([]Delivery, 0, len(candidates))
	for _, candidate := range candidates {
		result := db.Model(&Delivery{}).
			Where("id = ? AND status = ? AND next_attempt_at <= ? AND (channel = 'completion' OR attempt_count < max_attempts)", candidate.ID, "queued", now).
			Updates(map[string]interface{}{
				"status":          "sending",
				"locked_at":       now,
				"last_attempt_at": now,
				"attempt_count":   gorm.Expr("attempt_count + 1"),
			})
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 0 {
			continue
		}
		var delivery Delivery
		if err := db.First(&delivery, candidate.ID).Error; err != nil {
			return nil, err
		}
		claimed = append(claimed, delivery)
	}
	return claimed, nil
}

func (r *repository) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	base := r.db.WithContext(ctx).Model(&Notification{}).Where("owner_id = ?", req.OwnerID)
	if req.Unread != nil {
		if *req.Unread {
			base = base.Where("read_at IS NULL")
		} else {
			base = base.Where("read_at IS NOT NULL")
		}
	}
	if req.Severity != "" {
		base = base.Where("severity = ?", req.Severity)
	}
	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, err
	}
	var unread int64
	if err := r.db.WithContext(ctx).Model(&Notification{}).Where("owner_id = ? AND read_at IS NULL", req.OwnerID).Count(&unread).Error; err != nil {
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
	var items []*Notification
	if err := base.Order("created_at DESC").Offset((req.Page - 1) * req.PageSize).Limit(req.PageSize).Find(&items).Error; err != nil {
		return nil, err
	}
	pages := int(total) / req.PageSize
	if int(total)%req.PageSize != 0 {
		pages++
	}
	return &ListResponse{Notifications: items, UnreadCount: unread, Total: total, Page: req.Page, PageSize: req.PageSize, TotalPages: pages}, nil
}

func (r *repository) MarkRead(ctx context.Context, ownerID, id uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&Notification{}).Where("id = ? AND owner_id = ? AND read_at IS NULL", id, ownerID).Update("read_at", &now).Error
}

func (r *repository) MarkAllRead(ctx context.Context, ownerID uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&Notification{}).Where("owner_id = ? AND read_at IS NULL", ownerID).Update("read_at", &now).Error
}

func (r *repository) Delete(ctx context.Context, ownerID, id uuid.UUID) error {
	return r.db.WithContext(ctx).Where("id = ? AND owner_id = ?", id, ownerID).Delete(&Notification{}).Error
}

func (r *repository) ClearRead(ctx context.Context, ownerID uuid.UUID) error {
	return r.db.WithContext(ctx).Where("owner_id = ? AND read_at IS NOT NULL", ownerID).Delete(&Notification{}).Error
}
