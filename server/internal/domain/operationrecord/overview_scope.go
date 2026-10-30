package operationrecord

import "gorm.io/gorm"

// Configuration attempts stay in the audit category for detail and retention.
// Only these mutations contribute to work volume: login, reads, connection
// tests and dispatch receipts must not inflate configuration or execution counts.
func overviewWorkQuery(query *gorm.DB) *gorm.DB {
	return query.Where("category = ? OR (category = ? AND type = ? AND action IN ?)",
		CategoryActivity, CategoryAudit, TypeAudit, []string{
			"server_create", "server_update", "server_delete", "server_reorder",
			"server_group_create", "server_group_update", "server_group_delete",
			"ssh_key_generate", "ssh_key_import", "ssh_key_delete", "ssh_key_passphrase_update",
			"grant_create", "grant_update", "grant_revoke", "grant_rotate_secret", "grant_confirm_resource", "grant_end_session",
			"scheduled_task_create", "scheduled_task_update", "scheduled_task_delete", "scheduled_task_toggle",
			"script_create", "script_update", "script_delete",
			"profile_update", "security_update", "system_settings_update", "security_settings_update",
			"notification_settings_update", "ai_config_update",
		})
}
