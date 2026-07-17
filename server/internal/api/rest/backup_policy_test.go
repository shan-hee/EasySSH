package rest

import "testing"

func TestSecurityRuntimeTablesAreExplicitlyIgnoredByBackup(t *testing.T) {
	tables := []string{
		"user_sessions",
		"auth_tickets",
		"totp_replays",
		"trusted_devices",
		"job_queue",
		"oauth_clients",
		"oauth_client_assertions",
		"oauth_grants",
		"oauth_signing_keys",
		"oauth_login_challenges",
	}
	for _, table := range tables {
		t.Run(table, func(t *testing.T) {
			policy, ok := backupPolicyForTable(table)
			if !ok {
				t.Fatalf("runtime table %s has no explicit backup policy", table)
			}
			if policy.Section != backupSectionRuntime || policy.RestoreMode != backupRestoreIgnore {
				t.Fatalf("runtime table %s is not ignored: %+v", table, policy)
			}
			if policy.Exportable || policy.Restorable {
				t.Fatalf("runtime table %s must not be exportable or restorable: %+v", table, policy)
			}
		})
	}
}
