-- Frozen initial schema. Add a numbered migration for subsequent changes.

-- +goose Up

CREATE TABLE "ai_config" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "system_enabled" numeric DEFAULT false,
  "system_provider" text,
  "system_api_key" text,
  "system_api_endpoint" text,
  "system_models" text,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime
);

CREATE INDEX "idx_ai_config_deleted_at" ON "ai_config" ("deleted_at");

CREATE TABLE "ai_sessions" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "model" text,
  "title" text,
  "permission_mode" varchar(32) NOT NULL,
  "status" varchar(32) NOT NULL,
  "messages" text NOT NULL,
  "message_views" text NOT NULL,
  "tasks" text NOT NULL,
  "task_order" text NOT NULL,
  "created_at" datetime NOT NULL,
  "updated_at" datetime NOT NULL,
  "deleted_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_ai_sessions_user_updated" ON "ai_sessions" ("user_id", "updated_at");

CREATE INDEX "idx_ai_sessions_status" ON "ai_sessions" ("status");

CREATE INDEX "idx_ai_sessions_deleted_at" ON "ai_sessions" ("deleted_at");

CREATE TABLE "auth_tickets" (
  "id" char(36) NOT NULL,
  "token_hash" text NOT NULL,
  "type" text NOT NULL,
  "ref" text,
  "user_id" char(36) NOT NULL,
  "username" text,
  "email" text,
  "role" text,
  "session_id" char(36),
  "payload_json" text,
  "created_at" datetime,
  "expires_at" datetime NOT NULL,
  "used_at" datetime,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_auth_tickets_token_hash" ON "auth_tickets" ("token_hash");

CREATE INDEX "idx_auth_tickets_type" ON "auth_tickets" ("type");

CREATE INDEX "idx_auth_tickets_ref" ON "auth_tickets" ("ref");

CREATE INDEX "idx_auth_tickets_user_id" ON "auth_tickets" ("user_id");

CREATE INDEX "idx_auth_tickets_session_id" ON "auth_tickets" ("session_id");

CREATE INDEX "idx_auth_tickets_expires_at" ON "auth_tickets" ("expires_at");

CREATE INDEX "idx_auth_tickets_used_at" ON "auth_tickets" ("used_at");

CREATE TABLE "batch_tasks" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "task_name" varchar(100) NOT NULL,
  "task_type" varchar(20) NOT NULL,
  "content" text,
  "script_id" char(36),
  "server_ids" text NOT NULL,
  "execution_mode" varchar(20) DEFAULT 'parallel',
  "status" varchar(20) DEFAULT 'pending',
  "success_count" integer DEFAULT 0,
  "failed_count" integer DEFAULT 0,
  "started_at" datetime,
  "completed_at" datetime,
  "duration" integer,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_batch_tasks_user_id" ON "batch_tasks" ("user_id");

CREATE INDEX "idx_batch_tasks_deleted_at" ON "batch_tasks" ("deleted_at");

CREATE TABLE "casbin_rule" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "ptype" text,
  "v0" text,
  "v1" text,
  "v2" text,
  "v3" text,
  "v4" text,
  "v5" text
);

CREATE UNIQUE INDEX "idx_casbin_rule" ON "casbin_rule" ("ptype", "v0", "v1", "v2", "v3", "v4", "v5");

CREATE TABLE "inbox_notifications" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "event_type" text NOT NULL,
  "severity" text NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "source_type" text,
  "source_id" text,
  "action_url" text,
  "data_json" text,
  "read_at" datetime,
  "created_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_inbox_notifications_user_id" ON "inbox_notifications" ("user_id");

CREATE INDEX "idx_inbox_user_time" ON "inbox_notifications" ("user_id", "created_at");

CREATE INDEX "idx_inbox_notifications_event_type" ON "inbox_notifications" ("event_type");

CREATE INDEX "idx_inbox_notifications_severity" ON "inbox_notifications" ("severity");

CREATE INDEX "idx_inbox_notifications_source_type" ON "inbox_notifications" ("source_type");

CREATE INDEX "idx_inbox_notifications_source_id" ON "inbox_notifications" ("source_id");

CREATE INDEX "idx_inbox_notifications_read_at" ON "inbox_notifications" ("read_at");

