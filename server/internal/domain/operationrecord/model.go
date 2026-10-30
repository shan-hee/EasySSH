package operationrecord

import (
	"github.com/easyssh/shared/activitystats"
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type RecordType = activitystats.Kind

const (
	TypeConnection RecordType = "connection"
	TypeTransfer   RecordType = "transfer"
	TypeExecution  RecordType = "execution"
	TypeAudit      RecordType = "audit"
)

type Category = protocol.ActivityCategory

const (
	CategoryActivity Category = "activity"
	CategoryAudit    Category = "audit"
)

type Status = activitystats.Status

const (
	StatusPending  Status = "pending"
	StatusRunning  Status = "running"
	StatusSuccess  Status = "success"
	StatusFailure  Status = "failure"
	StatusPartial  Status = "partial"
	StatusCanceled Status = "canceled"
	StatusTimeout  Status = "timeout"
	StatusWarning  Status = "warning"
	StatusUnknown  Status = "unknown"
)

// OperationRecord 统一承载连接、传输、执行等用户操作型历史。
type OperationRecord struct {
	DetailContentID     *uuid.UUID                 `gorm:"type:char(36);index" json:"-"`
	DetailContentSize   int64                      `gorm:"not null;default:0" json:"-"`
	DetailContentSHA256 string                     `gorm:"size:64;not null;default:''" json:"-"`
	DetailContent       *protocol.ContentReference `gorm:"-" json:"detail_content,omitempty"`

	TaskContentID     *uuid.UUID                 `gorm:"type:char(36);index" json:"-"`
	TaskContentSize   int64                      `gorm:"not null;default:0" json:"-"`
	TaskContentSHA256 string                     `gorm:"size:64;not null;default:''" json:"-"`
	TaskContent       *protocol.ContentReference `gorm:"-" json:"task_content,omitempty"`

	WorkID                   uuid.UUID  `gorm:"type:char(36);not null;index" json:"work_id"`
	ParentWorkID             *uuid.UUID `gorm:"type:char(36);index" json:"parent_work_id,omitempty"`
	WorkStartedAt            time.Time  `gorm:"not null;index" json:"work_started_at"`
	Attempt                  int        `gorm:"not null" json:"attempt"`
	EstablishedAt            *time.Time `json:"established_at,omitempty"`
	ConnectionUncertainUntil *time.Time `json:"connection_uncertain_until,omitempty"`

	Resources []ResourceSnapshot `gorm:"-" json:"resources,omitempty"`
	Actor     protocol.Actor     `gorm:"embedded;embeddedPrefix:actor_" json:"actor"`
	ID        uuid.UUID          `gorm:"type:char(36);primary_key" json:"id"`

	Username string     `gorm:"size:50" json:"username"`
	Type     RecordType `gorm:"type:varchar(30);not null;index:idx_operation_type_time,priority:1" json:"type"`
	Category Category   `gorm:"type:varchar(20);not null;default:activity;index:idx_operation_category_time,priority:1" json:"category"`
	Action   string     `gorm:"type:varchar(50);not null;index" json:"action"`
	Status   Status     `gorm:"type:varchar(30);not null;index" json:"status"`

	ServerID   *uuid.UUID `gorm:"type:char(36);index" json:"server_id,omitempty"`
	ServerName string     `gorm:"size:100" json:"server_name"`
	Title      string     `gorm:"size:255" json:"title"`
	Resource   string     `gorm:"type:text" json:"resource"`
	Source     string     `gorm:"size:50;index" json:"source"`
	IP         string     `gorm:"size:45;index:idx_operation_ip_time,priority:1" json:"ip"`
	UserAgent  string     `gorm:"size:500" json:"user_agent"`

	StartedAt  *time.Time `gorm:"index" json:"started_at,omitempty"`
	FinishedAt *time.Time `gorm:"index" json:"finished_at,omitempty"`
	DurationMs int64      `gorm:"default:0" json:"duration_ms"`

	Progress     int `gorm:"default:0" json:"progress"`
	TotalCount   int `gorm:"default:0" json:"total_count"`
	SuccessCount int `gorm:"default:0" json:"success_count"`
	FailureCount int `gorm:"default:0" json:"failure_count"`

	BytesTotal     int64 `gorm:"default:0" json:"bytes_total"`
	BytesProcessed int64 `gorm:"default:0" json:"bytes_processed"`
	BytesCompleted int64 `gorm:"default:0" json:"bytes_completed"`
	SpeedBps       int64 `gorm:"default:0" json:"speed_bps"`

	ErrorMessage string `gorm:"type:text" json:"error_message,omitempty"`
	DetailJSON   string `gorm:"type:text" json:"detail_json,omitempty"`

	SourceTable string `gorm:"size:80;not null;uniqueIndex:idx_operation_source" json:"source_table"`
	SourceID    string `gorm:"size:80;not null;uniqueIndex:idx_operation_source" json:"source_id"`

	CreatedAt time.Time      `gorm:"index;index:idx_operation_type_time,priority:2,sort:desc;index:idx_operation_category_time,priority:2,sort:desc;index:idx_operation_ip_time,priority:2,sort:desc" json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (OperationRecord) TableName() string {
	return "operation_records"
}

func (r *OperationRecord) BeforeCreate(tx *gorm.DB) error {
	if r.Type == TypeTransfer && r.Status == StatusSuccess {
		r.BytesCompleted = r.BytesProcessed
	}
	if r.Actor.GrantID != "" {
		r.Source = "share"
	} else if r.Source != "automation" {
		r.Source = "manual"
	}
	if r.ID == uuid.Nil {
		r.ID = uuid.NewSHA1(uuid.NameSpaceOID, []byte("easyssh:activity:"+r.SourceTable+":"+r.SourceID))
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
	if r.Attempt < 1 {
		r.Attempt = 1
	}
	if r.Category == "" {
		r.Category = CategoryActivity
	}
	return nil
}

type ListRequest struct {
	Type       RecordType
	Types      []RecordType
	Category   Category
	Categories []Category
	Action     string
	Status     Status
	Statuses   []Status
	ServerID   *uuid.UUID
	Source     string
	IP         string
	Keyword    string
	StartTime  *time.Time
	EndTime    *time.Time
	SortBy     string
	SortOrder  string
	Page       int
	PageSize   int
}

type ListResponse = protocol.ActivityRecordList

// OperationRecordSummary 是列表查询的轻量视图。UserAgent 与 DetailJSON 仅在详情查询返回。
type OperationRecordSummary = protocol.ActivityRecordSummary

type StatisticsRequest struct {
	Type      RecordType
	Category  Category
	StartTime *time.Time
	EndTime   *time.Time
	Days      int
}

type Statistics = protocol.ActivityRecordStatistics

// Resources retain the endpoint name observed during the operation; deleting a
// server must not erase its historical attribution.
type ResourceSnapshot = protocol.ActivityResourceSnapshot
type Resource struct {
	RecordID uuid.UUID `gorm:"type:char(36);primaryKey" json:"-"`
	ServerID uuid.UUID `gorm:"type:char(36);primaryKey" json:"server_id"`
	Name     string    `gorm:"size:120" json:"name"`
}

func (Resource) TableName() string { return "operation_resources" }
