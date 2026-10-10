package rest

import (
	"strings"

	"github.com/easyssh/shared/backuputil"
)

type backupSection string

const (
	backupSectionConfig   backupSection = "config"
	backupSectionDatabase backupSection = "database"
)

type backupRestoreMode string

const (
	backupRestoreSingleton backupRestoreMode = "singleton"
	backupRestoreEntity    backupRestoreMode = "entity"
)

type backupTablePolicy struct {
	Table           string
	Section         backupSection
	RestoreMode     backupRestoreMode
	Exportable      bool
	Restorable      bool
	LogicalKeys     [][]string
	UserScoped      bool
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
	"users":           excludeColumns(entityPolicy("users", [][]string{{"email"}}, false), "password", "two_factor_enabled", "two_factor_secret", "backup_codes", "nezha_api_token", "komari_api_token"),
	"servers":         excludeColumns(entityPolicy("servers", nil, true), "password"),
	"ssh_keys":        excludeColumns(entityPolicy("ssh_keys", [][]string{{"user_id", "fingerprint"}}, true), "private_key"),
	"ssh_host_keys":   entityPolicy("ssh_host_keys", [][]string{{"host", "port"}}, false),
	"scripts":         entityPolicy("scripts", nil, true),
	"scheduled_tasks": entityPolicy("scheduled_tasks", nil, true),
	"roles":           defaultSeededEntityPolicy("roles", [][]string{{"key"}}, false),
	"casbin_rule":     entityPolicy("casbin_rule", [][]string{{"ptype", "v0", "v1", "v2", "v3", "v4", "v5"}}, false),
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

func excludeColumns(policy backupTablePolicy, columns ...string) backupTablePolicy {
	policy.ExcludedColumns = append(policy.ExcludedColumns, columns...)
	return policy
}

func backupPolicyForTable(table string) (backupTablePolicy, bool) {
	normalized := normalizeBackupTableName(table)
	if policy, ok := backupTablePolicies[normalized]; ok {
		if _, portable := backuputil.ApplicationColumns[normalized]; !portable {
			return backupTablePolicy{Table: normalized}, false
		}
		return policy, true
	}
	return backupTablePolicy{Table: normalized}, false
}

func normalizeBackupTableName(table string) string {
	return strings.ToLower(strings.TrimSpace(table))
}