CREATE INDEX "idx_inbox_notifications_created_at" ON "inbox_notifications" ("created_at");

CREATE TABLE "job_queue" (
  "id" char(36) NOT NULL,
  "kind" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text NOT NULL,
  "dedupe_key" text,
  "payload_json" text NOT NULL,
  "status" text NOT NULL,
  "priority" integer NOT NULL DEFAULT 0,
  "available_at" datetime NOT NULL,
  "claimed_by" text,
  "claimed_at" datetime,
  "heartbeat_at" datetime,
  "lease_expires_at" datetime,
  "attempt" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "last_error" text,
  "finished_at" datetime,
  "created_at" datetime,
  "updated_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_job_queue_kind" ON "job_queue" ("kind");

CREATE INDEX "idx_job_queue_source" ON "job_queue" ("source_type", "source_id");

CREATE UNIQUE INDEX "idx_job_queue_dedupe_key" ON "job_queue" ("dedupe_key");

CREATE INDEX "idx_job_queue_claim" ON "job_queue" ("status", "priority", "available_at");

CREATE INDEX "idx_job_queue_claimed_by" ON "job_queue" ("claimed_by");

CREATE INDEX "idx_job_queue_lease_expires_at" ON "job_queue" ("lease_expires_at");

CREATE INDEX "idx_job_queue_finished_at" ON "job_queue" ("finished_at");

CREATE INDEX "idx_job_queue_created_at" ON "job_queue" ("created_at");

CREATE TABLE "login_alerts" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "session_id" char(36),
  "alert_type" text,
  "ip_address" text,
  "location" text,
  "device_info" text,
  "notified_at" datetime,
  "acknowledged" numeric DEFAULT false,
  "created_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_alert_user_time" ON "login_alerts" ("user_id", "created_at");

CREATE INDEX "idx_login_alerts_alert_type" ON "login_alerts" ("alert_type");

CREATE INDEX "idx_login_alerts_acknowledged" ON "login_alerts" ("acknowledged");

CREATE TABLE "login_attempts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "email" text,
  "ip_address" text,
  "user_agent" text,
  "success" numeric DEFAULT false,
  "fail_reason" text,
  "created_at" datetime
);

CREATE INDEX "idx_attempt_email_time" ON "login_attempts" ("email", "created_at");

CREATE INDEX "idx_attempt_ip_time" ON "login_attempts" ("ip_address", "created_at");

CREATE INDEX "idx_login_attempts_success" ON "login_attempts" ("success");

CREATE INDEX "idx_login_attempts_created_at" ON "login_attempts" ("created_at");

CREATE TABLE "notification_config" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "smtp_config" text,
  "webhook_config" text,
  "ding_talk_config" text,
  "we_com_config" text,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime
);

CREATE INDEX "idx_notification_config_deleted_at" ON "notification_config" ("deleted_at");

CREATE TABLE "notification_deliveries" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "notification_id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "channel" text NOT NULL,
  "status" text NOT NULL,
  "payload_json" text NOT NULL,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "next_attempt_at" datetime NOT NULL,
  "last_attempt_at" datetime,
  "locked_at" datetime,
  "error_message" text,
  "sent_at" datetime,
  "created_at" datetime,
  "updated_at" datetime
);

CREATE INDEX "idx_notification_deliveries_notification_id" ON "notification_deliveries" ("notification_id");

CREATE INDEX "idx_notification_deliveries_user_id" ON "notification_deliveries" ("user_id");

CREATE INDEX "idx_notification_deliveries_channel" ON "notification_deliveries" ("channel");

CREATE INDEX "idx_notification_delivery_due" ON "notification_deliveries" ("status", "next_attempt_at");

CREATE INDEX "idx_notification_deliveries_locked_at" ON "notification_deliveries" ("locked_at");

CREATE TABLE "oauth_client_assertions" (
  "jti_hash" text NOT NULL,
  "expires_at" datetime NOT NULL,
  "created_at" datetime,
  PRIMARY KEY ("jti_hash")
);

CREATE INDEX "idx_oauth_client_assertions_expires_at" ON "oauth_client_assertions" ("expires_at");

