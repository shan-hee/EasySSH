package taskprotocol

import (
	"strings"
	"time"
)

// NotificationPriority classifies how urgently a completed task should surface
// in the user's notification inbox and external channels.
type NotificationPriority string

const (
	NotificationNone     NotificationPriority = "none"
	NotificationNotable  NotificationPriority = "notable"
	NotificationCritical NotificationPriority = "critical"
)

const (
	// LongTaskNotifyThreshold marks background manual operations that ran long
	// enough that the user has likely switched context.
	LongTaskNotifyThreshold = 15 * time.Second
	// RecursiveDeleteNotifyThreshold marks recursive SFTP deletions worth
	// notifying in the inbox even when inline tracking was closed.
	RecursiveDeleteNotifyThreshold = 10 * time.Second
	// LargeTransferNotifyBytes marks single-file transfers large enough to merit
	// a completion notice in the inbox.
	LargeTransferNotifyBytes = 5 << 20 // 5 MiB
)

// TaskNotificationInput captures the lightweight metadata needed to decide
// whether a terminal task run should generate a notification.
type TaskNotificationInput struct {
	TaskType            string
	SourceType          string
	TriggerType         string
	Status              string
	TotalCount          int
	BytesTotal          int64
	Duration            time.Duration
	RecoveredFromFailed bool
}

// TaskNotificationPreference mirrors the owner's task notification switches.
type TaskNotificationPreference struct {
	NotifySuccess bool
	NotifyFailure bool
	NotifyPartial bool
}

// DefaultTaskNotificationPreference returns the balanced default used when a
// host (such as the local desktop app) does not store per-owner toggles.
func DefaultTaskNotificationPreference() TaskNotificationPreference {
	return TaskNotificationPreference{
		NotifySuccess: true,
		NotifyFailure: true,
		NotifyPartial: true,
	}
}

// IsForegroundMicroTask reports whether the task represents a synchronous,
// foreground file mutation that already provides immediate inline UI feedback.
func IsForegroundMicroTask(taskType, sourceType string) bool {
	if sourceType == "sftp_operation" {
		return true
	}
	switch taskType {
	case "sftp_mkdir", "sftp_rename", "sftp_chmod", "sftp_write", "sftp_delete_file", "sftp_batch_delete":
		return true
	default:
		return false
	}
}

// ForegroundMicroTaskTypes returns the task_type values treated as foreground
// synchronous micro-operations for list noise filtering.
func ForegroundMicroTaskTypes() []string {
	return []string{
		"sftp_mkdir",
		"sftp_rename",
		"sftp_chmod",
		"sftp_write",
		"sftp_delete_file",
		"sftp_batch_delete",
	}
}

// EvaluateTaskNotification decides whether a terminal task run warrants an
// inbox notification and at what priority level.
func EvaluateTaskNotification(in TaskNotificationInput, pref TaskNotificationPreference) NotificationPriority {
	switch in.Status {
	case "failed", "timeout", "unknown":
		if pref.NotifyFailure {
			return NotificationCritical
		}
		return NotificationNone
	case "partial_success":
		if pref.NotifyPartial {
			return NotificationCritical
		}
		return NotificationNone
	case "canceled":
		// User-initiated cancellations are never pushed as unread alerts.
		return NotificationNone
	case "succeeded":
		if !pref.NotifySuccess {
			return NotificationNone
		}
		if IsForegroundMicroTask(in.TaskType, in.SourceType) {
			return NotificationNone
		}
		if in.TriggerType == "scheduled" {
			// Avoid routine cron spam: notify when recovering from a previous
			// failure or when a scheduled SFTP download produced an artifact.
			if in.RecoveredFromFailed || in.TaskType == "sftp_download" {
				return NotificationNotable
			}
			return NotificationNone
		}
		if in.TriggerType == "api" {
			return NotificationNotable
		}
		if in.Duration >= LongTaskNotifyThreshold || in.TotalCount > 1 {
			return NotificationNotable
		}
		switch in.TaskType {
		case "sftp_upload", "sftp_download", "sftp_transfer":
			if in.BytesTotal >= LargeTransferNotifyBytes {
				return NotificationNotable
			}
			return NotificationNone
		case "sftp_recursive_delete":
			if in.Duration >= RecursiveDeleteNotifyThreshold {
				return NotificationNotable
			}
			return NotificationNone
		case "command", "command_execute":
			if in.SourceType == "batch_task" || in.SourceType == "desktop_batch_task" || in.SourceType == "desktop_command" {
				return NotificationNotable
			}
			return NotificationNone
		default:
			if strings.HasPrefix(in.TaskType, "docker_") {
				return NotificationNone
			}
			return NotificationNotable
		}
	default:
		return NotificationNone
	}
}

// ShouldSendExternalTaskNotification restricts external channels (email,
// webhook, DingTalk, WeCom) to critical incidents and failure recoveries so
// external channels stay high-signal.
func ShouldSendExternalTaskNotification(priority NotificationPriority, recoveredFromFailed bool, externalEnabled bool) bool {
	if !externalEnabled {
		return false
	}
	return priority == NotificationCritical || (priority == NotificationNotable && recoveredFromFailed)
}
