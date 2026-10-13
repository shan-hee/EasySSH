package jobqueue

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Status string

const (
	StatusQueued    Status = "queued"
	StatusClaimed   Status = "claimed"
	StatusRunning   Status = "running"
	StatusSucceeded Status = "succeeded"
	StatusFailed    Status = "failed"
	StatusCancelled Status = "cancelled"
)

type Job struct {
	ID          uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	Kind        string    `gorm:"size:80;not null;index" json:"kind"`
	SourceType  string    `gorm:"size:80;not null;index:idx_job_queue_source,priority:1" json:"source_type"`
	SourceID    string    `gorm:"size:191;not null;index:idx_job_queue_source,priority:2" json:"source_id"`
	DedupeKey   *string   `gorm:"size:191;uniqueIndex" json:"dedupe_key,omitempty"`
	PayloadJSON string    `gorm:"type:text;not null" json:"payload_json"`

	Status      Status    `gorm:"size:20;not null;index:idx_job_queue_claim,priority:1" json:"status"`
	Priority    int       `gorm:"not null;default:0;index:idx_job_queue_claim,priority:2,sort:desc" json:"priority"`
	AvailableAt time.Time `gorm:"not null;index:idx_job_queue_claim,priority:3" json:"available_at"`

	ClaimedBy      string     `gorm:"size:191;index" json:"claimed_by,omitempty"`
	ClaimedAt      *time.Time `json:"claimed_at,omitempty"`
	HeartbeatAt    *time.Time `json:"heartbeat_at,omitempty"`
	LeaseExpiresAt *time.Time `gorm:"index" json:"lease_expires_at,omitempty"`

	Attempt     int `gorm:"not null;default:0" json:"attempt"`
	MaxAttempts int `gorm:"not null;default:3" json:"max_attempts"`

	LastError  string     `gorm:"type:text" json:"last_error,omitempty"`
	FinishedAt *time.Time `gorm:"index" json:"finished_at,omitempty"`
	CreatedAt  time.Time  `gorm:"index" json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

func (Job) TableName() string { return "job_queue" }

func (j *Job) BeforeCreate(*gorm.DB) error {
	if j.ID == uuid.Nil {
		j.ID = uuid.New()
	}
	if j.Status == "" {
		j.Status = StatusQueued
	}
	if j.AvailableAt.IsZero() {
		j.AvailableAt = time.Now()
	}
	if j.MaxAttempts < 1 {
		j.MaxAttempts = 3
	}
	return nil
}

type EnqueueOptions struct {
	AvailableAt time.Time
	MaxAttempts int
	Priority    int
	DedupeKey   string
}