CREATE TABLE "oauth_clients" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "secret_hash" text,
  "redirect_uris" text,
  "grant_types" text,
  "response_types" text,
  "scopes" text,
  "audience" text,
  "public" numeric NOT NULL DEFAULT false,
  "token_endpoint_auth_method" text NOT NULL DEFAULT 'client_secret_basic',
  "request_object_signing_alg" text,
  "token_endpoint_auth_signing_alg" text,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_oauth_clients_deleted_at" ON "oauth_clients" ("deleted_at");

CREATE TABLE "oauth_grants" (
  "id" char(36) NOT NULL,
  "kind" text NOT NULL,
  "signature" text NOT NULL,
  "request_id" text NOT NULL,
  "access_signature" text,
  "request_data" text NOT NULL,
  "active" numeric NOT NULL DEFAULT true,
  "expires_at" datetime NOT NULL,
  "created_at" datetime,
  "updated_at" datetime,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_oauth_grant_kind_signature" ON "oauth_grants" ("kind", "signature");

CREATE INDEX "idx_oauth_grants_request_id" ON "oauth_grants" ("request_id");

CREATE INDEX "idx_oauth_grants_access_signature" ON "oauth_grants" ("access_signature");

CREATE INDEX "idx_oauth_grants_active" ON "oauth_grants" ("active");

CREATE INDEX "idx_oauth_grants_expires_at" ON "oauth_grants" ("expires_at");

CREATE TABLE "oauth_login_challenges" (
  "id" char(36) NOT NULL,
  "token_hash" text NOT NULL,
  "user_id" char(36) NOT NULL,
  "request_data" text NOT NULL,
  "expires_at" datetime NOT NULL,
  "used_at" datetime,
  "created_at" datetime,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_oauth_login_challenges_token_hash" ON "oauth_login_challenges" ("token_hash");

CREATE INDEX "idx_oauth_login_challenges_user_id" ON "oauth_login_challenges" ("user_id");

CREATE INDEX "idx_oauth_login_challenges_expires_at" ON "oauth_login_challenges" ("expires_at");

CREATE TABLE "oauth_signing_keys" (
  "id" text NOT NULL,
  "encrypted_private_pem" text NOT NULL,
  "created_at" datetime,
  "updated_at" datetime,
  PRIMARY KEY ("id")
);

CREATE TABLE "operation_records" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "username" text,
  "type" varchar(30) NOT NULL,
  "category" varchar(20) NOT NULL DEFAULT 'activity',
  "action" varchar(50) NOT NULL,
  "status" varchar(30) NOT NULL,
  "server_id" char(36),
  "server_name" text,
  "title" text,
  "resource" text,
  "source" text,
  "ip" text,
  "user_agent" text,
  "started_at" datetime,
  "finished_at" datetime,
  "duration_ms" integer DEFAULT 0,
  "progress" integer DEFAULT 0,
  "total_count" integer DEFAULT 0,
  "success_count" integer DEFAULT 0,
  "failure_count" integer DEFAULT 0,
  "bytes_total" integer DEFAULT 0,
  "bytes_processed" integer DEFAULT 0,
  "speed_bps" integer DEFAULT 0,
  "error_message" text,
  "detail_json" text,
  "source_table" text NOT NULL,
  "source_id" text NOT NULL,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_operation_records_user_id" ON "operation_records" ("user_id");

CREATE INDEX "idx_operation_user_time" ON "operation_records" ("user_id", "created_at");

CREATE INDEX "idx_operation_records_type" ON "operation_records" ("type");

CREATE INDEX "idx_operation_type_time" ON "operation_records" ("type", "created_at");

CREATE INDEX "idx_operation_records_category" ON "operation_records" ("category");

CREATE INDEX "idx_operation_category_time" ON "operation_records" ("category", "created_at");

CREATE INDEX "idx_operation_records_action" ON "operation_records" ("action");

CREATE INDEX "idx_operation_records_status" ON "operation_records" ("status");

CREATE INDEX "idx_operation_records_server_id" ON "operation_records" ("server_id");

CREATE INDEX "idx_operation_records_source" ON "operation_records" ("source");

CREATE INDEX "idx_operation_ip_time" ON "operation_records" ("ip", "created_at");

CREATE INDEX "idx_operation_records_started_at" ON "operation_records" ("started_at");

CREATE INDEX "idx_operation_records_finished_at" ON "operation_records" ("finished_at");

CREATE UNIQUE INDEX "idx_operation_source" ON "operation_records" ("source_table", "source_id");

CREATE INDEX "idx_operation_records_created_at" ON "operation_records" ("created_at");

CREATE INDEX "idx_operation_records_deleted_at" ON "operation_records" ("deleted_at");

CREATE TABLE "roles" (
  "id" char(36) NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "parent_key" text,
  "system" numeric NOT NULL DEFAULT false,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_roles_key" ON "roles" ("key");

CREATE INDEX "idx_roles_parent_key" ON "roles" ("parent_key");

CREATE INDEX "idx_roles_deleted_at" ON "roles" ("deleted_at");

CREATE TABLE "scheduled_tasks" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "task_name" varchar(100) NOT NULL,
  "task_type" varchar(40) NOT NULL,
  "script_id" char(36),
  "command" text,
  "payload_json" text,
  "server_ids" text,
  "cron_expression" varchar(100) NOT NULL,
  "timezone" varchar(50) DEFAULT 'UTC',
  "enabled" numeric DEFAULT true,
  "last_run_at" datetime,
  "next_run_at" datetime,
  "run_count" integer DEFAULT 0,
  "failure_count" integer DEFAULT 0,
  "last_status" varchar(20),
  "description" text,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_scheduled_tasks_user_id" ON "scheduled_tasks" ("user_id");

CREATE INDEX "idx_scheduled_tasks_deleted_at" ON "scheduled_tasks" ("deleted_at");

CREATE TABLE "scripts" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "name" varchar(100) NOT NULL,
  "description" text,
  "content" text NOT NULL,
  "language" varchar(20) DEFAULT 'bash',
  "tags" text,
  "executions" integer DEFAULT 0,
  "author" varchar(50),
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_scripts_user_id" ON "scripts" ("user_id");

CREATE INDEX "idx_scripts_deleted_at" ON "scripts" ("deleted_at");

CREATE TABLE "security_config" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "session_timeout" integer NOT NULL DEFAULT 30,
  "max_tabs" integer NOT NULL DEFAULT 10,
  "inactive_minutes" integer NOT NULL DEFAULT 15,
  "remember_login" numeric NOT NULL DEFAULT true,
  "hibernate" numeric NOT NULL DEFAULT true,
  "allowlist_ips" text,
  "blocklist_ips" text,
  "cors_config" text,
  "trusted_proxies" text NOT NULL DEFAULT '127.0.0.1',
  "cookie_secure_mode" text NOT NULL DEFAULT 'auto',
  "cookie_domain" text,
  "cookie_same_site" text NOT NULL DEFAULT 'lax',
  "csrf_trusted_origins" text,
  "content_security_policy" text,
  "password_pwned_check_enabled" numeric NOT NULL DEFAULT false,
  "login_limit" integer NOT NULL DEFAULT 5,
  "api_limit" integer NOT NULL DEFAULT 100,
  "two_fa_limit" integer NOT NULL DEFAULT 5,
  "account_lock_enabled" numeric NOT NULL DEFAULT true,
  "max_ip_fail_attempts" integer NOT NULL DEFAULT 10,
  "ip_lock_duration_minutes" integer NOT NULL DEFAULT 30,
  "max_account_fail_attempts" integer NOT NULL DEFAULT 5,
  "account_lock_duration_minutes" integer NOT NULL DEFAULT 60,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime
);

CREATE INDEX "idx_security_config_deleted_at" ON "security_config" ("deleted_at");

CREATE TABLE "ssh_keys" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "created_at" datetime,
  "updated_at" datetime,
  "user_id" char(36) NOT NULL,
  "name" varchar(100) NOT NULL,
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "fingerprint" varchar(100) NOT NULL,
  "algorithm" varchar(20) NOT NULL,
  "key_size" integer DEFAULT 0,
  "passphrase_required" numeric
);

CREATE UNIQUE INDEX "idx_ssh_key_owner_fingerprint" ON "ssh_keys" ("user_id", "fingerprint");

CREATE TABLE "servers" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "name" text,
  "host" text NOT NULL,
  "port" integer DEFAULT 22,
  "username" text NOT NULL,
  "auth_method" varchar(64) NOT NULL,
  "password" text,
  "server_group" text,
  "tags" text,
  "status" varchar(20) DEFAULT 'offline',
  "last_connected" datetime,
  "description" text,
  "os" text,
  "sort_order" integer DEFAULT 0,
  "country" text,
  "country_code" text,
  "region" text,
  "city" text,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  "ssh_key_id" integer,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("ssh_key_id") REFERENCES "ssh_keys" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_servers_deleted_at" ON "servers" ("deleted_at");

CREATE INDEX "idx_servers_sort_order" ON "servers" ("sort_order");

CREATE INDEX "idx_servers_ssh_key_id" ON "servers" ("ssh_key_id");

CREATE INDEX "idx_servers_user_id" ON "servers" ("user_id");

CREATE TABLE "ssh_host_keys" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  "host" varchar(255) NOT NULL,
  "port" integer NOT NULL,
  "key_type" varchar(50) NOT NULL,
  "public_key" text NOT NULL,
  "fingerprint" varchar(100) NOT NULL,
  "first_seen" datetime NOT NULL,
  "last_seen" datetime NOT NULL,
  "trust_status" varchar(20) NOT NULL DEFAULT 'trusted',
  "user_id" integer
);

