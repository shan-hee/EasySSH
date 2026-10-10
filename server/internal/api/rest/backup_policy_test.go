package rest

import "testing"

func TestRuntimeTablesAreOutsideApplicationMigration(t *testing.T) {
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
			if _, ok := backupPolicyForTable(table); ok {
				t.Fatalf("runtime table %s must not be part of application migration", table)
			}
		})
	}
}
