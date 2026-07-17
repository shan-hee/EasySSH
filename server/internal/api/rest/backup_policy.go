package rest

import "strings"

type backupSection string

const (
	backupSectionConfig   backupSection = "config"
	backupSectionDatabase backupSection = "database"
	backupSectionRuntime  backupSection = "runtime"
)

type backupRestoreMode string

const (
	backupRestoreSingleton backupRestoreMode = "singleton"
	backupRestoreEntity    backupRestoreMode = "entity"
	backupRestoreIgnore    backupRestoreMode = "ignore"
)

type backupTablePolicy struct {
	Table           string
	Section         backupSection
	RestoreMode     backupRestoreMode
	Exportable      bool
	Restorable      bool
	LogicalKeys     [][]string
	UserScoped      bool
	History         bool
	DefaultSeeded   bool
	ExcludedColumns []string
}

var backupTablePolicies = map[string]backupTablePolicy{
	// Singleton configuration. These rows describe current system state; restoring config means
	// making the current singleton rows match the backup, not applying database conflict strategy.
	"system_config":       excludeColumns(singletonConfigPolicy("system_config"), "google_client_secret"),
	"security_config":     singletonConfigPolicy("security_config"),
	"notification_config": singletonConfigPolicy("notification_config"),
	"ai_config":           excludeColumns(singletonConfigPolicy("ai_config"), "system_api_key"),

	// User-owned configuration is business data because each row belongs to a user.
	"user_ai_config": excludeColumns(entityPolicy("user_ai_config", [][]string{{"user_id"}}, true), "custom_api_key"),

	// Core business entities.
	"users":           excludeColumns(entityPolicy("users", [][]string{{"email"}, {"google_sub"}}, false), "password", "two_factor_enabled", "two_factor_secret", "backup_codes", "nezha_api_token", "komari_api_token"),
	"servers":         excludeColumns(entityPolicy("servers", nil, true), "password", "private_key"),
	"ssh_keys":        excludeColumns(entityPolicy("ssh_keys", [][]string{{"user_id", "fingerprint"}}, true), "private_key"),
	"ssh_host_keys":   entityPolicy("ssh_host_keys", [][]string{{"host", "port"}}, false),
	"scripts":         entityPolicy("scripts", nil, true),
	"batch_tasks":     entityPolicy("batch_tasks", nil, true),
	"scheduled_tasks": entityPolicy("scheduled_tasks", nil, true),
	"roles":           defaultSeededEntityPolicy("roles", [][]string{{"key"}}, false),
	"casbin_rule":     entityPolicy("casbin_rule", [][]string{{"ptype", "v0", "v1", "v2", "v3", "v4", "v5"}}, false),

	// Operational history and append-like records. They remain in the database section but keep
	// explicit policy metadata so later UI can expose them separately without touching restore logic.
	"operation_records":   historyPolicy("operation_records", [][]string{{"source_table", "source_id"}}, true),
	"task_runs":           historyPolicy("task_runs", [][]string{{"id"}}, true),
	"task_events":         historyPolicy("task_events", [][]string{{"id"}}, true),
	"inbox_notifications": historyPolicy("inbox_notifications", [][]string{{"id"}}, true),
	"login_attempts":      historyPolicy("login_attempts", [][]string{{"id"}}, false),
	"login_alerts":        historyPolicy("login_alerts", nil, true),
	"ai_sessions":         historyPolicy("ai_sessions", nil, true),

	// Runtime/security state should not travel with backup restore.
	"user_sessions":           ignoredRuntimePolicy("user_sessions"),
	"auth_tickets":            ignoredRuntimePolicy("auth_tickets"),
	"totp_replays":            ignoredRuntimePolicy("totp_replays"),
	"trusted_devices":         ignoredRuntimePolicy("trusted_devices"),
	"transfer_jobs":           ignoredRuntimePolicy("transfer_jobs"),
	"job_queue":               ignoredRuntimePolicy("job_queue"),
	"notification_deliveries": ignoredRuntimePolicy("notification_deliveries"),
	"oauth_clients":           ignoredRuntimePolicy("oauth_clients"),
	"oauth_client_assertions": ignoredRuntimePolicy("oauth_client_assertions"),
	"oauth_grants":            ignoredRuntimePolicy("oauth_grants"),
	"oauth_signing_keys":      ignoredRuntimePolicy("oauth_signing_keys"),
	"oauth_login_challenges":  ignoredRuntimePolicy("oauth_login_challenges"),
}

func singletonConfigPolicy(table string) backupTablePolicy {
	return backupTablePolicy{
		Table:         table,
		Section:       backupSectionConfig,
		RestoreMode:   backupRestoreSingleton,
		Exportable:    true,
		Restorable:    true,
		LogicalKeys:   [][]string{{"id"}},
		DefaultSeeded: true,
	}
}

func entityPolicy(table string, logicalKeys [][]string, userScoped bool) backupTablePolicy {
	return backupTablePolicy{
		Table:       table,
		Section:     backupSectionDatabase,
		RestoreMode: backupRestoreEntity,
		Exportable:  true,
		Restorable:  true,
		LogicalKeys: logicalKeys,
		UserScoped:  userScoped,
	}
}

func defaultSeededEntityPolicy(table string, logicalKeys [][]string, userScoped bool) backupTablePolicy {
	policy := entityPolicy(table, logicalKeys, userScoped)
	policy.DefaultSeeded = true
	return policy
}

func historyPolicy(table string, logicalKeys [][]string, userScoped bool) backupTablePolicy {
	policy := entityPolicy(table, logicalKeys, userScoped)
	policy.History = true
	return policy
}

func ignoredRuntimePolicy(table string) backupTablePolicy {
	return backupTablePolicy{
		Table:       table,
		Section:     backupSectionRuntime,
		RestoreMode: backupRestoreIgnore,
		Exportable:  false,
		Restorable:  false,
	}
}

func excludeColumns(policy backupTablePolicy, columns ...string) backupTablePolicy {
	policy.ExcludedColumns = append(policy.ExcludedColumns, columns...)
	return policy
}

func backupPolicyForTable(table string) (backupTablePolicy, bool) {
	normalized := normalizeBackupTableName(table)
	if policy, ok := backupTablePolicies[normalized]; ok {
		return policy, true
	}
	return backupTablePolicy{Table: normalized}, false
}

func normalizeBackupTableName(table string) string {
	return strings.ToLower(strings.TrimSpace(table))
}