CREATE INDEX "idx_ssh_host_keys_deleted_at" ON "ssh_host_keys" ("deleted_at");

CREATE UNIQUE INDEX "idx_host_port" ON "ssh_host_keys" ("host", "port");

CREATE INDEX "idx_ssh_host_keys_fingerprint" ON "ssh_host_keys" ("fingerprint");

CREATE INDEX "idx_ssh_host_keys_user_id" ON "ssh_host_keys" ("user_id");

CREATE TABLE "sync_authorizations" (
  "id" char(36) NOT NULL,
  "device_code_hash" text NOT NULL,
  "user_code_hash" text NOT NULL,
  "token_hash" text NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL,
  "expires_at" datetime,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_sync_authorizations_device_code_hash" ON "sync_authorizations" ("device_code_hash");

CREATE UNIQUE INDEX "idx_sync_authorizations_user_code_hash" ON "sync_authorizations" ("user_code_hash");

CREATE INDEX "idx_sync_authorizations_expires_at" ON "sync_authorizations" ("expires_at");

CREATE TABLE "sync_devices" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "created_at" datetime,
  "expires_at" datetime,
  "last_used_at" datetime,
  "scopes" text,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_sync_devices_user_id" ON "sync_devices" ("user_id");

CREATE UNIQUE INDEX "idx_sync_devices_token_hash" ON "sync_devices" ("token_hash");

CREATE TABLE "sync_instance" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "uuid" char(36) NOT NULL
);

