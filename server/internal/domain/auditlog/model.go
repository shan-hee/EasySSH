package auditlog

import (
	"time"

	"github.com/google/uuid"
)

type ActionType string

const (
	ActionLogin  ActionType = "login"
	ActionLogout ActionType = "logout"

	ActionServerCreate ActionType = "server_create"
	ActionServerUpdate ActionType = "server_update"
	ActionServerDelete ActionType = "server_delete"
	ActionServerTest   ActionType = "server_test"

	ActionSSHConnect    ActionType = "ssh_connect"
	ActionSSHDisconnect ActionType = "ssh_disconnect"

	ActionSFTPUpload   ActionType = "sftp_upload"
	ActionSFTPDownload ActionType = "sftp_download"
	ActionSFTPDelete   ActionType = "sftp_delete"
	ActionSFTPRename   ActionType = "sftp_rename"
	ActionSFTPMkdir    ActionType = "sftp_mkdir"

	ActionMonitoringQuery ActionType = "monitoring_query"

	ActionUserCreate ActionType = "user_create"
	ActionUserUpdate ActionType = "user_update"
	ActionUserDelete ActionType = "user_delete"

	ActionScheduledTaskCreate  ActionType = "scheduled_task_create"
	ActionScheduledTaskUpdate  ActionType = "scheduled_task_update"
	ActionScheduledTaskDelete  ActionType = "scheduled_task_delete"
	ActionScheduledTaskToggle  ActionType = "scheduled_task_toggle"
	ActionScheduledTaskTrigger ActionType = "scheduled_task_trigger"
)

type LogCategory string

const (
	CategoryActivity LogCategory = "activity"
	CategoryAudit    LogCategory = "audit"
)

func CategoryOf(action ActionType) LogCategory {
	switch action {
	case ActionSSHConnect, ActionSSHDisconnect,
		ActionSFTPUpload, ActionSFTPDownload, ActionSFTPDelete,
		ActionSFTPRename, ActionSFTPMkdir,
		ActionMonitoringQuery:
		return CategoryActivity
	default:
		return CategoryAudit
	}
}

type Status string

const (
	StatusSuccess Status = "success"
	StatusFailure Status = "failure"
	StatusWarning Status = "warning"
)

type AuditLog struct {
	ID        uuid.UUID   `json:"id"`
	UserID    uuid.UUID   `json:"user_id"`
	Username  string      `json:"username"`
	ServerID  *uuid.UUID  `json:"server_id,omitempty"`
	Type      string      `json:"type"`
	Action    ActionType  `json:"action"`
	Category  LogCategory `json:"category"`
	Resource  string      `json:"resource"`
	Source    string      `json:"source"`
	Status    Status      `json:"status"`
	IP        string      `json:"ip"`
	UserAgent string      `json:"user_agent"`
	Details   string      `json:"details"`
	ErrorMsg  string      `json:"error_msg,omitempty"`
	Duration  int64       `json:"duration"`
	CreatedAt time.Time   `json:"created_at"`
}

type CreateAuditLogRequest struct {
	UserID    uuid.UUID  `json:"user_id" binding:"required"`
	Username  string     `json:"username"`
	ServerID  *uuid.UUID `json:"server_id,omitempty"`
	Type      string     `json:"type,omitempty"`
	Action    ActionType `json:"action" binding:"required"`
	Resource  string     `json:"resource"`
	Source    string     `json:"source,omitempty"`
	Status    Status     `json:"status" binding:"required"`
	IP        string     `json:"ip"`
	UserAgent string     `json:"user_agent"`
	Details   string     `json:"details"`
	ErrorMsg  string     `json:"error_msg,omitempty"`
	Duration  int64      `json:"duration"`
}

type ListAuditLogsRequest struct {
	UserID     *uuid.UUID
	ServerID   *uuid.UUID
	Type       string
	Types      []string
	Action     ActionType
	Category   LogCategory
	Categories []LogCategory
	Status     Status
	Statuses   []Status
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

type AuditLogStatisticsRequest struct {
	UserID    *uuid.UUID
	Category  LogCategory
	Days      int
	StartTime *time.Time
	EndTime   *time.Time
}

type AuditLogStatistics struct {
	TotalLogs      int64                `json:"total_logs"`
	SuccessCount   int64                `json:"success_count"`
	FailureCount   int64                `json:"failure_count"`
	ActionStats    map[ActionType]int64 `json:"action_stats"`
	RecentFailures []*AuditLog          `json:"recent_failures"`
	TopUsers       []UserActionCount    `json:"top_users"`
}

type UserActionCount struct {
	UserID   uuid.UUID `json:"user_id"`
	Username string    `json:"username"`
	Count    int64     `json:"count"`
}
