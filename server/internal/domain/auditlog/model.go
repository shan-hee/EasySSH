package auditlog

import (
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/google/uuid"
)

type ActionType string

const (
	ActionLogin  ActionType = "login"
	ActionLogout ActionType = "logout"

	ActionServerCreate      ActionType = "server_create"
	ActionServerUpdate      ActionType = "server_update"
	ActionServerDelete      ActionType = "server_delete"
	ActionServerTest        ActionType = "server_test"
	ActionServerReorder     ActionType = "server_reorder"
	ActionServerGroupCreate ActionType = "server_group_create"
	ActionServerGroupUpdate ActionType = "server_group_update"
	ActionServerGroupDelete ActionType = "server_group_delete"

	ActionSSHKeyGenerate         ActionType = "ssh_key_generate"
	ActionSSHKeyImport           ActionType = "ssh_key_import"
	ActionSSHKeyDelete           ActionType = "ssh_key_delete"
	ActionSSHKeyPassphraseUpdate ActionType = "ssh_key_passphrase_update"

	ActionGrantCreate          ActionType = "grant_create"
	ActionGrantUpdate          ActionType = "grant_update"
	ActionGrantRevoke          ActionType = "grant_revoke"
	ActionGrantRotateSecret    ActionType = "grant_rotate_secret"
	ActionGrantConfirmResource ActionType = "grant_confirm_resource"
	ActionGrantEndSession      ActionType = "grant_end_session"

	ActionSSHConnect    ActionType = "ssh_connect"
	ActionSSHDisconnect ActionType = "ssh_disconnect"

	ActionSFTPUpload   ActionType = "sftp_upload"
	ActionSFTPDownload ActionType = "sftp_download"
	ActionSFTPDelete   ActionType = "sftp_delete"
	ActionSFTPRename   ActionType = "sftp_rename"
	ActionSFTPMkdir    ActionType = "sftp_mkdir"

	ActionMonitoringQuery ActionType = "monitoring_query"

	ActionScheduledTaskCreate  ActionType = "scheduled_task_create"
	ActionScheduledTaskUpdate  ActionType = "scheduled_task_update"
	ActionScheduledTaskDelete  ActionType = "scheduled_task_delete"
	ActionScheduledTaskToggle  ActionType = "scheduled_task_toggle"
	ActionScheduledTaskTrigger ActionType = "scheduled_task_trigger"

	ActionProfileUpdate              ActionType = "profile_update"
	ActionSecurityUpdate             ActionType = "security_update"
	ActionScriptCreate               ActionType = "script_create"
	ActionScriptUpdate               ActionType = "script_update"
	ActionScriptDelete               ActionType = "script_delete"
	ActionScriptExecute              ActionType = "script_execute"
	ActionSystemSettingsUpdate       ActionType = "system_settings_update"
	ActionSecuritySettingsUpdate     ActionType = "security_settings_update"
	ActionNotificationSettingsUpdate ActionType = "notification_settings_update"
	ActionAIConfigUpdate             ActionType = "ai_config_update"
	ActionAuditLogsCleanup           ActionType = "audit_logs_cleanup"
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
	ID uuid.UUID `json:"id"`

	Actor         protocol.Actor             `json:"actor"`
	Username      string                     `json:"username"`
	ServerID      *uuid.UUID                 `json:"server_id,omitempty"`
	Type          string                     `json:"type"`
	Action        ActionType                 `json:"action"`
	Category      LogCategory                `json:"category"`
	Resource      string                     `json:"resource"`
	Source        string                     `json:"source"`
	Status        Status                     `json:"status"`
	IP            string                     `json:"ip"`
	UserAgent     string                     `json:"user_agent"`
	Details       string                     `json:"details"`
	TaskContent   *protocol.ContentReference `json:"task_content,omitempty"`
	DetailContent *protocol.ContentReference `json:"detail_content,omitempty"`
	ErrorMsg      string                     `json:"error_msg,omitempty"`
	Duration      int64                      `json:"duration"`
	CreatedAt     time.Time                  `json:"created_at"`
}

// AuditLogSummary 是管理员活动日志列表的轻量视图。UserAgent 与 Details 仅在详情查询返回。
type AuditLogSummary = protocol.AuditLogSummary

type CreateAuditLogRequest struct {
	Actor     protocol.Actor `json:"actor"`
	Username  string         `json:"username"`
	ServerID  *uuid.UUID     `json:"server_id,omitempty"`
	Type      string         `json:"type,omitempty"`
	Action    ActionType     `json:"action" binding:"required"`
	Resource  string         `json:"resource"`
	Source    string         `json:"source,omitempty"`
	Status    Status         `json:"status" binding:"required"`
	IP        string         `json:"ip"`
	UserAgent string         `json:"user_agent"`
	Details   string         `json:"details"`
	ErrorMsg  string         `json:"error_msg,omitempty"`
	Duration  int64          `json:"duration"`
}

type ListAuditLogsRequest struct {
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
	Category  LogCategory
	Days      int
	StartTime *time.Time
	EndTime   *time.Time
}

type AuditLogStatistics = protocol.AuditLogStatistics