CREATE TABLE "sync_states" (
  "user_id" char(36) NOT NULL,
  "document" text,
  "revision" integer,
  "updated_at" datetime,
  "disabled" numeric NOT NULL DEFAULT false,
  PRIMARY KEY ("user_id")
);

CREATE TABLE "sync_vault_documents" (
  "user_id" char(36) NOT NULL,
  "kind" text NOT NULL,
  "resource_id" text NOT NULL,
  "document" text,
  "current_ref" text,
  "observed_ref" text,
  "revision" integer,
  "updated_at" datetime,
  "conflicts" text,
  "applied_ref" text,
  PRIMARY KEY ("user_id", "kind", "resource_id")
);

CREATE TABLE "sync_vault_objects" (
  "user_id" char(36) NOT NULL,
  "id" text NOT NULL,
  "kind" text NOT NULL,
  "resource_id" text NOT NULL,
  "ciphertext" text,
  "created_at" datetime,
  PRIMARY KEY ("user_id", "id")
);

CREATE TABLE "system_config" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "system_name" text NOT NULL DEFAULT 'EasySSH',
  "system_logo" text,
  "system_favicon" text,
  "default_language" text NOT NULL DEFAULT 'zh-CN',
  "default_timezone" text NOT NULL DEFAULT 'Asia/Shanghai',
  "date_format" text NOT NULL DEFAULT 'YYYY-MM-DD HH:mm:ss',
  "download_exclude_patterns" text,
  "default_download_mode" text NOT NULL DEFAULT 'fast',
  "skip_excluded_on_upload" numeric NOT NULL DEFAULT true,
  "max_file_upload_size" integer NOT NULL DEFAULT 100,
  "transfer_storage_path" text,
  "transfer_retention_days" integer NOT NULL DEFAULT 3,
  "transfer_max_storage_gb" integer NOT NULL DEFAULT 10,
  "transfer_max_concurrency" integer NOT NULL DEFAULT 2,
  "transfer_cleanup_enabled" numeric NOT NULL DEFAULT true,
  "allow_registration" numeric NOT NULL DEFAULT false,
  "default_role" text NOT NULL DEFAULT 'user',
  "oauth_enabled" numeric NOT NULL DEFAULT false,
  "google_client_id" text,
  "google_client_secret" text,
  "oauth_access_token_minutes" integer NOT NULL DEFAULT 15,
  "oauth_refresh_token_days" integer NOT NULL DEFAULT 30,
  "external_oauth_provider_enabled" numeric NOT NULL DEFAULT false,
  "external_oauth_issuer" text,
  "external_oauth_login_url" text,
  "external_oauth_redirect_uris" text,
  "sftp_max_idle_time_seconds" integer NOT NULL DEFAULT 120,
  "sftp_cleanup_interval_seconds" integer NOT NULL DEFAULT 30,
  "sftp_max_life_time_minutes" integer NOT NULL DEFAULT 0,
  "sftp_conn_timeout_seconds" integer NOT NULL DEFAULT 10,
  "sftp_max_sessions_per_conn" integer NOT NULL DEFAULT 8,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  "job_queue_max_concurrency" integer NOT NULL DEFAULT 2
);

