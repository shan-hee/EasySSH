package backuputil

import (
	"fmt"
	"sort"
)

// ApplicationColumns is the versioned portable-data contract. Never infer it from a live database.
var ApplicationColumns = map[string][]string{
	"system_config":       {"id", "system_name", "system_logo", "system_favicon", "default_language", "default_timezone", "date_format", "download_exclude_patterns", "default_download_mode", "skip_excluded_on_upload", "max_file_upload_size", "transfer_retention_days", "transfer_max_storage_gb", "transfer_max_concurrency", "transfer_cleanup_enabled", "allow_registration", "default_role", "oauth_enabled", "google_client_id", "google_client_secret", "oauth_access_token_minutes", "oauth_refresh_token_days", "external_oauth_provider_enabled", "external_oauth_issuer", "external_oauth_login_url", "external_oauth_redirect_uris", "sftp_max_idle_time_seconds", "sftp_cleanup_interval_seconds", "sftp_max_life_time_minutes", "sftp_conn_timeout_seconds", "sftp_max_sessions_per_conn", "created_at", "updated_at", "job_queue_max_concurrency"},
	"security_config":     {"id", "session_timeout", "max_tabs", "inactive_minutes", "remember_login", "hibernate", "allowlist_ips", "blocklist_ips", "cors_config", "trusted_proxies", "cookie_secure_mode", "cookie_domain", "cookie_same_site", "csrf_trusted_origins", "content_security_policy", "password_pwned_check_enabled", "login_limit", "api_limit", "two_fa_limit", "account_lock_enabled", "max_ip_fail_attempts", "ip_lock_duration_minutes", "max_account_fail_attempts", "account_lock_duration_minutes", "created_at", "updated_at"},
	"notification_config": {"id", "smtp_config", "webhook_config", "ding_talk_config", "we_com_config", "created_at", "updated_at"},
	"ai_config":           {"id", "system_enabled", "system_provider", "system_api_key", "system_api_endpoint", "system_models", "created_at", "updated_at"},
	"users":               {"id", "username", "email", "role", "avatar", "language", "timezone", "notify_email_login", "notify_email_alert", "notify_browser", "notify_new_device", "notify_new_location", "notify_suspicious", "notify_task_in_app", "notify_task_success", "notify_task_failure", "notify_task_partial", "notify_task_external", "monitor_data_source", "nezha_api_endpoint", "nezha_api_token", "komari_api_endpoint", "komari_api_token", "created_at", "updated_at"},
	"user_ai_config":      {"id", "user_id", "use_system_config", "custom_enabled", "custom_provider", "custom_api_key", "custom_endpoint", "custom_models", "created_at", "updated_at"},
	"servers":             {"id", "user_id", "name", "host", "port", "username", "auth_method", "password", "server_group", "tags", "status", "last_connected", "description", "os", "sort_order", "country", "country_code", "region", "city", "created_at", "updated_at", "ssh_key_id"},
	"scripts":             {"id", "user_id", "name", "description", "content", "language", "tags", "executions", "author", "created_at", "updated_at"},
	"ssh_keys":            {"id", "created_at", "updated_at", "user_id", "name", "public_key", "private_key", "fingerprint", "algorithm", "key_size", "passphrase_required"},
	"ssh_host_keys":       {"id", "created_at", "updated_at", "host", "port", "key_type", "public_key", "fingerprint", "first_seen", "last_seen", "trust_status", "user_id"},
	"roles":               {"id", "key", "name", "description", "parent_key", "system", "created_at", "updated_at"},
	"casbin_rule":         {"id", "ptype", "v0", "v1", "v2", "v3", "v4", "v5"},
	"scheduled_tasks":     {"id", "user_id", "task_name", "task_type", "script_id", "command", "payload_json", "server_ids", "cron_expression", "timezone", "enabled", "last_run_at", "next_run_at", "run_count", "failure_count", "last_status", "description", "created_at", "updated_at"},
}

