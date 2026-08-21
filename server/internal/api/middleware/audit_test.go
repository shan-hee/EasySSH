package middleware

import (
	"testing"

	"github.com/easyssh/server/internal/domain/auditlog"
)

func TestDetermineActionCoversGovernanceMutations(t *testing.T) {
	tests := []struct {
		method string
		path   string
		want   auditlog.ActionType
	}{
		{"POST", "/api/v1/roles", auditlog.ActionRoleCreate},
		{"POST", "/api/v1/resource-grants/revoke", auditlog.ActionResourceRevoke},
		{"POST", "/api/v1/scripts/:id/execute", auditlog.ActionScriptExecute},
		{"PATCH", "/api/v1/settings/system/runtime", auditlog.ActionSystemSettingsUpdate},
		{"POST", "/api/v1/settings/notifications", auditlog.ActionNotificationSettingsUpdate},
		{"POST", "/api/v1/settings/ai/system", auditlog.ActionAIConfigUpdate},
		{"PUT", "/api/v1/users/me/ai-config", auditlog.ActionAIConfigUpdate},
		{"DELETE", "/api/v1/logs/cleanup", auditlog.ActionAuditLogsCleanup},
	}
	for _, test := range tests {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			if got := determineAction(test.method, test.path); got != test.want {
				t.Fatalf("determineAction() = %q, want %q", got, test.want)
			}
		})
	}
}
