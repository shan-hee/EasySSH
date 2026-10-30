package taskcenter

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

// One durable delivery table holds completion preparation and external channels.
// Terminal source writers enqueue preparation in their own transaction. The
// notification worker replaces that pending stage with the selected channels.
type NotificationDelivery struct {
	SourceType     string     `gorm:"size:50;not null;index:idx_notification_delivery_source,priority:1" json:"-"`
	SourceID       string     `gorm:"size:80;not null;index:idx_notification_delivery_source,priority:2" json:"-"`
	ID             uint       `gorm:"primaryKey" json:"id"`
	NotificationID uuid.UUID  `gorm:"type:char(36);not null;uniqueIndex:idx_notification_channel,priority:1" json:"notification_id"`
	Channel        string     `gorm:"size:30;not null;uniqueIndex:idx_notification_channel,priority:2" json:"channel"`
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

func (NotificationDelivery) TableName() string { return "notification_deliveries" }

func (d *NotificationDelivery) BeforeCreate(_ *gorm.DB) error {
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

func enqueueCompletion(tx *gorm.DB, run *TaskRun) error {
	if !isTerminalStatus(run.Status) {
		return nil
	}
	item := NotificationDelivery{NotificationID: uuid.NewSHA1(uuid.NameSpaceOID, []byte("task-completion:"+run.ID.String())), SourceType: "task_run", SourceID: run.ID.String(), Channel: "completion", Status: "queued", PayloadJSON: "", MaxAttempts: 5, NextAttemptAt: time.Now().UTC()}
	return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "notification_id"}, {Name: "channel"}}, DoNothing: true}).Create(&item).Error
}
