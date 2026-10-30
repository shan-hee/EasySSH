package taskcenter

import (
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Status = protocol.TaskRunStatus

const (
	StatusQueued         = protocol.TaskStatusQueued
	StatusRunning        = protocol.TaskStatusRunning
	StatusSucceeded      = protocol.TaskStatusSucceeded
	StatusFailed         = protocol.TaskStatusFailed
	StatusPartialSuccess = protocol.TaskStatusPartialSuccess
	StatusCanceling      = protocol.TaskStatusCanceling
	StatusCanceled       = protocol.TaskStatusCanceled
	StatusTimeout        = protocol.TaskStatusTimeout
	StatusUnknown        = protocol.TaskStatusUnknown
)

type TriggerType = protocol.TaskTriggerType

const (
	TriggerManual    = protocol.TaskTriggerManual
	TriggerScheduled = protocol.TaskTriggerScheduled
	TriggerSystem    = protocol.TaskTriggerSystem
	TriggerAPI       = protocol.TaskTriggerAPI
)

type TaskRun struct {
	ContentID     *uuid.UUID `gorm:"type:char(36);index" json:"-"`
	ContentSize   int64      `gorm:"not null;default:0" json:"-"`
	ContentSHA256 string     `gorm:"size:64;not null;default:''" json:"-"`

	WorkID        uuid.UUID  `gorm:"type:char(36);not null;index;uniqueIndex:idx_task_work_attempt,priority:1" json:"work_id"`
	ParentWorkID  *uuid.UUID `gorm:"type:char(36);index" json:"parent_work_id,omitempty"`
	WorkStartedAt time.Time  `gorm:"not null;index" json:"work_started_at"`

	Actor             protocol.Actor `gorm:"embedded;embeddedPrefix:actor_" json:"actor"`
	ID                uuid.UUID      `gorm:"type:char(36);primaryKey" json:"id"`
	DefinitionVersion string         `gorm:"size:36" json:"definition_version,omitempty"`
	DefinitionID      *uuid.UUID     `gorm:"type:char(36);index" json:"definition_id,omitempty"`
	RetryOfID         *uuid.UUID     `gorm:"type:char(36);index" json:"retry_of_id,omitempty"`
	SourceType        string         `gorm:"size:50;index:idx_task_runs_source,priority:1" json:"source_type,omitempty"`
	SourceID          string         `gorm:"size:80;index:idx_task_runs_source,priority:2" json:"source_id,omitempty"`
	TaskType          string         `gorm:"size:50;not null;index" json:"task_type"`
	Title             string         `gorm:"size:180;not null" json:"title"`
	Description       string         `gorm:"type:text" json:"description,omitempty"`
	TriggerType       TriggerType    `gorm:"size:30;not null;index" json:"trigger_type"`
	Runner            string         `gorm:"size:30;not null;default:'server'" json:"runner"`
	Status            Status         `gorm:"size:30;not null;index" json:"status"`
	Stage             string         `gorm:"size:50;index" json:"stage,omitempty"`

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
	Attempt     int  `gorm:"not null;default:1;uniqueIndex:idx_task_work_attempt,priority:2" json:"attempt"`
	MaxAttempts int  `gorm:"not null;default:1" json:"max_attempts"`

	ErrorCode         string     `gorm:"size:80" json:"error_code,omitempty"`
	ErrorMessage      string     `gorm:"type:text" json:"error_message,omitempty"`
	CancelRequestedAt *time.Time `json:"cancel_requested_at,omitempty"`
	StartedAt         *time.Time `gorm:"index" json:"started_at,omitempty"`
	FinishedAt        *time.Time `gorm:"index" json:"finished_at,omitempty"`
	CreatedAt         time.Time  `gorm:"index" json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

func (TaskRun) TableName() string { return "task_runs" }

func (r *TaskRun) BeforeCreate(_ *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	if r.CreatedAt.IsZero() {
		r.CreatedAt = time.Now().UTC()
	}
	if r.WorkID == uuid.Nil {
		r.WorkID = r.ID
	}
	if r.WorkStartedAt.IsZero() {
		r.WorkStartedAt = r.CreatedAt
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
	ContentID     *uuid.UUID `gorm:"type:char(36);index" json:"-"`
	ContentSize   int64      `gorm:"not null;default:0" json:"-"`
	ContentSHA256 string     `gorm:"size:64;not null;default:''" json:"-"`
	ID            uint       `gorm:"primaryKey;index:idx_task_events_run_cursor,priority:2" json:"id"`
	TaskRunID     uuid.UUID  `gorm:"type:char(36);not null;index:idx_task_events_run_cursor,priority:1" json:"task_run_id"`
	Level         string     `gorm:"size:20;not null;default:'info'" json:"level"`
	Message       string     `gorm:"type:text;not null" json:"message"`
	DataJSON      string     `gorm:"type:text" json:"data_json,omitempty"`
	CreatedAt     time.Time  `gorm:"index" json:"created_at"`
}

func (TaskEvent) TableName() string { return "task_events" }

type ListRequest struct {
	Statuses     []Status
	TaskTypes    []string
	TriggerTypes []TriggerType
	Keyword      string
	Page         int
	PageSize     int
}

type ListResponse struct {
	Runs       []*TaskRunSummary `json:"runs"`
	Total      int64             `json:"total"`
	Page       int               `json:"page"`
	PageSize   int               `json:"page_size"`
	TotalPages int               `json:"total_pages"`
}

// TaskRunSummary 是列表所需的轻量视图。任务输入、结果和进度明细只由详情接口返回。
type TaskRunSummary struct {
	WorkID        uuid.UUID  `gorm:"type:char(36);not null;index" json:"work_id"`
	ParentWorkID  *uuid.UUID `gorm:"type:char(36);index" json:"parent_work_id,omitempty"`
	WorkStartedAt time.Time  `gorm:"not null;index" json:"work_started_at"`

	Actor             protocol.Actor `gorm:"embedded;embeddedPrefix:actor_" json:"actor"`
	ID                uuid.UUID      `json:"id"`
	DefinitionID      *uuid.UUID     `json:"definition_id,omitempty"`
	RetryOfID         *uuid.UUID     `json:"retry_of_id,omitempty"`
	SourceType        string         `json:"source_type,omitempty"`
	SourceID          string         `json:"source_id,omitempty"`
	TaskType          string         `json:"task_type"`
	Title             string         `json:"title"`
	TriggerType       TriggerType    `json:"trigger_type"`
	Runner            string         `json:"runner"`
	Status            Status         `json:"status"`
	Stage             string         `json:"stage,omitempty"`
	ServerID          *uuid.UUID     `json:"server_id,omitempty"`
	ServerName        string         `json:"server_name,omitempty"`
	Resource          string         `json:"resource,omitempty"`
	Progress          int            `json:"progress"`
	TotalCount        int            `json:"total_count"`
	SuccessCount      int            `json:"success_count"`
	FailureCount      int            `json:"failure_count"`
	BytesTotal        int64          `json:"bytes_total"`
	BytesProcessed    int64          `json:"bytes_processed"`
	Cancelable        bool           `json:"cancelable"`
	Retryable         bool           `json:"retryable"`
	Attempt           int            `json:"attempt"`
	MaxAttempts       int            `json:"max_attempts"`
	ErrorCode         string         `json:"error_code,omitempty"`
	ErrorMessage      string         `json:"error_message,omitempty"`
	CancelRequestedAt *time.Time     `json:"cancel_requested_at,omitempty"`
	StartedAt         *time.Time     `json:"started_at,omitempty"`
	FinishedAt        *time.Time     `json:"finished_at,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
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
	Unknown        int64 `json:"unknown"`
}

type CleanupResult struct {
	DeletedCount         int64            `json:"deleted_count"`
	DeletedEvents        int64            `json:"deleted_events"`
	DeletedNotifications int64            `json:"deleted_notifications"`
	AffectedActors       []protocol.Actor `json:"-"`
}
