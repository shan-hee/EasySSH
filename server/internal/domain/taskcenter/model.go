package taskcenter

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Status string

const (
	StatusQueued         Status = "queued"
	StatusRunning        Status = "running"
	StatusSucceeded      Status = "succeeded"
	StatusFailed         Status = "failed"
	StatusPartialSuccess Status = "partial_success"
	StatusCanceling      Status = "canceling"
	StatusCanceled       Status = "canceled"
	StatusTimeout        Status = "timeout"
)

type TriggerType string

const (
	TriggerManual    TriggerType = "manual"
	TriggerScheduled TriggerType = "scheduled"
	TriggerSystem    TriggerType = "system"
	TriggerAPI       TriggerType = "api"
)

type TaskRun struct {
	ID           uuid.UUID   `gorm:"type:char(36);primaryKey" json:"id"`
	UserID       uuid.UUID   `gorm:"type:char(36);not null;index;index:idx_task_runs_user_time,priority:1" json:"user_id"`
	DefinitionID *uuid.UUID  `gorm:"type:char(36);index" json:"definition_id,omitempty"`
	RetryOfID    *uuid.UUID  `gorm:"type:char(36);index" json:"retry_of_id,omitempty"`
	SourceType   string      `gorm:"size:50;index:idx_task_runs_source,priority:1" json:"source_type,omitempty"`
	SourceID     string      `gorm:"size:80;index:idx_task_runs_source,priority:2" json:"source_id,omitempty"`
	TaskType     string      `gorm:"size:50;not null;index" json:"task_type"`
	Title        string      `gorm:"size:180;not null" json:"title"`
	Description  string      `gorm:"type:text" json:"description,omitempty"`
	TriggerType  TriggerType `gorm:"size:30;not null;index" json:"trigger_type"`
	Runner       string      `gorm:"size:30;not null;default:'server'" json:"runner"`
	Status       Status      `gorm:"size:30;not null;index" json:"status"`
	Stage        string      `gorm:"size:50;index" json:"stage,omitempty"`

	ServerID    *uuid.UUID `gorm:"type:char(36);index" json:"server_id,omitempty"`
	ServerName  string     `gorm:"size:120" json:"server_name,omitempty"`
	Resource    string     `gorm:"type:text" json:"resource,omitempty"`
	PayloadJSON string     `gorm:"type:text" json:"payload_json,omitempty"`
	ResultJSON  string     `gorm:"type:text" json:"result_json,omitempty"`

	Progress       int    `gorm:"default:0" json:"progress"`
	TotalCount     int    `gorm:"default:0" json:"total_count"`
	SuccessCount   int    `gorm:"default:0" json:"success_count"`
	FailureCount   int    `gorm:"default:0" json:"failure_count"`
	BytesTotal     int64  `gorm:"default:0" json:"bytes_total"`
	BytesProcessed int64  `gorm:"default:0" json:"bytes_processed"`
	ProgressJSON   string `gorm:"type:text" json:"progress_json,omitempty"`

	Cancelable  bool `gorm:"not null;default:false" json:"cancelable"`
	Retryable   bool `gorm:"not null;default:false" json:"retryable"`
	Attempt     int  `gorm:"not null;default:1" json:"attempt"`
	MaxAttempts int  `gorm:"not null;default:1" json:"max_attempts"`

	ErrorCode         string     `gorm:"size:80" json:"error_code,omitempty"`
	ErrorMessage      string     `gorm:"type:text" json:"error_message,omitempty"`
	CancelRequestedAt *time.Time `json:"cancel_requested_at,omitempty"`
	StartedAt         *time.Time `gorm:"index" json:"started_at,omitempty"`
	FinishedAt        *time.Time `gorm:"index" json:"finished_at,omitempty"`
	CreatedAt         time.Time  `gorm:"index;index:idx_task_runs_user_time,priority:2,sort:desc" json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

func (TaskRun) TableName() string { return "task_runs" }

func (r *TaskRun) BeforeCreate(_ *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	if r.Status == "" {
		r.Status = StatusQueued
	}
	if r.TriggerType == "" {
		r.TriggerType = TriggerManual
	}
	if r.Runner == "" {
		r.Runner = "server"
	}
	if r.Attempt < 1 {
		r.Attempt = 1
	}
	if r.MaxAttempts < 1 {
		r.MaxAttempts = 1
	}
	return nil
}

type TaskEvent struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	TaskRunID uuid.UUID `gorm:"type:char(36);not null;index" json:"task_run_id"`
	UserID    uuid.UUID `gorm:"type:char(36);not null;index" json:"user_id"`
	Level     string    `gorm:"size:20;not null;default:'info'" json:"level"`
	Message   string    `gorm:"type:text;not null" json:"message"`
	DataJSON  string    `gorm:"type:text" json:"data_json,omitempty"`
	CreatedAt time.Time `gorm:"index" json:"created_at"`
}

func (TaskEvent) TableName() string { return "task_events" }

type ListRequest struct {
	UserID       uuid.UUID
	Statuses     []Status
	TaskTypes    []string
	TriggerTypes []TriggerType
	Keyword      string
	Page         int
	PageSize     int
}

type ListResponse struct {
	Runs       []*TaskRun `json:"runs"`
	Total      int64      `json:"total"`
	Page       int        `json:"page"`
	PageSize   int        `json:"page_size"`
	TotalPages int        `json:"total_pages"`
}

type Statistics struct {
	Total          int64 `json:"total"`
	Queued         int64 `json:"queued"`
	Running        int64 `json:"running"`
	Canceling      int64 `json:"canceling"`
	Succeeded      int64 `json:"succeeded"`
	Failed         int64 `json:"failed"`
	PartialSuccess int64 `json:"partial_success"`
	Canceled       int64 `json:"canceled"`
	Timeout        int64 `json:"timeout"`
}

type CleanupResult struct {
	DeletedCount         int64       `json:"deleted_count"`
	DeletedEvents        int64       `json:"deleted_events"`
	DeletedNotifications int64       `json:"deleted_notifications"`
	AffectedUserIDs      []uuid.UUID `json:"-"`
}
