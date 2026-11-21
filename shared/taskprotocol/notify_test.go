package taskprotocol

import (
	"testing"
	"time"
)

func TestEvaluateTaskNotificationBalancesSignalAndNoise(t *testing.T) {
	pref := DefaultTaskNotificationPreference()

	tests := []struct {
		name string
		in   TaskNotificationInput
		pref TaskNotificationPreference
		want NotificationPriority
	}{
		{
			name: "foreground micro-op success is silenced",
			in:   TaskNotificationInput{TaskType: "sftp_mkdir", SourceType: "sftp_operation", Status: "succeeded", TotalCount: 1},
			pref: pref,
			want: NotificationNone,
		},
		{
			name: "foreground micro-op failure is critical",
			in:   TaskNotificationInput{TaskType: "sftp_write", SourceType: "sftp_operation", Status: "failed", TotalCount: 1},
			pref: pref,
			want: NotificationCritical,
		},
		{
			name: "foreground micro-op unknown is critical",
			in:   TaskNotificationInput{TaskType: "sftp_delete_file", SourceType: "sftp_operation", Status: "unknown", TotalCount: 1},
			pref: pref,
			want: NotificationCritical,
		},
		{
			name: "canceled task never notifies",
			in:   TaskNotificationInput{TaskType: "script", Status: "canceled"},
			pref: pref,
			want: NotificationNone,
		},
		{
			name: "routine scheduled command success is silenced",
			in:   TaskNotificationInput{TaskType: "command", TriggerType: "scheduled", Status: "succeeded", TotalCount: 3, Duration: 2 * time.Minute},
			pref: pref,
			want: NotificationNone,
		},
		{
			name: "scheduled recovery from failure is notable",
			in:   TaskNotificationInput{TaskType: "command", TriggerType: "scheduled", Status: "succeeded", RecoveredFromFailed: true},
			pref: pref,
			want: NotificationNotable,
		},
		{
			name: "scheduled sftp download artifact ready is notable",
			in:   TaskNotificationInput{TaskType: "sftp_download", TriggerType: "scheduled", Status: "succeeded"},
			pref: pref,
			want: NotificationNotable,
		},
		{
			name: "quick single docker action success is silenced",
			in:   TaskNotificationInput{TaskType: "docker_restart", SourceType: "docker", Status: "succeeded", TotalCount: 1, Duration: 2 * time.Second},
			pref: pref,
			want: NotificationNone,
		},
		{
			name: "slow docker action success is notable",
			in:   TaskNotificationInput{TaskType: "docker_pull", SourceType: "docker", Status: "succeeded", TotalCount: 1, Duration: 25 * time.Second},
			pref: pref,
			want: NotificationNotable,
		},
		{
			name: "small quick upload success is silenced",
			in:   TaskNotificationInput{TaskType: "sftp_upload", SourceType: "transfer_job", Status: "succeeded", TotalCount: 1, BytesTotal: 1024, Duration: time.Second},
			pref: pref,
			want: NotificationNone,
		},
		{
			name: "large upload success is notable",
			in:   TaskNotificationInput{TaskType: "sftp_upload", SourceType: "transfer_job", Status: "succeeded", TotalCount: 1, BytesTotal: 10 << 20, Duration: 3 * time.Second},
			pref: pref,
			want: NotificationNotable,
		},
		{
			name: "quick single recursive delete success is silenced",
			in:   TaskNotificationInput{TaskType: "sftp_recursive_delete", SourceType: "sftp_delete", Status: "succeeded", TotalCount: 1, Duration: 2 * time.Second},
			pref: pref,
			want: NotificationNone,
		},
		{
			name: "long recursive delete success is notable",
			in:   TaskNotificationInput{TaskType: "sftp_recursive_delete", SourceType: "sftp_delete", Status: "succeeded", TotalCount: 1, Duration: 12 * time.Second},
			pref: pref,
			want: NotificationNotable,
		},
		{
			name: "api triggered command success is notable",
			in:   TaskNotificationInput{TaskType: "command", TriggerType: "api", Status: "succeeded", TotalCount: 1, Duration: time.Second},
			pref: pref,
			want: NotificationNotable,
		},
		{
			name: "explicit desktop command success is notable",
			in:   TaskNotificationInput{TaskType: "command_execute", SourceType: "desktop_command", TriggerType: "manual", Status: "succeeded", TotalCount: 1},
			pref: pref,
			want: NotificationNotable,
		},
		{
			name: "script success is notable when enabled",
			in:   TaskNotificationInput{TaskType: "script", TriggerType: "manual", Status: "succeeded", TotalCount: 1},
			pref: pref,
			want: NotificationNotable,
		},
		{
			name: "partial success respects preference",
			in:   TaskNotificationInput{TaskType: "script", Status: "partial_success"},
			pref: TaskNotificationPreference{NotifySuccess: true, NotifyFailure: true, NotifyPartial: false},
			want: NotificationNone,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := EvaluateTaskNotification(tc.in, tc.pref); got != tc.want {
				t.Fatalf("EvaluateTaskNotification(%+v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestShouldSendExternalTaskNotification(t *testing.T) {
	if !ShouldSendExternalTaskNotification(NotificationCritical, false, true) {
		t.Fatal("expected critical notification to send externally")
	}
	if ShouldSendExternalTaskNotification(NotificationNotable, false, true) {
		t.Fatal("routine notable success should not spam external channels")
	}
	if !ShouldSendExternalTaskNotification(NotificationNotable, true, true) {
		t.Fatal("scheduled failure recovery should send externally")
	}
	if ShouldSendExternalTaskNotification(NotificationCritical, false, false) {
		t.Fatal("disabled external flag must not send")
	}
}