CREATE INDEX "idx_system_config_deleted_at" ON "system_config" ("deleted_at");

CREATE TABLE "task_events" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "task_run_id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "level" text NOT NULL DEFAULT 'info',
  "message" text NOT NULL,
  "data_json" text,
  "created_at" datetime
);

CREATE INDEX "idx_task_events_task_run_id" ON "task_events" ("task_run_id");

CREATE INDEX "idx_task_events_user_id" ON "task_events" ("user_id");

CREATE INDEX "idx_task_events_created_at" ON "task_events" ("created_at");

CREATE TABLE "task_runs" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "definition_id" char(36),
  "retry_of_id" char(36),
  "source_type" text,
  "source_id" text,
  "task_type" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "trigger_type" text NOT NULL,
  "runner" text NOT NULL DEFAULT 'server',
  "status" text NOT NULL,
  "stage" text,
  "server_id" char(36),
  "server_name" text,
  "resource" text,
  "payload_json" text,
  "result_json" text,
  "progress" integer DEFAULT 0,
  "total_count" integer DEFAULT 0,
  "success_count" integer DEFAULT 0,
  "failure_count" integer DEFAULT 0,
  "bytes_total" integer DEFAULT 0,
  "bytes_processed" integer DEFAULT 0,
  "progress_json" text,
  "cancelable" numeric NOT NULL DEFAULT false,
  "retryable" numeric NOT NULL DEFAULT false,
  "attempt" integer NOT NULL DEFAULT 1,
  "max_attempts" integer NOT NULL DEFAULT 1,
  "error_code" text,
  "error_message" text,
  "cancel_requested_at" datetime,
  "started_at" datetime,
  "finished_at" datetime,
  "created_at" datetime,
  "updated_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_task_runs_user_id" ON "task_runs" ("user_id");

CREATE INDEX "idx_task_runs_user_time" ON "task_runs" ("user_id", "created_at");

CREATE INDEX "idx_task_runs_definition_id" ON "task_runs" ("definition_id");

CREATE INDEX "idx_task_runs_retry_of_id" ON "task_runs" ("retry_of_id");

CREATE INDEX "idx_task_runs_source" ON "task_runs" ("source_type", "source_id");

CREATE INDEX "idx_task_runs_task_type" ON "task_runs" ("task_type");

CREATE INDEX "idx_task_runs_trigger_type" ON "task_runs" ("trigger_type");

CREATE INDEX "idx_task_runs_status" ON "task_runs" ("status");

CREATE INDEX "idx_task_runs_stage" ON "task_runs" ("stage");

CREATE INDEX "idx_task_runs_server_id" ON "task_runs" ("server_id");

CREATE INDEX "idx_task_runs_started_at" ON "task_runs" ("started_at");

