package transferjob

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type JobKind string

const (
	JobKindSFTPUpload   JobKind = "sftp_upload"
	JobKindSFTPDownload JobKind = "sftp_download"
	JobKindSFTPTransfer JobKind = "sftp_transfer"
)

type JobStatus string

const (
	JobStatusCreated   JobStatus = "created"
	JobStatusStaging   JobStatus = "staging"
	JobStatusQueued    JobStatus = "queued"
	JobStatusRunning   JobStatus = "running"
	JobStatusCompleted JobStatus = "completed"
	JobStatusFailed    JobStatus = "failed"
	JobStatusCancelled JobStatus = "cancelled"
	JobStatusExpired   JobStatus = "expired"
)

type JobStage string

const (
	JobStageStaging            JobStage = "staging"
	JobStageTransferToRemote   JobStage = "transfer_to_remote"
	JobStageDownloadFromRemote JobStage = "download_from_remote"
	JobStageReadyForDownload   JobStage = "ready_for_download"
	JobStageCleanup            JobStage = "cleanup"
)

type TransferJob struct {
	ID     uuid.UUID `gorm:"type:char(36);primary_key" json:"id"`
	UserID uuid.UUID `gorm:"type:char(36);not null;index;index:idx_transfer_jobs_user_time,priority:1" json:"user_id"`

	Name        string    `gorm:"size:160;not null" json:"name"`
	Kind        JobKind   `gorm:"type:varchar(40);not null;index" json:"kind"`
	Runner      string    `gorm:"size:30;not null;default:'server'" json:"runner"`
	Status      JobStatus `gorm:"type:varchar(30);not null;index" json:"status"`
	Stage       JobStage  `gorm:"type:varchar(40);not null;index" json:"stage"`
	Description string    `gorm:"type:text" json:"description"`

	SourceServerID *uuid.UUID `gorm:"type:char(36);index" json:"source_server_id,omitempty"`
	TargetServerID *uuid.UUID `gorm:"type:char(36);index" json:"target_server_id,omitempty"`
	SourcePath     string     `gorm:"type:text" json:"source_path"`
	TargetPath     string     `gorm:"type:text" json:"target_path"`
	FileName       string     `gorm:"size:255" json:"file_name"`

	ArtifactName      string     `gorm:"size:255" json:"artifact_name"`
	ArtifactPath      string     `gorm:"type:text" json:"-"`
	ArtifactSize      int64      `gorm:"default:0" json:"artifact_size"`
	ArtifactManaged   bool       `gorm:"not null;default:true" json:"artifact_managed"`
	ArtifactExpiresAt *time.Time `gorm:"index" json:"artifact_expires_at,omitempty"`

	Progress       int   `gorm:"default:0" json:"progress"`
	BytesTotal     int64 `gorm:"default:0" json:"bytes_total"`
	BytesProcessed int64 `gorm:"default:0" json:"bytes_processed"`
	SpeedBps       int64 `gorm:"default:0" json:"speed_bps"`

	RetryCount      int        `gorm:"default:0" json:"retry_count"`
	MaxRetries      int        `gorm:"default:0" json:"max_retries"`
	ScheduledTaskID *uuid.UUID `gorm:"type:char(36);index" json:"scheduled_task_id,omitempty"`
	ErrorMessage    string     `gorm:"type:text" json:"error_message,omitempty"`
	DetailJSON      string     `gorm:"type:text" json:"detail_json,omitempty"`

	StartedAt  *time.Time     `gorm:"index" json:"started_at,omitempty"`
	FinishedAt *time.Time     `gorm:"index" json:"finished_at,omitempty"`
	CreatedAt  time.Time      `gorm:"index;index:idx_transfer_jobs_user_time,priority:2,sort:desc" json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"index" json:"-"`
}

func (TransferJob) TableName() string {
	return "transfer_jobs"
}

func (j *TransferJob) BeforeCreate(tx *gorm.DB) error {
	if j.ID == uuid.Nil {
		j.ID = uuid.New()
	}
	return nil
}

type CreateUploadRequest struct {
	Name            string     `json:"name"`
	ServerID        string     `json:"server_id" binding:"required"`
	TargetPath      string     `json:"target_path" binding:"required"`
	FileName        string     `json:"file_name"`
	FileSize        int64      `json:"file_size"`
	RetentionDays   int        `json:"retention_days"`
	Description     string     `json:"description"`
	DeferStart      bool       `json:"defer_start"`
	ScheduledTaskID *uuid.UUID `json:"scheduled_task_id,omitempty"`
}

type CreateDownloadRequest struct {
	Name            string     `json:"name"`
	ServerID        string     `json:"server_id" binding:"required"`
	SourcePath      string     `json:"source_path" binding:"required"`
	RetentionDays   int        `json:"retention_days"`
	Description     string     `json:"description"`
	ScheduledTaskID *uuid.UUID `json:"scheduled_task_id,omitempty"`
}

type ListRequest struct {
	UserID   uuid.UUID
	Kind     JobKind
	Status   JobStatus
	Page     int
	PageSize int
}

type ListResponse struct {
	Jobs       []*TransferJob `json:"jobs"`
	Total      int64          `json:"total"`
	Page       int            `json:"page"`
	PageSize   int            `json:"page_size"`
	TotalPages int            `json:"total_pages"`
}

type Statistics struct {
	Total          int64 `json:"total"`
	Queued         int64 `json:"queued"`
	Running        int64 `json:"running"`
	Completed      int64 `json:"completed"`
	Failed         int64 `json:"failed"`
	Cancelled      int64 `json:"cancelled"`
	Expired        int64 `json:"expired"`
	BytesTotal     int64 `json:"bytes_total"`
	BytesProcessed int64 `json:"bytes_processed"`
	StorageBytes   int64 `json:"storage_bytes"`
}

type ScheduledPayload struct {
	ServerID      string `json:"server_id,omitempty"`
	SourcePath    string `json:"source_path,omitempty"`
	TargetPath    string `json:"target_path,omitempty"`
	StagedJobID   string `json:"staged_job_id,omitempty"`
	Name          string `json:"name,omitempty"`
	Description   string `json:"description,omitempty"`
	RetentionDays int    `json:"retention_days,omitempty"`
	ArtifactJobID string `json:"artifact_job_id,omitempty"`
}

type RunScheduledRequest struct {
	UserID          uuid.UUID
	ScheduledTaskID uuid.UUID
	TaskName        string
	TaskType        string
	PayloadJSON     string
}
