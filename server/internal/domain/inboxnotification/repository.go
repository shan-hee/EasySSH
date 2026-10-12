package inboxnotification

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository interface {
	Create(ctx context.Context, notification *Notification) error
	List(ctx context.Context, req *ListRequest) (*ListResponse, error)
	MarkRead(ctx context.Context, userID, id uuid.UUID) error
	MarkAllRead(ctx context.Context, userID uuid.UUID) error
	Delete(ctx context.Context, userID, id uuid.UUID) error
	ClearRead(ctx context.Context, userID uuid.UUID) error
}

type repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) Repository { return &repository{db: db} }

func (r *repository) Create(ctx context.Context, notification *Notification) error {
	return r.db.WithContext(ctx).Create(notification).Error
}

func (r *repository) List(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	base := r.db.WithContext(ctx).Model(&Notification{}).Where("user_id = ?", req.UserID)
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
	if err := r.db.WithContext(ctx).Model(&Notification{}).Where("user_id = ? AND read_at IS NULL", req.UserID).Count(&unread).Error; err != nil {
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

func (r *repository) MarkRead(ctx context.Context, userID, id uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&Notification{}).Where("id = ? AND user_id = ? AND read_at IS NULL", id, userID).Update("read_at", &now).Error
}

func (r *repository) MarkAllRead(ctx context.Context, userID uuid.UUID) error {
	now := time.Now()
	return r.db.WithContext(ctx).Model(&Notification{}).Where("user_id = ? AND read_at IS NULL", userID).Update("read_at", &now).Error
}

func (r *repository) Delete(ctx context.Context, userID, id uuid.UUID) error {
	return r.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).Delete(&Notification{}).Error
}

func (r *repository) ClearRead(ctx context.Context, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Where("user_id = ? AND read_at IS NOT NULL", userID).Delete(&Notification{}).Error
}