CREATE INDEX "idx_task_runs_finished_at" ON "task_runs" ("finished_at");

CREATE INDEX "idx_task_runs_created_at" ON "task_runs" ("created_at");

CREATE TABLE "totp_replays" (
  "user_id" char(36) NOT NULL,
  "counter" integer NOT NULL,
  "used_at" datetime NOT NULL,
  PRIMARY KEY ("user_id", "counter")
);

CREATE TABLE "transfer_jobs" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "name" text NOT NULL,
  "kind" varchar(40) NOT NULL,
  "runner" text NOT NULL DEFAULT 'server',
  "status" varchar(30) NOT NULL,
  "stage" varchar(40) NOT NULL,
  "description" text,
  "source_server_id" char(36),
  "target_server_id" char(36),
  "source_path" text,
  "target_path" text,
  "file_name" text,
  "artifact_name" text,
  "artifact_path" text,
  "artifact_size" integer DEFAULT 0,
  "artifact_managed" numeric NOT NULL DEFAULT true,
  "artifact_expires_at" datetime,
  "progress" integer DEFAULT 0,
  "bytes_total" integer DEFAULT 0,
  "bytes_processed" integer DEFAULT 0,
  "speed_bps" integer DEFAULT 0,
  "retry_count" integer DEFAULT 0,
  "max_retries" integer DEFAULT 0,
  "scheduled_task_id" char(36),
  "task_run_id" char(36),
  "error_message" text,
  "detail_json" text,
  "started_at" datetime,
  "finished_at" datetime,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_transfer_jobs_user_id" ON "transfer_jobs" ("user_id");

CREATE INDEX "idx_transfer_jobs_user_time" ON "transfer_jobs" ("user_id", "created_at");

CREATE INDEX "idx_transfer_jobs_kind" ON "transfer_jobs" ("kind");

CREATE INDEX "idx_transfer_jobs_status" ON "transfer_jobs" ("status");

CREATE INDEX "idx_transfer_jobs_stage" ON "transfer_jobs" ("stage");

CREATE INDEX "idx_transfer_jobs_source_server_id" ON "transfer_jobs" ("source_server_id");

CREATE INDEX "idx_transfer_jobs_target_server_id" ON "transfer_jobs" ("target_server_id");

CREATE INDEX "idx_transfer_jobs_artifact_expires_at" ON "transfer_jobs" ("artifact_expires_at");

CREATE INDEX "idx_transfer_jobs_scheduled_task_id" ON "transfer_jobs" ("scheduled_task_id");

CREATE INDEX "idx_transfer_jobs_task_run_id" ON "transfer_jobs" ("task_run_id");

CREATE INDEX "idx_transfer_jobs_started_at" ON "transfer_jobs" ("started_at");

CREATE INDEX "idx_transfer_jobs_finished_at" ON "transfer_jobs" ("finished_at");

CREATE INDEX "idx_transfer_jobs_created_at" ON "transfer_jobs" ("created_at");

CREATE INDEX "idx_transfer_jobs_deleted_at" ON "transfer_jobs" ("deleted_at");

CREATE TABLE "trusted_devices" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "device_fingerprint" text,
  "device_type" text,
  "device_name" text,
  "last_ip_address" text,
  "last_location" text,
  "trust_level" integer DEFAULT 1,
  "last_used" datetime,
  "created_at" datetime,
  "updated_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_trusted_user_fp" ON "trusted_devices" ("user_id", "device_fingerprint");

CREATE TABLE "user_ai_config" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "user_id" char(36) NOT NULL,
  "use_system_config" numeric DEFAULT true,
  "custom_enabled" numeric DEFAULT false,
  "custom_provider" text,
  "custom_api_key" text,
  "custom_endpoint" text,
  "custom_models" text,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime
);

CREATE UNIQUE INDEX "idx_user_ai_config_user_id" ON "user_ai_config" ("user_id");

CREATE INDEX "idx_user_ai_config_deleted_at" ON "user_ai_config" ("deleted_at");

