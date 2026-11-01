-- Fresh installation baseline. Initialize an empty database; no legacy upgrade path.

-- +goose Up

CREATE TABLE "ai_config" (
  "id" integer PRIMARY KEY CHECK ("id" = 1),
  "enabled" boolean NOT NULL DEFAULT false,
  "provider" varchar(20) NOT NULL DEFAULT 'openai',
  "endpoint" text NOT NULL,
  "api_key" text NOT NULL,
  "models" text NOT NULL,
  "created_at" datetime,
  "updated_at" datetime
);

CREATE TABLE "ai_sessions" (
  "scope_kind" varchar(16) NOT NULL DEFAULT '',
  "scope_server_id" varchar(80) NOT NULL DEFAULT '',
  "scope_terminal_session_id" varchar(80) NOT NULL DEFAULT '',
  "scope_json" text NOT NULL DEFAULT '{}',
  "id" char(36) NOT NULL,
  "actor_kind" varchar(16) NOT NULL,
  "actor_id" varchar(80) NOT NULL,
  "actor_session_id" varchar(80) NOT NULL,
  "actor_grant_id" varchar(36) NOT NULL DEFAULT '',
  "model" text,
  "title" text,
  "permission_mode" varchar(32) NOT NULL,
  "status" varchar(32) NOT NULL,
  "list_title" text NOT NULL DEFAULT '',
  "title_folded" text NOT NULL DEFAULT '',
  "search_text" text NOT NULL DEFAULT '',
  "search_folded" text NOT NULL DEFAULT '',
  "preview" text NOT NULL DEFAULT '',
  "message_count" integer NOT NULL DEFAULT 0,
  "task_count" integer NOT NULL DEFAULT 0,
  "created_at" datetime NOT NULL,
  "updated_at" datetime NOT NULL,
  "deleted_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_ai_sessions_actor_updated" ON "ai_sessions" ("actor_kind", "actor_id", "actor_session_id", "actor_grant_id", "updated_at");

CREATE INDEX "idx_ai_sessions_scope" ON "ai_sessions" ("scope_kind", "scope_server_id", "scope_terminal_session_id");

CREATE INDEX "idx_ai_sessions_status" ON "ai_sessions" ("status");

CREATE INDEX "idx_ai_sessions_deleted_at" ON "ai_sessions" ("deleted_at");

CREATE TABLE "content_objects" (
  "id" char(36) NOT NULL,
  "actor_kind" varchar(32) NOT NULL DEFAULT '',
  "actor_id" varchar(36) NOT NULL DEFAULT '',
  "actor_session_id" varchar(36) NOT NULL DEFAULT '',
  "actor_grant_id" varchar(36) NOT NULL DEFAULT '',
  "source_type" varchar(30) NOT NULL,
  "source_id" char(36) NOT NULL,
  "server_id" varchar(36) NOT NULL,
  "action" varchar(50) NOT NULL,
  "media_type" varchar(128) NOT NULL,
  "size" bigint NOT NULL DEFAULT 0,
  "sha256" varchar(64) NOT NULL DEFAULT '',
  "ready" boolean NOT NULL DEFAULT false,
  "created_at" datetime,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_content_source" ON "content_objects" ("source_type", "source_id");

CREATE TABLE "ai_messages" (
  "session_id" char(36) NOT NULL,
  "item_id" varchar(256) NOT NULL,
  "position" integer NOT NULL CHECK ("position" >= 0),
  "content_id" char(36),
  "payload" text NOT NULL,
  "content_hash" char(64) NOT NULL,
  PRIMARY KEY ("session_id", "item_id"),
  CONSTRAINT "fk_ai_messages_session" FOREIGN KEY ("session_id") REFERENCES "ai_sessions" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_ai_messages_content" FOREIGN KEY ("content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_ai_messages_content" ON "ai_messages" ("content_id");

CREATE INDEX "idx_ai_messages_order" ON "ai_messages" ("session_id", "position");

CREATE TABLE "ai_model_messages" (
  "session_id" char(36) NOT NULL,
  "item_id" varchar(256) NOT NULL,
  "position" integer NOT NULL CHECK ("position" >= 0),
  "content_id" char(36),
  "payload" text NOT NULL,
  "content_hash" char(64) NOT NULL,
  PRIMARY KEY ("session_id", "item_id"),
  CONSTRAINT "fk_ai_model_messages_session" FOREIGN KEY ("session_id") REFERENCES "ai_sessions" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_ai_model_messages_content" FOREIGN KEY ("content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_ai_model_messages_content" ON "ai_model_messages" ("content_id");

CREATE INDEX "idx_ai_model_messages_order" ON "ai_model_messages" ("session_id", "position");

CREATE TABLE "ai_session_tasks" (
  "session_id" char(36) NOT NULL,
  "item_id" varchar(256) NOT NULL,
  "position" integer NOT NULL CHECK ("position" >= 0),
  "content_id" char(36),
  "payload" text NOT NULL,
  "public_payload" text NOT NULL,
  "public_content_id" char(36),
  "artifact_content_id" char(36),
  "content_hash" char(64) NOT NULL,
  PRIMARY KEY ("session_id", "item_id"),
  CONSTRAINT "fk_ai_session_tasks_session" FOREIGN KEY ("session_id") REFERENCES "ai_sessions" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_ai_session_tasks_content" FOREIGN KEY ("content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_ai_session_tasks_public_content" FOREIGN KEY ("public_content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_ai_session_tasks_artifact_content" FOREIGN KEY ("artifact_content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_ai_session_tasks_content" ON "ai_session_tasks" ("content_id");

CREATE INDEX "idx_ai_session_tasks_order" ON "ai_session_tasks" ("session_id", "position");

CREATE INDEX "idx_ai_session_tasks_public_content" ON "ai_session_tasks" ("public_content_id");
CREATE INDEX "idx_ai_session_tasks_artifact_content" ON "ai_session_tasks" ("artifact_content_id");

CREATE TABLE "ai_tool_executions" (
  "id" char(36) NOT NULL,
  "session_id" char(36) NOT NULL,
  "task_id" char(36) NOT NULL,
  "actor_kind" varchar(16) NOT NULL,
  "actor_id" varchar(80) NOT NULL,
  "actor_session_id" varchar(80) NOT NULL,
  "actor_grant_id" varchar(36) NOT NULL DEFAULT '',
  "tool_name" varchar(50) NOT NULL,
  "server_id" char(36),
  "server_name" varchar(120) NOT NULL DEFAULT '',
  "status" varchar(32) NOT NULL,
  "created_at" datetime NOT NULL,
  "updated_at" datetime NOT NULL,
  "started_at" datetime,
  "finished_at" datetime,
  "recovered_at" datetime,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_ai_tool_identity" ON "ai_tool_executions" ("session_id", "task_id");

CREATE INDEX "idx_ai_tool_session_state" ON "ai_tool_executions" ("session_id", "status");

CREATE INDEX "idx_ai_tool_status" ON "ai_tool_executions" ("status");

CREATE TABLE "auth_tickets" (
  "connection_id" TEXT,
  "actor_kind" varchar(32) NOT NULL,
  "actor_id" varchar(36) NOT NULL,
  "grant_id" varchar(36),
  "requirements" text NOT NULL,
  "id" char(36) NOT NULL,
  "token_hash" text NOT NULL,
  "type" text NOT NULL,
  "ref" text,
  "session_id" char(36),
  "created_at" datetime,
  "expires_at" datetime NOT NULL,
  "used_at" datetime,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_auth_tickets_token_hash" ON "auth_tickets" ("token_hash");

CREATE TABLE "batch_tasks" (
  "id" char(36) NOT NULL,
  "actor_kind" varchar(16) NOT NULL,
  "actor_id" varchar(80) NOT NULL,
  "actor_session_id" varchar(80) NOT NULL,
  "actor_grant_id" varchar(36) NOT NULL DEFAULT '',
  "script_version" varchar(64),
  "parameters" text,
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

CREATE INDEX "idx_batch_tasks_deleted_at" ON "batch_tasks" ("deleted_at");

CREATE TABLE "inbox_notifications" (
  "id" char(36) NOT NULL,
  "owner_id" char(36) NOT NULL,
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

CREATE INDEX "idx_inbox_owner_time" ON "inbox_notifications" ("owner_id", "created_at");

CREATE INDEX "idx_inbox_source" ON "inbox_notifications" ("source_type", "source_id");

CREATE INDEX "idx_inbox_notifications_severity" ON "inbox_notifications" ("severity");

CREATE INDEX "idx_inbox_notifications_read_at" ON "inbox_notifications" ("read_at");

CREATE INDEX "idx_inbox_notifications_created_at" ON "inbox_notifications" ("created_at");

CREATE TABLE "job_queue" (
  "actor_kind" varchar(32) NOT NULL DEFAULT '',
  "actor_id" varchar(36) NOT NULL DEFAULT '',
  "actor_session_id" varchar(36) NOT NULL DEFAULT '',
  "actor_grant_id" varchar(36) NOT NULL DEFAULT '',

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
  "source_type" varchar(50) NOT NULL,
  "source_id" varchar(80) NOT NULL,
  "notification_id" char(36) NOT NULL,
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

CREATE INDEX "idx_notification_deliveries_channel" ON "notification_deliveries" ("channel");

CREATE INDEX "idx_notification_delivery_due" ON "notification_deliveries" ("status", "next_attempt_at");

CREATE INDEX "idx_notification_deliveries_locked_at" ON "notification_deliveries" ("locked_at");

CREATE UNIQUE INDEX "idx_notification_channel" ON "notification_deliveries" ("notification_id", "channel");
CREATE INDEX "idx_notification_delivery_source" ON "notification_deliveries" ("source_type", "source_id");

CREATE TABLE "operation_records" (
  "detail_content_id" char(36),
  "detail_content_size" bigint NOT NULL DEFAULT 0,
  "detail_content_sha256" varchar(64) NOT NULL DEFAULT '',
  "task_content_id" char(36),
  "task_content_size" bigint NOT NULL DEFAULT 0,
  "task_content_sha256" varchar(64) NOT NULL DEFAULT '',
  "work_id" char(36) NOT NULL,
  "parent_work_id" char(36),
  "work_started_at" datetime NOT NULL,
  "attempt" integer NOT NULL DEFAULT 1,
  "established_at" datetime,
  "connection_uncertain_until" datetime,
  "actor_kind" TEXT,
  "actor_id" TEXT,
  "actor_session_id" TEXT,
  "actor_grant_id" TEXT,
  "id" char(36) NOT NULL,
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
  "bytes_completed" integer DEFAULT 0,
  "speed_bps" integer DEFAULT 0,
  "error_message" text,
  "detail_json" text,
  "source_table" text NOT NULL,
  "source_id" text NOT NULL,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  CONSTRAINT "fk_operation_detail_content" FOREIGN KEY ("detail_content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT,
  CHECK ("detail_content_id" IS NULL OR (COALESCE("detail_json",'')='' AND "task_content_id" IS NULL)),
  CONSTRAINT "fk_operation_task_content" FOREIGN KEY ("task_content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT,
  CHECK ("task_content_id" IS NULL OR COALESCE("detail_json",'')=''),
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_operation_detail_content" ON "operation_records" ("detail_content_id");
CREATE INDEX "idx_operation_task_content" ON "operation_records" ("task_content_id");

CREATE INDEX "idx_operation_type_time" ON "operation_records" ("type", "created_at");

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

CREATE TABLE "scheduled_tasks" (
  "id" char(36) NOT NULL,
  "owner_id" char(36) NOT NULL,
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

CREATE INDEX "idx_scheduled_tasks_owner_id" ON "scheduled_tasks" ("owner_id");

CREATE INDEX "idx_scheduled_tasks_deleted_at" ON "scheduled_tasks" ("deleted_at");

CREATE TABLE "scripts" (
  "version" char(64) NOT NULL,
  "id" char(36) NOT NULL,
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
  "saved_passphrase" text,
  "id" char(36) NOT NULL,
  "created_at" datetime,
  "updated_at" datetime,
  "name" varchar(100) NOT NULL,
  "public_key" text NOT NULL,
  "private_key" text NOT NULL,
  "fingerprint" varchar(100) NOT NULL,
  "algorithm" varchar(20) NOT NULL,
  "key_size" integer DEFAULT 0,
  "passphrase_required" numeric,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_ssh_key_fingerprint" ON "ssh_keys" ("fingerprint");

CREATE TABLE "server_groups" (
  "id" char(36) NOT NULL PRIMARY KEY,
  "name" varchar(100) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0 CHECK ("sort_order" >= 0)
);
CREATE INDEX "idx_server_groups_order" ON "server_groups" ("sort_order", "id");

CREATE TABLE "servers" (
  "jump_server_id" char(36) REFERENCES servers(id) ON DELETE RESTRICT,
  "connection_revision" bigint NOT NULL DEFAULT 1 CHECK ("connection_revision" > 0),
  "id" char(36) NOT NULL,
  "name" text,
  "host" text NOT NULL,
  "port" integer NOT NULL DEFAULT 22 CHECK ("port" BETWEEN 1 AND 65535),
  "username" text NOT NULL,
  "group_id" char(36),
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
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_servers_group" FOREIGN KEY ("group_id") REFERENCES "server_groups" ("id") ON DELETE SET NULL
);

CREATE TABLE "tags" (
  "name" varchar(100) NOT NULL PRIMARY KEY
);
CREATE TABLE "server_tags" (
  "server_id" char(36) NOT NULL,
  "tag_name" varchar(100) NOT NULL,
  PRIMARY KEY ("server_id","tag_name"),
  CONSTRAINT "fk_server_tags_server" FOREIGN KEY ("server_id") REFERENCES "servers" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_server_tags_tag" FOREIGN KEY ("tag_name") REFERENCES "tags" ("name") ON DELETE RESTRICT
);
CREATE INDEX "idx_server_tags_name" ON "server_tags" ("tag_name","server_id");

CREATE INDEX "idx_servers_deleted_at" ON "servers" ("deleted_at");

CREATE INDEX "idx_servers_group_id" ON "servers" ("group_id");

CREATE INDEX "idx_servers_sort_order" ON "servers" ("sort_order");

CREATE TABLE "ssh_host_keys" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  "host" varchar(255) NOT NULL,
  "port" integer NOT NULL CHECK ("port" BETWEEN 1 AND 65535),
  "key_type" varchar(50) NOT NULL,
  "public_key" text NOT NULL,
  "fingerprint" varchar(100) NOT NULL,
  "confirmed_at" datetime NOT NULL,
  "first_seen" datetime NOT NULL,
  "last_seen" datetime NOT NULL,
  "trust_status" varchar(20) NOT NULL DEFAULT 'trusted'
);

CREATE INDEX "idx_ssh_host_keys_deleted_at" ON "ssh_host_keys" ("deleted_at");

CREATE UNIQUE INDEX "idx_host_port_type" ON "ssh_host_keys" ("host", "port", "key_type");

CREATE INDEX "idx_ssh_host_keys_fingerprint" ON "ssh_host_keys" ("fingerprint");

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

CREATE TABLE "owner_devices" (
  "revoked" numeric NOT NULL DEFAULT false,
  "id" char(36) NOT NULL,
  "owner_id" char(36) NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "created_at" datetime,
  "expires_at" datetime,
  "last_used_at" datetime,
  "scopes" text,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_owner_devices_owner_id" ON "owner_devices" ("owner_id");

CREATE UNIQUE INDEX "idx_owner_devices_token_hash" ON "owner_devices" ("token_hash");

CREATE TABLE "sync_instance" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "uuid" char(36) NOT NULL
);

CREATE TABLE "sync_states" (
  "owner_id" char(36) NOT NULL,
  "document" text,
  "revision" integer,
  "updated_at" datetime,
  "disabled" numeric NOT NULL DEFAULT false,
  PRIMARY KEY ("owner_id")
);

CREATE TABLE "sync_vault_documents" (
  "owner_id" char(36) NOT NULL,
  "kind" text NOT NULL,
  "resource_id" text NOT NULL,
  "document" text,
  "current_ref" text,
  "observed_ref" text,
  "revision" integer,
  "updated_at" datetime,
  "conflicts" text,
  "applied_ref" text,
  PRIMARY KEY ("owner_id", "kind", "resource_id")
);

CREATE TABLE "sync_vault_objects" (
  "owner_id" char(36) NOT NULL,
  "id" text NOT NULL,
  "kind" text NOT NULL,
  "resource_id" text NOT NULL,
  "ciphertext" text,
  "created_at" datetime,
  PRIMARY KEY ("owner_id", "id")
);

CREATE TABLE "system_config" (
  "public_url" text,
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "system_name" text NOT NULL DEFAULT 'EasySSH',
  "system_logo" text,
  "system_favicon" text,
  "default_language" text NOT NULL DEFAULT 'zh-CN',
  "default_timezone" text NOT NULL DEFAULT 'Asia/Shanghai',
  "date_format" text NOT NULL DEFAULT 'YYYY-MM-DD HH:mm:ss',
  "download_exclude_patterns" text,
  "skip_excluded_on_upload" numeric NOT NULL DEFAULT true,
  "max_file_upload_size" integer NOT NULL DEFAULT 100,
  "transfer_storage_path" text,
  "transfer_retention_days" integer NOT NULL DEFAULT 3,
  "transfer_max_storage_gb" integer NOT NULL DEFAULT 10,
  "transfer_max_concurrency" integer NOT NULL DEFAULT 2,
  "transfer_max_entries" integer NOT NULL DEFAULT 100000,
  "transfer_max_depth" integer NOT NULL DEFAULT 128,
  "transfer_cleanup_enabled" numeric NOT NULL DEFAULT true,
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
  "content_id" char(36),
  "content_size" bigint NOT NULL DEFAULT 0,
  "content_sha256" varchar(64) NOT NULL DEFAULT '',
  "id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  "task_run_id" char(36) NOT NULL,
  "level" text NOT NULL DEFAULT 'info',
  "message" text NOT NULL,
  "data_json" text,
  "created_at" datetime,
  CONSTRAINT "fk_task_events_content" FOREIGN KEY ("content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT
);
CREATE INDEX "idx_task_events_content_id" ON "task_events" ("content_id");

CREATE INDEX "idx_task_events_run_cursor" ON "task_events" ("task_run_id", "id");

CREATE INDEX "idx_task_events_created_at" ON "task_events" ("created_at");

CREATE TABLE "task_runs" (
  "content_id" char(36),
  "content_size" bigint NOT NULL DEFAULT 0,
  "content_sha256" varchar(64) NOT NULL DEFAULT '',
  "work_id" char(36) NOT NULL,
  "parent_work_id" char(36),
  "work_started_at" datetime NOT NULL,
  "definition_version" varchar(36),
  "actor_kind" varchar(32) NOT NULL DEFAULT '',
  "actor_id" varchar(36) NOT NULL DEFAULT '',
  "actor_session_id" varchar(36) NOT NULL DEFAULT '',
  "actor_grant_id" varchar(36) NOT NULL DEFAULT '',

  "id" char(36) NOT NULL,
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
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_task_runs_content" FOREIGN KEY ("content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT,
  CHECK ("content_id" IS NULL OR ("description"='' AND "payload_json"='' AND "result_json"='' AND "progress_json"=''))
);

CREATE INDEX "idx_task_runs_content_id" ON "task_runs" ("content_id");

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
  "owner_id" char(36) NOT NULL,
  "counter" integer NOT NULL,
  "used_at" datetime NOT NULL,
  PRIMARY KEY ("owner_id", "counter")
);

CREATE TABLE "transfer_jobs" (
  "actor_kind" varchar(32) NOT NULL DEFAULT '',
  "actor_id" varchar(36) NOT NULL DEFAULT '',
  "actor_session_id" varchar(36) NOT NULL DEFAULT '',
  "actor_grant_id" varchar(36) NOT NULL DEFAULT '',

  "id" char(36) NOT NULL,
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
  "artifact_cleaned_at" datetime,
  "progress" integer DEFAULT 0,
  "bytes_total" integer DEFAULT 0,
  "bytes_processed" integer DEFAULT 0,
  "bytes_completed" integer NOT NULL DEFAULT 0,
  "files_total" integer NOT NULL DEFAULT 0,
  "files_completed" integer NOT NULL DEFAULT 0,
  "result_path" text,
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

CREATE INDEX "idx_transfer_jobs_kind" ON "transfer_jobs" ("kind");

CREATE INDEX "idx_transfer_jobs_status" ON "transfer_jobs" ("status");

CREATE INDEX "idx_transfer_jobs_stage" ON "transfer_jobs" ("stage");

CREATE INDEX "idx_transfer_jobs_source_server_id" ON "transfer_jobs" ("source_server_id");

CREATE INDEX "idx_transfer_jobs_target_server_id" ON "transfer_jobs" ("target_server_id");

CREATE INDEX "idx_transfer_jobs_artifact_expires_at" ON "transfer_jobs" ("artifact_expires_at");

CREATE INDEX "idx_transfer_jobs_scheduled_task_id" ON "transfer_jobs" ("scheduled_task_id");

CREATE UNIQUE INDEX "idx_transfer_jobs_task_run_id" ON "transfer_jobs" ("task_run_id");

CREATE INDEX "idx_transfer_jobs_started_at" ON "transfer_jobs" ("started_at");

CREATE INDEX "idx_transfer_jobs_finished_at" ON "transfer_jobs" ("finished_at");

CREATE INDEX "idx_transfer_jobs_created_at" ON "transfer_jobs" ("created_at");

CREATE INDEX "idx_transfer_jobs_deleted_at" ON "transfer_jobs" ("deleted_at");

CREATE TABLE "known_login_devices" (
  "id" char(36) NOT NULL,
  "owner_id" char(36) NOT NULL,
  "device_fingerprint" text NOT NULL,
  "device_type" text,
  "device_name" text,
  "last_ip_address" text,
  "last_location" text,
  "last_used" datetime,
  "created_at" datetime,
  "updated_at" datetime,
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_known_login_owner_fp" ON "known_login_devices" ("owner_id", "device_fingerprint");

CREATE TABLE "owner_sessions" (
  "token_hash" varchar(64) NOT NULL,
  "csrf_hash" varchar(64) NOT NULL,
  "revoked_at" datetime,
  "id" char(36) NOT NULL,
  "owner_id" char(36) NOT NULL,
  "device_type" text,
  "device_name" text,
  "ip_address" text,
  "location" text,
  "user_agent" text,
  "last_activity" datetime NOT NULL,
  "expires_at" datetime NOT NULL,
  "remember_login" numeric NOT NULL DEFAULT false,
  "created_at" datetime,
  "device_fingerprint" text,
  "is_new_device" numeric DEFAULT false,
  "is_new_location" numeric DEFAULT false,
  PRIMARY KEY ("id")
);

CREATE INDEX "idx_sessions_owner_expires" ON "owner_sessions" ("owner_id", "expires_at");

CREATE INDEX "idx_owner_sessions_expires_at" ON "owner_sessions" ("expires_at");

CREATE TABLE "owners" (
  "slot" integer NOT NULL CHECK ("slot" = 1),
  "pending_two_factor_secret" text,
  "pending_two_factor_expires_at" datetime,
  "id" char(36) NOT NULL,
  "username" text NOT NULL,
  "email" text NOT NULL,
  "password" text NOT NULL,
  "avatar" text,
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
  PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idx_owners_email" ON "owners" ("email");

CREATE INDEX "idx_owners_locked" ON "owners" ("locked_until");

-- Personal workspace sharing. Secrets are verification digests only.
CREATE TABLE "grants" (
  "purpose" varchar(16) NOT NULL DEFAULT 'share',
  "id" char(36) NOT NULL PRIMARY KEY,
  "public_id" varchar(64) NOT NULL UNIQUE,
  "secret_hash" varchar(64) NOT NULL,
  "name" varchar(100) NOT NULL,
  "version" bigint NOT NULL CHECK ("version" > 0),
  "default_content" varchar(32) NOT NULL,
  "expires_at" datetime,
  "revoked_at" datetime,
  "max_sessions" integer NOT NULL CHECK ("max_sessions" BETWEEN 1 AND 100),
  "max_connections" integer NOT NULL CHECK ("max_connections" BETWEEN 1 AND 100),
  "upload_limit" bigint CHECK ("upload_limit" >= 0),
  "download_limit" bigint CHECK ("download_limit" >= 0),
  "ai_request_limit" bigint CHECK ("ai_request_limit" >= 0),
  "uploaded_bytes" bigint NOT NULL DEFAULT 0 CHECK ("uploaded_bytes" >= 0),
  "downloaded_bytes" bigint NOT NULL DEFAULT 0 CHECK ("downloaded_bytes" >= 0),
  "ai_requests" bigint NOT NULL DEFAULT 0 CHECK ("ai_requests" >= 0),
  "created_at" datetime NOT NULL,
  "updated_at" datetime NOT NULL
);
CREATE INDEX "idx_grants_expiry" ON "grants" ("revoked_at", "expires_at");

CREATE TABLE "grant_resources" (
  "grant_id" char(36) NOT NULL,
  "server_id" char(36) NOT NULL,
  "actions" text NOT NULL,
  "approved_connection_revision" bigint NOT NULL CHECK ("approved_connection_revision" > 0),
  "allow_interactive" boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("grant_id", "server_id"),
  FOREIGN KEY ("grant_id") REFERENCES "grants" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("server_id") REFERENCES "servers" ("id") ON DELETE CASCADE
);
CREATE INDEX "idx_grant_resources_server" ON "grant_resources" ("server_id");

CREATE TABLE "grant_script_scopes" (
  "grant_id" char(36) NOT NULL,
  "server_id" char(36) NOT NULL,
  "script_id" char(36) NOT NULL,
  "version" varchar(64) NOT NULL,
  "parameters" text NOT NULL,
  PRIMARY KEY ("grant_id", "server_id", "script_id"),
  FOREIGN KEY ("grant_id", "server_id") REFERENCES "grant_resources" ("grant_id", "server_id") ON DELETE CASCADE,
  FOREIGN KEY ("script_id") REFERENCES "scripts" ("id") ON DELETE CASCADE
);

CREATE TABLE "access_containers" (
  "id" char(36) NOT NULL PRIMARY KEY,
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "csrf_hash" varchar(64) NOT NULL,
  "created_at" datetime NOT NULL,
  "expires_at" datetime NOT NULL
);
CREATE INDEX "idx_access_containers_expiry" ON "access_containers" ("expires_at");

CREATE TABLE "access_sessions" (
  "id" char(36) NOT NULL PRIMARY KEY,
  "grant_id" char(36) NOT NULL,
  "grant_version" bigint NOT NULL CHECK ("grant_version" > 0),
  "client_kind" varchar(16) NOT NULL CHECK ("client_kind" IN ('browser', 'desktop')),
  "token_hash" varchar(64) UNIQUE,
  "container_id" char(36),
  "created_at" datetime NOT NULL,
  "last_seen_at" datetime NOT NULL,
  "expires_at" datetime NOT NULL,
  "revoked_at" datetime,
  FOREIGN KEY ("grant_id") REFERENCES "grants" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("container_id") REFERENCES "access_containers" ("id") ON DELETE RESTRICT,
  CHECK (("client_kind" = 'browser' AND "container_id" IS NOT NULL AND "token_hash" IS NULL)
      OR ("client_kind" = 'desktop' AND "container_id" IS NULL AND "token_hash" IS NOT NULL))
);
CREATE INDEX "idx_access_sessions_grant" ON "access_sessions" ("grant_id", "grant_version", "revoked_at", "expires_at");
CREATE INDEX "idx_access_sessions_container" ON "access_sessions" ("container_id", "grant_id");
CREATE INDEX "idx_access_sessions_idle" ON "access_sessions" ("revoked_at", "last_seen_at");

CREATE TABLE "access_handoffs" (
  "id" char(36) NOT NULL PRIMARY KEY,
  "source_session_id" char(36) NOT NULL,
  "receiver_hash" varchar(64) NOT NULL,
  "receiver_name" varchar(100) NOT NULL,
  "created_at" datetime NOT NULL,
  "expires_at" datetime NOT NULL,
  "approved_at" datetime,
  "consumed_at" datetime,
  FOREIGN KEY ("source_session_id") REFERENCES "access_sessions" ("id") ON DELETE CASCADE
);
CREATE INDEX "idx_access_handoffs_expiry" ON "access_handoffs" ("expires_at");

CREATE UNIQUE INDEX "idx_owners_slot" ON "owners" ("slot");

CREATE UNIQUE INDEX "idx_owner_sessions_token_hash" ON "owner_sessions" ("token_hash");

CREATE TABLE "ssh_key_aliases" (
  "alias_id" char(36) NOT NULL PRIMARY KEY,
  "canonical_id" char(36) NOT NULL,
  "fingerprint" varchar(100) NOT NULL,
  FOREIGN KEY ("canonical_id") REFERENCES "ssh_keys" ("id") ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE "server_auth" (
  "server_id" char(36) NOT NULL PRIMARY KEY,
  "auth_method" varchar(64) NOT NULL,
  "password" text,
  "ssh_key_id" char(36),
  FOREIGN KEY ("server_id") REFERENCES "servers" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("ssh_key_id") REFERENCES "ssh_keys" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_server_auth_ssh_key" ON "server_auth" ("ssh_key_id");

CREATE INDEX "idx_task_runs_actor_time" ON "task_runs" ("actor_kind", "actor_session_id", "created_at");

CREATE INDEX "idx_operation_actor_time" ON "operation_records" ("actor_kind", "actor_session_id", "created_at");

CREATE INDEX "idx_task_runs_work" ON "task_runs" ("work_id", "work_started_at");

CREATE INDEX "idx_operation_records_work" ON "operation_records" ("work_id", "work_started_at");

CREATE TABLE "operation_resources" (
 "record_id" char(36) NOT NULL,
 "server_id" char(36) NOT NULL,
 "name" varchar(120) NOT NULL,
 PRIMARY KEY ("record_id", "server_id"),
 FOREIGN KEY ("record_id") REFERENCES "operation_records" ("id") ON DELETE CASCADE
);
CREATE INDEX "idx_operation_resources_server" ON "operation_resources" ("server_id");

CREATE TABLE "activity_coverage" (
 "id" varchar(20) PRIMARY KEY,
 "started_at" datetime NOT NULL,
 "pruned_before" datetime
);

CREATE INDEX "idx_transfer_actor_time" ON "transfer_jobs" ("actor_kind", "actor_session_id", "created_at");

CREATE UNIQUE INDEX "idx_task_work_attempt" ON "task_runs" ("work_id", "attempt");

CREATE INDEX "idx_batch_tasks_actor" ON "batch_tasks" ("actor_kind", "actor_id", "actor_session_id", "actor_grant_id");

CREATE INDEX idx_servers_jump_server_id ON servers(jump_server_id);

CREATE TABLE "automation_tokens" (
  "session_id" char(36) PRIMARY KEY,
  "name" varchar(100) NOT NULL,
  "grant_id" char(36) NOT NULL,
  "grant_version" bigint NOT NULL,
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "created_at" datetime NOT NULL,
  "last_seen_at" datetime NOT NULL,
  "expires_at" datetime NOT NULL,
  "revoked_at" datetime,
  FOREIGN KEY ("grant_id") REFERENCES "grants" ("id") ON DELETE CASCADE
);

CREATE TABLE "server_vnc_configs" (
  "server_id" char(36) PRIMARY KEY,
  "enabled" boolean NOT NULL DEFAULT false,
  "port" integer NOT NULL DEFAULT 5900 CHECK ("port" BETWEEN 1 AND 65535),
  "tls" boolean NOT NULL DEFAULT false,
  FOREIGN KEY ("server_id") REFERENCES "servers" ("id") ON DELETE CASCADE
);

CREATE TABLE server_rdp_configs (
  server_id char(36) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  port integer NOT NULL DEFAULT 3389 CHECK (port BETWEEN 1 AND 65535),
  security varchar(8) NOT NULL DEFAULT 'nla' CHECK (security IN ('nla', 'tls')),
  ignore_certificate boolean NOT NULL DEFAULT false,
  FOREIGN KEY (server_id) REFERENCES servers (id) ON DELETE CASCADE
);

CREATE TABLE chat_connections (
  revision bigint NOT NULL DEFAULT 1,
  provider varchar(16) NOT NULL DEFAULT 'telegram',
  app_id varchar(100),
  id char(36) PRIMARY KEY,
  owner_id char(36) NOT NULL,
  name varchar(100) NOT NULL,
  token_cipher TEXT NOT NULL,
  bot_id bigint NOT NULL UNIQUE,
  bot_username varchar(100) NOT NULL,
  server_ids_json TEXT NOT NULL,
  permission_mode varchar(16) NOT NULL CHECK (permission_mode IN ('readonly', 'balanced')),
  enabled boolean NOT NULL DEFAULT false,
  next_update_id bigint NOT NULL DEFAULT 0,
  bind_code_hash varchar(64) NOT NULL DEFAULT '',
  bind_expires_at datetime,
  last_poll_at datetime,
  last_error TEXT NOT NULL,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES owners (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_chat_connection_app ON chat_connections (provider, app_id);

CREATE TABLE chat_bindings (
  message_count integer NOT NULL DEFAULT 0,
  watching boolean NOT NULL DEFAULT false,
  external_user_id varchar(128) NOT NULL DEFAULT '',
  external_chat_id varchar(128) NOT NULL DEFAULT '',
  id char(36) PRIMARY KEY,
  connection_id char(36) NOT NULL,
  user_id bigint NOT NULL,
  chat_id bigint NOT NULL,
  display_name varchar(400) NOT NULL,
  current_session_id varchar(36) NOT NULL DEFAULT '',
  revoked_at datetime,
  created_at datetime NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES chat_connections (id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_binding_user ON chat_bindings (connection_id, user_id);

CREATE INDEX idx_chat_binding_watch ON chat_bindings (watching);

CREATE INDEX idx_chat_binding_external_user ON chat_bindings (connection_id, external_user_id);

CREATE TABLE chat_approvals (
  id char(32) PRIMARY KEY,
  binding_id char(36) NOT NULL,
  session_id char(36) NOT NULL,
  task_id varchar(100) NOT NULL,
  digest varchar(64) NOT NULL,
  expires_at datetime NOT NULL,
  used_at datetime,
  UNIQUE (session_id, task_id),
  FOREIGN KEY (binding_id) REFERENCES chat_bindings (id) ON DELETE CASCADE
);

CREATE TABLE chat_received_events (
  id char(36) PRIMARY KEY,
  connection_id char(36) NOT NULL,
  created_at datetime NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES chat_connections (id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_received_connection ON chat_received_events (connection_id);