// NormalizeApplicationData runs after verifying/decrypting the sensitive payload.
// Unknown optional fields are dropped from BOTH the field list and rows. Keys cannot be dropped.
func NormalizeApplicationData(backup *UnifiedBackup) ([]string, error) {
	warnings := []string{}
	for _, section := range []*DataSection{backup.Config, backup.Database} {
		if section == nil {
			continue
		}
		seen := map[string]bool{}
		for i := range section.Tables {
			table := &section.Tables[i]
			allowed, ok := ApplicationColumns[table.Name]
			if !ok {
				return nil, fmt.Errorf("resource %s is not part of application data migration", table.Name)
			}
			if seen[table.Name] {
				return nil, fmt.Errorf("duplicate resource %s", table.Name)
			}
			seen[table.Name] = true
			if len(table.PrimaryKey) != 1 || table.PrimaryKey[0] != "id" {
				return nil, fmt.Errorf("invalid resource key for %s", table.Name)
			}
			accepted := map[string]bool{}
			for _, column := range allowed {
				accepted[column] = true
			}
			removed := map[string]bool{}
			columns := make([]string, 0, len(table.Columns))
			declared := map[string]bool{}
			for _, column := range table.Columns {
				if declared[column] {
					return nil, fmt.Errorf("duplicate field %s.%s", table.Name, column)
				}
				declared[column] = true
				if accepted[column] {
					columns = append(columns, column)
				} else {
					removed[column] = true
				}
			}
			if !declared["id"] {
				return nil, fmt.Errorf("missing resource key: %s.id", table.Name)
			}
			for _, row := range table.Rows {
				if row["id"] == nil || fmt.Sprint(row["id"]) == "" {
					return nil, fmt.Errorf("missing resource key: %s.id", table.Name)
				}
				for column := range row {
					if !accepted[column] {
						delete(row, column)
						removed[column] = true
						continue
					}
					if !declared[column] {
						return nil, fmt.Errorf("undeclared field: %s.%s", table.Name, column)
					}
				}
			}
			for _, row := range table.Rows {
				if err := ValidateApplicationRow(table.Name, row); err != nil {
					return nil, err
				}
			}
			table.Columns = columns
			for column := range removed {
				warnings = append(warnings, table.Name+"."+column)
			}
		}
	}
	if err := ValidateApplicationReferences(backup); err != nil {
		return nil, err
	}
	sort.Strings(warnings)
	return warnings, nil
}

// Required semantic fields cannot be discarded as optional format extensions.
func ValidateApplicationRow(resource string, row map[string]any) error {
	fields := map[string][]string{
		"users":           {"id", "username", "email"},
		"servers":         {"id", "user_id", "host", "username", "auth_method"},
		"scripts":         {"id", "user_id", "name"},
		"ssh_keys":        {"id", "user_id", "public_key", "fingerprint", "algorithm"},
		"user_ai_config":  {"id", "user_id"},
		"scheduled_tasks": {"id", "user_id", "task_name", "task_type"},
	}
	for _, field := range fields[resource] {
		if row[field] == nil || fmt.Sprint(row[field]) == "" {
			return fmt.Errorf("required application field missing: %s.%s", resource, field)
		}
	}
	return nil
}

// Resource keys in a portable file belong to its source instance, never to the destination.
func ValidateApplicationReferences(backup *UnifiedBackup) error {
	if backup.Database == nil {
		return nil
	}
	keyOwners := map[string]string{}
	for _, table := range backup.Database.Tables {
		if table.Name == "ssh_keys" {
			for _, row := range table.Rows {
				id := fmt.Sprint(row["id"])
				if _, exists := keyOwners[id]; exists {
					return fmt.Errorf("duplicate SSH key ID: %s", id)
				}
				keyOwners[id] = fmt.Sprint(row["user_id"])
			}
		}
	}
	for _, table := range backup.Database.Tables {
		if table.Name == "servers" {
			for _, row := range table.Rows {
				if row["ssh_key_id"] == nil {
					continue
				}
				owner, ok := keyOwners[fmt.Sprint(row["ssh_key_id"])]
				if !ok {
					return fmt.Errorf("server %v references an SSH key missing from application data", row["id"])
				}
				if owner != fmt.Sprint(row["user_id"]) {
					return fmt.Errorf("server %v and its SSH key have different owners", row["id"])
				}
			}
		}
	}
	return nil
}
