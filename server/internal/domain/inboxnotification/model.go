package inboxnotification

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Notification struct {
	ID         uuid.UUID  `gorm:"type:char(36);primaryKey" json:"id"`
	UserID     uuid.UUID  `gorm:"type:char(36);not null;index;index:idx_inbox_user_time,priority:1" json:"user_id"`
	EventType  string     `gorm:"size:60;not null;index" json:"event_type"`
	Severity   string     `gorm:"size:20;not null;index" json:"severity"`
	Title      string     `gorm:"size:180;not null" json:"title"`
	Message    string     `gorm:"type:text;not null" json:"message"`
	SourceType string     `gorm:"size:50;index" json:"source_type,omitempty"`
	SourceID   string     `gorm:"size:80;index" json:"source_id,omitempty"`
	ActionURL  string     `gorm:"type:text" json:"action_url,omitempty"`
	DataJSON   string     `gorm:"type:text" json:"data_json,omitempty"`
	ReadAt     *time.Time `gorm:"index" json:"read_at,omitempty"`
	CreatedAt  time.Time  `gorm:"index;index:idx_inbox_user_time,priority:2,sort:desc" json:"created_at"`
}

func (Notification) TableName() string { return "inbox_notifications" }

func (n *Notification) BeforeCreate(_ *gorm.DB) error {
	if n.ID == uuid.Nil {
		n.ID = uuid.New()
	}
	if n.Severity == "" {
		n.Severity = "info"
	}
	return nil
}

type Delivery struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	NotificationID uuid.UUID  `gorm:"type:char(36);not null;index" json:"notification_id"`
	UserID         uuid.UUID  `gorm:"type:char(36);not null;index" json:"user_id"`
	Channel        string     `gorm:"size:30;not null;index" json:"channel"`
	Status         string     `gorm:"size:20;not null;index:idx_notification_delivery_due,priority:1" json:"status"`
	PayloadJSON    string     `gorm:"type:text;not null" json:"-"`
	AttemptCount   int        `gorm:"not null;default:0" json:"attempt_count"`
	MaxAttempts    int        `gorm:"not null;default:5" json:"max_attempts"`
	NextAttemptAt  time.Time  `gorm:"not null;index:idx_notification_delivery_due,priority:2" json:"next_attempt_at"`
	LastAttemptAt  *time.Time `json:"last_attempt_at,omitempty"`
	LockedAt       *time.Time `gorm:"index" json:"locked_at,omitempty"`
	ErrorMessage   string     `gorm:"type:text" json:"error_message,omitempty"`
	SentAt         *time.Time `json:"sent_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

func (Delivery) TableName() string { return "notification_deliveries" }

func (d *Delivery) BeforeCreate(_ *gorm.DB) error {
	if d.Status == "" {
		d.Status = "queued"
	}
	if d.MaxAttempts < 1 {
		d.MaxAttempts = 5
	}
	if d.NextAttemptAt.IsZero() {
		d.NextAttemptAt = time.Now()
	}
	return nil
}

type ListRequest struct {
	UserID   uuid.UUID
	Unread   *bool
	Severity string
	Page     int
	PageSize int
}

type ListResponse struct {
	Notifications []*Notification `json:"notifications"`
	UnreadCount   int64           `json:"unread_count"`
	Total         int64           `json:"total"`
	Page          int             `json:"page"`
	PageSize      int             `json:"page_size"`
	TotalPages    int             `json:"total_pages"`
}