CREATE TABLE "user_sessions" (
  "id" char(36) NOT NULL,
  "user_id" char(36) NOT NULL,
  "oauth_request_id" text NOT NULL,
  "device_type" text,
  "device_name" text,
  "ip_address" text,
  "location" text,
  "user_agent" text,
  "last_activity" datetime NOT NULL,
  "expires_at" datetime NOT NULL,
  "remember_login" numeric NOT NULL DEFAULT false,
  "created_at" datetime,
  "deleted_at" datetime,
  "device_fingerprint" text,
  "is_new_device" numeric DEFAULT false,
  "is_new_location" numeric DEFAULT false,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_user_sessions_user_id" ON "user_sessions" ("user_id");

CREATE INDEX "idx_sessions_user_expires" ON "user_sessions" ("user_id", "expires_at");

CREATE UNIQUE INDEX "idx_user_sessions_o_auth_request_id" ON "user_sessions" ("oauth_request_id");

CREATE INDEX "idx_user_sessions_expires_at" ON "user_sessions" ("expires_at");

CREATE INDEX "idx_user_sessions_deleted_at" ON "user_sessions" ("deleted_at");

CREATE INDEX "idx_sessions_user_device" ON "user_sessions" ("device_fingerprint");

CREATE TABLE "users" (
  "id" char(36) NOT NULL,
  "username" text NOT NULL,
  "email" text NOT NULL,
  "password" text NOT NULL,
  "role" varchar(64) DEFAULT 'user',
  "avatar" text,
  "google_sub" text,
  "language" text DEFAULT '',
  "timezone" text DEFAULT '',
  "two_factor_enabled" numeric DEFAULT false,
  "two_factor_secret" text,
  "backup_codes" text,
  "notify_email_login" numeric DEFAULT true,
  "notify_email_alert" numeric DEFAULT true,
  "notify_browser" numeric DEFAULT true,
  "notify_new_device" numeric DEFAULT true,
  "notify_new_location" numeric DEFAULT true,
  "notify_suspicious" numeric DEFAULT true,
  "notify_task_in_app" numeric DEFAULT true,
  "notify_task_success" numeric DEFAULT true,
  "notify_task_failure" numeric DEFAULT true,
  "notify_task_partial" numeric DEFAULT true,
  "notify_task_external" numeric DEFAULT false,
  "failed_login_attempts" integer DEFAULT 0,
  "last_failed_login" datetime,
  "locked_until" datetime,
  "lock_reason" text,
  "monitor_data_source" text DEFAULT 'easyssh',
  "nezha_api_endpoint" text,
  "nezha_api_token" text,
  "komari_api_endpoint" text,
  "komari_api_token" text,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email");

CREATE UNIQUE INDEX "idx_users_google_sub" ON "users" ("google_sub");

CREATE INDEX "idx_users_locked" ON "users" ("locked_until");

CREATE INDEX "idx_users_deleted_at" ON "users" ("deleted_at");

-- +goose Down

DROP TABLE "users";

DROP TABLE "user_sessions";

DROP TABLE "user_ai_config";

DROP TABLE "trusted_devices";

DROP TABLE "transfer_jobs";

DROP TABLE "totp_replays";

DROP TABLE "task_runs";

DROP TABLE "task_events";

DROP TABLE "system_config";

DROP TABLE "sync_vault_objects";

DROP TABLE "sync_vault_documents";

DROP TABLE "sync_states";

DROP TABLE "sync_instance";

DROP TABLE "sync_devices";

DROP TABLE "sync_authorizations";

DROP TABLE "ssh_host_keys";

DROP TABLE "servers";

DROP TABLE "ssh_keys";

DROP TABLE "security_config";

DROP TABLE "scripts";

DROP TABLE "scheduled_tasks";

DROP TABLE "roles";

DROP TABLE "operation_records";

DROP TABLE "oauth_signing_keys";

DROP TABLE "oauth_login_challenges";

DROP TABLE "oauth_grants";

DROP TABLE "oauth_clients";

DROP TABLE "oauth_client_assertions";

DROP TABLE "notification_deliveries";

DROP TABLE "notification_config";

DROP TABLE "login_attempts";

DROP TABLE "login_alerts";

DROP TABLE "job_queue";

DROP TABLE "inbox_notifications";

DROP TABLE "casbin_rule";

DROP TABLE "batch_tasks";

DROP TABLE "auth_tickets";

DROP TABLE "ai_sessions";

DROP TABLE "ai_config";
