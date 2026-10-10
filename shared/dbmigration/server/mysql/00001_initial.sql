-- Frozen initial schema. Add a numbered migration for subsequent changes.

-- +goose NO TRANSACTION

-- +goose Up

CREATE TABLE `ai_config` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `system_enabled` boolean DEFAULT false,
  `system_provider` varchar(20),
  `system_api_key` longtext,
  `system_api_endpoint` longtext,
  `system_models` longtext,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_ai_config_deleted_at` ON `ai_config` (`deleted_at`);

CREATE TABLE `ai_sessions` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `model` longtext,
  `title` longtext,
  `permission_mode` varchar(32) NOT NULL,
  `status` varchar(32) NOT NULL,
  `messages` longtext NOT NULL,
  `message_views` longtext NOT NULL,
  `tasks` longtext NOT NULL,
  `task_order` longtext NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_ai_sessions_user_updated` ON `ai_sessions` (`user_id`, `updated_at`);

CREATE INDEX `idx_ai_sessions_status` ON `ai_sessions` (`status`);

CREATE INDEX `idx_ai_sessions_deleted_at` ON `ai_sessions` (`deleted_at`);

CREATE TABLE `auth_tickets` (
  `id` char(36) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  `type` varchar(40) NOT NULL,
  `ref` varchar(255),
  `user_id` char(36) NOT NULL,
  `username` varchar(100),
  `email` varchar(255),
  `role` varchar(40),
  `session_id` char(36),
  `payload_json` longtext,
  `created_at` datetime(3),
  `expires_at` datetime(3) NOT NULL,
  `used_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE UNIQUE INDEX `idx_auth_tickets_token_hash` ON `auth_tickets` (`token_hash`);

CREATE INDEX `idx_auth_tickets_type` ON `auth_tickets` (`type`);

CREATE INDEX `idx_auth_tickets_ref` ON `auth_tickets` (`ref`);

CREATE INDEX `idx_auth_tickets_user_id` ON `auth_tickets` (`user_id`);

CREATE INDEX `idx_auth_tickets_session_id` ON `auth_tickets` (`session_id`);

CREATE INDEX `idx_auth_tickets_expires_at` ON `auth_tickets` (`expires_at`);

CREATE INDEX `idx_auth_tickets_used_at` ON `auth_tickets` (`used_at`);

CREATE TABLE `batch_tasks` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `task_name` varchar(100) NOT NULL,
  `task_type` varchar(20) NOT NULL,
  `content` longtext,
  `script_id` char(36),
  `server_ids` longtext NOT NULL,
  `execution_mode` varchar(20) DEFAULT 'parallel',
  `status` varchar(20) DEFAULT 'pending',
  `success_count` bigint DEFAULT 0,
  `failed_count` bigint DEFAULT 0,
  `started_at` datetime(3),
  `completed_at` datetime(3),
  `duration` bigint,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_batch_tasks_user_id` ON `batch_tasks` (`user_id`);

CREATE INDEX `idx_batch_tasks_deleted_at` ON `batch_tasks` (`deleted_at`);

CREATE TABLE `casbin_rule` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `ptype` varchar(100),
  `v0` varchar(100),
  `v1` varchar(100),
  `v2` varchar(100),
  `v3` varchar(100),
  `v4` varchar(100),
  `v5` varchar(100),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE UNIQUE INDEX `idx_casbin_rule` ON `casbin_rule` (`ptype`, `v0`, `v1`, `v2`, `v3`, `v4`, `v5`);

CREATE TABLE `inbox_notifications` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `event_type` varchar(60) NOT NULL,
  `severity` varchar(20) NOT NULL,
  `title` varchar(180) NOT NULL,
  `message` longtext NOT NULL,
  `source_type` varchar(50),
  `source_id` varchar(80),
  `action_url` longtext,
  `data_json` longtext,
  `read_at` datetime(3),
  `created_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_inbox_notifications_user_id` ON `inbox_notifications` (`user_id`);

CREATE INDEX `idx_inbox_user_time` ON `inbox_notifications` (`user_id`, `created_at`);

CREATE INDEX `idx_inbox_notifications_event_type` ON `inbox_notifications` (`event_type`);

CREATE INDEX `idx_inbox_notifications_severity` ON `inbox_notifications` (`severity`);

CREATE INDEX `idx_inbox_notifications_source_type` ON `inbox_notifications` (`source_type`);

CREATE INDEX `idx_inbox_notifications_source_id` ON `inbox_notifications` (`source_id`);

CREATE INDEX `idx_inbox_notifications_read_at` ON `inbox_notifications` (`read_at`);

CREATE INDEX `idx_inbox_notifications_created_at` ON `inbox_notifications` (`created_at`);

CREATE TABLE `job_queue` (
  `id` char(36) NOT NULL,
  `kind` varchar(80) NOT NULL,
  `source_type` varchar(80) NOT NULL,
  `source_id` varchar(191) NOT NULL,
  `dedupe_key` varchar(191),
  `payload_json` longtext NOT NULL,
  `status` varchar(20) NOT NULL,
  `priority` bigint NOT NULL DEFAULT 0,
  `available_at` datetime(3) NOT NULL,
  `claimed_by` varchar(191),
  `claimed_at` datetime(3),
  `heartbeat_at` datetime(3),
  `lease_expires_at` datetime(3),
  `attempt` bigint NOT NULL DEFAULT 0,
  `max_attempts` bigint NOT NULL DEFAULT 3,
  `last_error` longtext,
  `finished_at` datetime(3),
  `created_at` datetime(3),
  `updated_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_job_queue_kind` ON `job_queue` (`kind`);

CREATE INDEX `idx_job_queue_source` ON `job_queue` (`source_type`, `source_id`);

CREATE UNIQUE INDEX `idx_job_queue_dedupe_key` ON `job_queue` (`dedupe_key`);

CREATE INDEX `idx_job_queue_claim` ON `job_queue` (`status`, `priority`, `available_at`);

CREATE INDEX `idx_job_queue_claimed_by` ON `job_queue` (`claimed_by`);

CREATE INDEX `idx_job_queue_lease_expires_at` ON `job_queue` (`lease_expires_at`);

CREATE INDEX `idx_job_queue_finished_at` ON `job_queue` (`finished_at`);

CREATE INDEX `idx_job_queue_created_at` ON `job_queue` (`created_at`);

CREATE TABLE `login_alerts` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `session_id` char(36),
  `alert_type` varchar(50),
  `ip_address` varchar(45),
  `location` varchar(200),
  `device_info` longtext,
  `notified_at` datetime(3),
  `acknowledged` boolean DEFAULT false,
  `created_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_alert_user_time` ON `login_alerts` (`user_id`, `created_at`);

CREATE INDEX `idx_login_alerts_alert_type` ON `login_alerts` (`alert_type`);

CREATE INDEX `idx_login_alerts_acknowledged` ON `login_alerts` (`acknowledged`);

CREATE TABLE `login_attempts` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `email` varchar(100),
  `ip_address` varchar(45),
  `user_agent` longtext,
  `success` boolean DEFAULT false,
  `fail_reason` varchar(100),
  `created_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_attempt_email_time` ON `login_attempts` (`email`, `created_at`);

CREATE INDEX `idx_attempt_ip_time` ON `login_attempts` (`ip_address`, `created_at`);

CREATE INDEX `idx_login_attempts_success` ON `login_attempts` (`success`);

CREATE INDEX `idx_login_attempts_created_at` ON `login_attempts` (`created_at`);

CREATE TABLE `notification_config` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `smtp_config` longtext,
  `webhook_config` longtext,
  `ding_talk_config` longtext,
  `we_com_config` longtext,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_notification_config_deleted_at` ON `notification_config` (`deleted_at`);

CREATE TABLE `notification_deliveries` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `notification_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `channel` varchar(30) NOT NULL,
  `status` varchar(20) NOT NULL,
  `payload_json` longtext NOT NULL,
  `attempt_count` bigint NOT NULL DEFAULT 0,
  `max_attempts` bigint NOT NULL DEFAULT 5,
  `next_attempt_at` datetime(3) NOT NULL,
  `last_attempt_at` datetime(3),
  `locked_at` datetime(3),
  `error_message` longtext,
  `sent_at` datetime(3),
  `created_at` datetime(3),
  `updated_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_notification_deliveries_notification_id` ON `notification_deliveries` (`notification_id`);

CREATE INDEX `idx_notification_deliveries_user_id` ON `notification_deliveries` (`user_id`);

CREATE INDEX `idx_notification_deliveries_channel` ON `notification_deliveries` (`channel`);

CREATE INDEX `idx_notification_delivery_due` ON `notification_deliveries` (`status`, `next_attempt_at`);

CREATE INDEX `idx_notification_deliveries_locked_at` ON `notification_deliveries` (`locked_at`);

CREATE TABLE `oauth_client_assertions` (
  `jti_hash` varchar(64) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `created_at` datetime(3),
  PRIMARY KEY (`jti_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_oauth_client_assertions_expires_at` ON `oauth_client_assertions` (`expires_at`);

CREATE TABLE `oauth_clients` (
  `id` varchar(191) NOT NULL,
  `name` longtext NOT NULL,
  `secret_hash` longtext,
  `redirect_uris` longtext,
  `grant_types` longtext,
  `response_types` longtext,
  `scopes` longtext,
  `audience` longtext,
  `public` boolean NOT NULL DEFAULT false,
  `token_endpoint_auth_method` longtext NOT NULL DEFAULT ('client_secret_basic'),
  `request_object_signing_alg` longtext,
  `token_endpoint_auth_signing_alg` longtext,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_oauth_clients_deleted_at` ON `oauth_clients` (`deleted_at`);

CREATE TABLE `oauth_grants` (
  `id` char(36) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `signature` varchar(255) NOT NULL,
  `request_id` varchar(100) NOT NULL,
  `access_signature` varchar(255),
  `request_data` longtext NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `expires_at` datetime(3) NOT NULL,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE UNIQUE INDEX `idx_oauth_grant_kind_signature` ON `oauth_grants` (`kind`, `signature`);

CREATE INDEX `idx_oauth_grants_request_id` ON `oauth_grants` (`request_id`);

CREATE INDEX `idx_oauth_grants_access_signature` ON `oauth_grants` (`access_signature`);

CREATE INDEX `idx_oauth_grants_active` ON `oauth_grants` (`active`);

CREATE INDEX `idx_oauth_grants_expires_at` ON `oauth_grants` (`expires_at`);

CREATE TABLE `oauth_login_challenges` (
  `id` char(36) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  `user_id` char(36) NOT NULL,
  `request_data` longtext NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `used_at` datetime(3),
  `created_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE UNIQUE INDEX `idx_oauth_login_challenges_token_hash` ON `oauth_login_challenges` (`token_hash`);

CREATE INDEX `idx_oauth_login_challenges_user_id` ON `oauth_login_challenges` (`user_id`);

CREATE INDEX `idx_oauth_login_challenges_expires_at` ON `oauth_login_challenges` (`expires_at`);

CREATE TABLE `oauth_signing_keys` (
  `id` varchar(64) NOT NULL,
  `encrypted_private_pem` longtext NOT NULL,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `operation_records` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `username` varchar(50),
  `type` varchar(30) NOT NULL,
  `category` varchar(20) NOT NULL DEFAULT 'activity',
  `action` varchar(50) NOT NULL,
  `status` varchar(30) NOT NULL,
  `server_id` char(36),
  `server_name` varchar(100),
  `title` varchar(255),
  `resource` longtext,
  `source` varchar(50),
  `ip` varchar(45),
  `user_agent` varchar(500),
  `started_at` datetime(3),
  `finished_at` datetime(3),
  `duration_ms` bigint DEFAULT 0,
  `progress` bigint DEFAULT 0,
  `total_count` bigint DEFAULT 0,
  `success_count` bigint DEFAULT 0,
  `failure_count` bigint DEFAULT 0,
  `bytes_total` bigint DEFAULT 0,
  `bytes_processed` bigint DEFAULT 0,
  `speed_bps` bigint DEFAULT 0,
  `error_message` longtext,
  `detail_json` longtext,
  `source_table` varchar(80) NOT NULL,
  `source_id` varchar(80) NOT NULL,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_operation_records_user_id` ON `operation_records` (`user_id`);

CREATE INDEX `idx_operation_user_time` ON `operation_records` (`user_id`, `created_at`);

CREATE INDEX `idx_operation_records_type` ON `operation_records` (`type`);

CREATE INDEX `idx_operation_type_time` ON `operation_records` (`type`, `created_at`);

CREATE INDEX `idx_operation_records_category` ON `operation_records` (`category`);

CREATE INDEX `idx_operation_category_time` ON `operation_records` (`category`, `created_at`);

CREATE INDEX `idx_operation_records_action` ON `operation_records` (`action`);

CREATE INDEX `idx_operation_records_status` ON `operation_records` (`status`);

CREATE INDEX `idx_operation_records_server_id` ON `operation_records` (`server_id`);

CREATE INDEX `idx_operation_records_source` ON `operation_records` (`source`);

CREATE INDEX `idx_operation_ip_time` ON `operation_records` (`ip`, `created_at`);

CREATE INDEX `idx_operation_records_started_at` ON `operation_records` (`started_at`);

CREATE INDEX `idx_operation_records_finished_at` ON `operation_records` (`finished_at`);

CREATE UNIQUE INDEX `idx_operation_source` ON `operation_records` (`source_table`, `source_id`);

CREATE INDEX `idx_operation_records_created_at` ON `operation_records` (`created_at`);

CREATE INDEX `idx_operation_records_deleted_at` ON `operation_records` (`deleted_at`);

CREATE TABLE `roles` (
  `id` char(36) NOT NULL,
  `key` varchar(64) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` longtext,
  `parent_key` varchar(64),
  `system` boolean NOT NULL DEFAULT false,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE UNIQUE INDEX `idx_roles_key` ON `roles` (`key`);

CREATE INDEX `idx_roles_parent_key` ON `roles` (`parent_key`);

CREATE INDEX `idx_roles_deleted_at` ON `roles` (`deleted_at`);

CREATE TABLE `scheduled_tasks` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `task_name` varchar(100) NOT NULL,
  `task_type` varchar(40) NOT NULL,
  `script_id` char(36),
  `command` longtext,
  `payload_json` longtext,
  `server_ids` longtext,
  `cron_expression` varchar(100) NOT NULL,
  `timezone` varchar(50) DEFAULT 'UTC',
  `enabled` boolean DEFAULT true,
  `last_run_at` datetime(3),
  `next_run_at` datetime(3),
  `run_count` bigint DEFAULT 0,
  `failure_count` bigint DEFAULT 0,
  `last_status` varchar(20),
  `description` longtext,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_scheduled_tasks_user_id` ON `scheduled_tasks` (`user_id`);

CREATE INDEX `idx_scheduled_tasks_deleted_at` ON `scheduled_tasks` (`deleted_at`);

CREATE TABLE `scripts` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` longtext,
  `content` longtext NOT NULL,
  `language` varchar(20) DEFAULT 'bash',
  `tags` longtext,
  `executions` bigint DEFAULT 0,
  `author` varchar(50),
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_scripts_user_id` ON `scripts` (`user_id`);

CREATE INDEX `idx_scripts_deleted_at` ON `scripts` (`deleted_at`);

CREATE TABLE `security_config` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `session_timeout` bigint NOT NULL DEFAULT 30,
  `max_tabs` bigint NOT NULL DEFAULT 10,
  `inactive_minutes` bigint NOT NULL DEFAULT 15,
  `remember_login` boolean NOT NULL DEFAULT true,
  `hibernate` boolean NOT NULL DEFAULT true,
  `allowlist_ips` longtext,
  `blocklist_ips` longtext,
  `cors_config` longtext,
  `trusted_proxies` longtext NOT NULL DEFAULT ('127.0.0.1'),
  `cookie_secure_mode` varchar(16) NOT NULL DEFAULT ('auto'),
  `cookie_domain` varchar(255),
  `cookie_same_site` varchar(16) NOT NULL DEFAULT ('lax'),
  `csrf_trusted_origins` longtext,
  `content_security_policy` longtext,
  `password_pwned_check_enabled` boolean NOT NULL DEFAULT false,
  `login_limit` bigint NOT NULL DEFAULT 5,
  `api_limit` bigint NOT NULL DEFAULT 100,
  `two_fa_limit` bigint NOT NULL DEFAULT 5,
  `account_lock_enabled` boolean NOT NULL DEFAULT true,
  `max_ip_fail_attempts` bigint NOT NULL DEFAULT 10,
  `ip_lock_duration_minutes` bigint NOT NULL DEFAULT 30,
  `max_account_fail_attempts` bigint NOT NULL DEFAULT 5,
  `account_lock_duration_minutes` bigint NOT NULL DEFAULT 60,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_security_config_deleted_at` ON `security_config` (`deleted_at`);

CREATE TABLE `ssh_keys` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `user_id` char(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `public_key` longtext NOT NULL,
  `private_key` longtext NOT NULL,
  `fingerprint` varchar(100) NOT NULL,
  `algorithm` varchar(20) NOT NULL,
  `key_size` bigint DEFAULT 0,
  `passphrase_required` boolean,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE UNIQUE INDEX `idx_ssh_key_owner_fingerprint` ON `ssh_keys` (`user_id`, `fingerprint`);

CREATE TABLE `servers` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `name` varchar(100),
  `host` varchar(255) NOT NULL,
  `port` bigint DEFAULT 22,
  `username` varchar(50) NOT NULL,
  `auth_method` varchar(64) NOT NULL,
  `password` longtext,
  `server_group` varchar(50),
  `tags` longtext,
  `status` varchar(20) DEFAULT 'offline',
  `last_connected` datetime(3),
  `description` longtext,
  `os` varchar(100),
  `sort_order` bigint DEFAULT 0,
  `country` varchar(100),
  `country_code` varchar(10),
  `region` varchar(100),
  `city` varchar(100),
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  `ssh_key_id` bigint,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`ssh_key_id`) REFERENCES `ssh_keys` (`id`) ON DELETE RESTRICT ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_servers_deleted_at` ON `servers` (`deleted_at`);

CREATE INDEX `idx_servers_sort_order` ON `servers` (`sort_order`);

CREATE INDEX `idx_servers_ssh_key_id` ON `servers` (`ssh_key_id`);

CREATE INDEX `idx_servers_user_id` ON `servers` (`user_id`);

CREATE TABLE `ssh_host_keys` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  `host` varchar(255) NOT NULL,
  `port` bigint NOT NULL,
  `key_type` varchar(50) NOT NULL,
  `public_key` longtext NOT NULL,
  `fingerprint` varchar(100) NOT NULL,
  `first_seen` datetime(3) NOT NULL,
  `last_seen` datetime(3) NOT NULL,
  `trust_status` varchar(20) NOT NULL DEFAULT 'trusted',
  `user_id` bigint,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_ssh_host_keys_deleted_at` ON `ssh_host_keys` (`deleted_at`);

CREATE UNIQUE INDEX `idx_host_port` ON `ssh_host_keys` (`host`, `port`);

CREATE INDEX `idx_ssh_host_keys_fingerprint` ON `ssh_host_keys` (`fingerprint`);

CREATE INDEX `idx_ssh_host_keys_user_id` ON `ssh_host_keys` (`user_id`);

CREATE TABLE `sync_authorizations` (
  `id` char(36) NOT NULL,
  `device_code_hash` varchar(64) NOT NULL,
  `user_code_hash` varchar(64) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  `name` varchar(100) NOT NULL,
  `status` varchar(20) NOT NULL,
  `expires_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE UNIQUE INDEX `idx_sync_authorizations_device_code_hash` ON `sync_authorizations` (`device_code_hash`);

CREATE UNIQUE INDEX `idx_sync_authorizations_user_code_hash` ON `sync_authorizations` (`user_code_hash`);

CREATE INDEX `idx_sync_authorizations_expires_at` ON `sync_authorizations` (`expires_at`);

CREATE TABLE `sync_devices` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `name` varchar(100) NOT NULL,
  `token_hash` varchar(64) NOT NULL,
  `created_at` datetime(3),
  `expires_at` datetime(3),
  `last_used_at` datetime(3),
  `scopes` longtext,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_sync_devices_user_id` ON `sync_devices` (`user_id`);

CREATE UNIQUE INDEX `idx_sync_devices_token_hash` ON `sync_devices` (`token_hash`);

CREATE TABLE `sync_instance` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `uuid` char(36) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `sync_states` (
  `user_id` char(36) NOT NULL,
  `document` longtext,
  `revision` bigint,
  `updated_at` datetime(3),
  `disabled` boolean NOT NULL DEFAULT false,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `sync_vault_documents` (
  `user_id` char(36) NOT NULL,
  `kind` varchar(20) NOT NULL,
  `resource_id` varchar(36) NOT NULL,
  `document` longtext,
  `current_ref` varchar(36),
  `observed_ref` varchar(36),
  `revision` bigint,
  `updated_at` datetime(3),
  `conflicts` longtext,
  `applied_ref` varchar(36),
  PRIMARY KEY (`user_id`, `kind`, `resource_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `sync_vault_objects` (
  `user_id` char(36) NOT NULL,
  `id` varchar(64) NOT NULL,
  `kind` varchar(20) NOT NULL,
  `resource_id` varchar(36) NOT NULL,
  `ciphertext` longtext,
  `created_at` datetime(3),
  PRIMARY KEY (`user_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `system_config` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `system_name` varchar(100) NOT NULL DEFAULT ('EasySSH'),
  `system_logo` longtext,
  `system_favicon` longtext,
  `default_language` varchar(10) NOT NULL DEFAULT ('zh-CN'),
  `default_timezone` varchar(50) NOT NULL DEFAULT ('Asia/Shanghai'),
  `date_format` varchar(50) NOT NULL DEFAULT ('YYYY-MM-DD HH:mm:ss'),
  `download_exclude_patterns` longtext,
  `default_download_mode` varchar(20) NOT NULL DEFAULT ('fast'),
  `skip_excluded_on_upload` boolean NOT NULL DEFAULT true,
  `max_file_upload_size` bigint NOT NULL DEFAULT 100,
  `transfer_storage_path` longtext,
  `transfer_retention_days` bigint NOT NULL DEFAULT 3,
  `transfer_max_storage_gb` bigint NOT NULL DEFAULT 10,
  `transfer_max_concurrency` bigint NOT NULL DEFAULT 2,
  `transfer_cleanup_enabled` boolean NOT NULL DEFAULT true,
  `allow_registration` boolean NOT NULL DEFAULT false,
  `default_role` varchar(64) NOT NULL DEFAULT ('user'),
  `oauth_enabled` boolean NOT NULL DEFAULT false,
  `google_client_id` varchar(255),
  `google_client_secret` varchar(255),
  `oauth_access_token_minutes` bigint NOT NULL DEFAULT 15,
  `oauth_refresh_token_days` bigint NOT NULL DEFAULT 30,
  `external_oauth_provider_enabled` boolean NOT NULL DEFAULT false,
  `external_oauth_issuer` varchar(512),
  `external_oauth_login_url` varchar(512),
  `external_oauth_redirect_uris` longtext,
  `sftp_max_idle_time_seconds` bigint NOT NULL DEFAULT 120,
  `sftp_cleanup_interval_seconds` bigint NOT NULL DEFAULT 30,
  `sftp_max_life_time_minutes` bigint NOT NULL DEFAULT 0,
  `sftp_conn_timeout_seconds` bigint NOT NULL DEFAULT 10,
  `sftp_max_sessions_per_conn` bigint NOT NULL DEFAULT 8,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  `job_queue_max_concurrency` bigint NOT NULL DEFAULT 2,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_system_config_deleted_at` ON `system_config` (`deleted_at`);

CREATE TABLE `task_events` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `task_run_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `level` varchar(20) NOT NULL DEFAULT ('info'),
  `message` longtext NOT NULL,
  `data_json` longtext,
  `created_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_task_events_task_run_id` ON `task_events` (`task_run_id`);

CREATE INDEX `idx_task_events_user_id` ON `task_events` (`user_id`);

CREATE INDEX `idx_task_events_created_at` ON `task_events` (`created_at`);

CREATE TABLE `task_runs` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `definition_id` char(36),
  `retry_of_id` char(36),
  `source_type` varchar(50),
  `source_id` varchar(80),
  `task_type` varchar(50) NOT NULL,
  `title` varchar(180) NOT NULL,
  `description` longtext,
  `trigger_type` varchar(30) NOT NULL,
  `runner` varchar(30) NOT NULL DEFAULT ('server'),
  `status` varchar(30) NOT NULL,
  `stage` varchar(50),
  `server_id` char(36),
  `server_name` varchar(120),
  `resource` longtext,
  `payload_json` longtext,
  `result_json` longtext,
  `progress` bigint DEFAULT 0,
  `total_count` bigint DEFAULT 0,
  `success_count` bigint DEFAULT 0,
  `failure_count` bigint DEFAULT 0,
  `bytes_total` bigint DEFAULT 0,
  `bytes_processed` bigint DEFAULT 0,
  `progress_json` longtext,
  `cancelable` boolean NOT NULL DEFAULT false,
  `retryable` boolean NOT NULL DEFAULT false,
  `attempt` bigint NOT NULL DEFAULT 1,
  `max_attempts` bigint NOT NULL DEFAULT 1,
  `error_code` varchar(80),
  `error_message` longtext,
  `cancel_requested_at` datetime(3),
  `started_at` datetime(3),
  `finished_at` datetime(3),
  `created_at` datetime(3),
  `updated_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_task_runs_user_id` ON `task_runs` (`user_id`);

CREATE INDEX `idx_task_runs_user_time` ON `task_runs` (`user_id`, `created_at`);

CREATE INDEX `idx_task_runs_definition_id` ON `task_runs` (`definition_id`);

CREATE INDEX `idx_task_runs_retry_of_id` ON `task_runs` (`retry_of_id`);

CREATE INDEX `idx_task_runs_source` ON `task_runs` (`source_type`, `source_id`);

CREATE INDEX `idx_task_runs_task_type` ON `task_runs` (`task_type`);

CREATE INDEX `idx_task_runs_trigger_type` ON `task_runs` (`trigger_type`);

CREATE INDEX `idx_task_runs_status` ON `task_runs` (`status`);

CREATE INDEX `idx_task_runs_stage` ON `task_runs` (`stage`);

CREATE INDEX `idx_task_runs_server_id` ON `task_runs` (`server_id`);

CREATE INDEX `idx_task_runs_started_at` ON `task_runs` (`started_at`);

CREATE INDEX `idx_task_runs_finished_at` ON `task_runs` (`finished_at`);

CREATE INDEX `idx_task_runs_created_at` ON `task_runs` (`created_at`);

CREATE TABLE `totp_replays` (
  `user_id` char(36) NOT NULL,
  `counter` bigint NOT NULL,
  `used_at` datetime(3) NOT NULL,
  PRIMARY KEY (`user_id`, `counter`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `transfer_jobs` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `name` varchar(160) NOT NULL,
  `kind` varchar(40) NOT NULL,
  `runner` varchar(30) NOT NULL DEFAULT ('server'),
  `status` varchar(30) NOT NULL,
  `stage` varchar(40) NOT NULL,
  `description` longtext,
  `source_server_id` char(36),
  `target_server_id` char(36),
  `source_path` longtext,
  `target_path` longtext,
  `file_name` varchar(255),
  `artifact_name` varchar(255),
  `artifact_path` longtext,
  `artifact_size` bigint DEFAULT 0,
  `artifact_managed` boolean NOT NULL DEFAULT true,
  `artifact_expires_at` datetime(3),
  `progress` bigint DEFAULT 0,
  `bytes_total` bigint DEFAULT 0,
  `bytes_processed` bigint DEFAULT 0,
  `speed_bps` bigint DEFAULT 0,
  `retry_count` bigint DEFAULT 0,
  `max_retries` bigint DEFAULT 0,
  `scheduled_task_id` char(36),
  `task_run_id` char(36),
  `error_message` longtext,
  `detail_json` longtext,
  `started_at` datetime(3),
  `finished_at` datetime(3),
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_transfer_jobs_user_id` ON `transfer_jobs` (`user_id`);

CREATE INDEX `idx_transfer_jobs_user_time` ON `transfer_jobs` (`user_id`, `created_at`);

CREATE INDEX `idx_transfer_jobs_kind` ON `transfer_jobs` (`kind`);

CREATE INDEX `idx_transfer_jobs_status` ON `transfer_jobs` (`status`);

CREATE INDEX `idx_transfer_jobs_stage` ON `transfer_jobs` (`stage`);

CREATE INDEX `idx_transfer_jobs_source_server_id` ON `transfer_jobs` (`source_server_id`);

CREATE INDEX `idx_transfer_jobs_target_server_id` ON `transfer_jobs` (`target_server_id`);

CREATE INDEX `idx_transfer_jobs_artifact_expires_at` ON `transfer_jobs` (`artifact_expires_at`);

CREATE INDEX `idx_transfer_jobs_scheduled_task_id` ON `transfer_jobs` (`scheduled_task_id`);

CREATE INDEX `idx_transfer_jobs_task_run_id` ON `transfer_jobs` (`task_run_id`);

CREATE INDEX `idx_transfer_jobs_started_at` ON `transfer_jobs` (`started_at`);

CREATE INDEX `idx_transfer_jobs_finished_at` ON `transfer_jobs` (`finished_at`);

CREATE INDEX `idx_transfer_jobs_created_at` ON `transfer_jobs` (`created_at`);

CREATE INDEX `idx_transfer_jobs_deleted_at` ON `transfer_jobs` (`deleted_at`);

CREATE TABLE `trusted_devices` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `device_fingerprint` varchar(64),
  `device_type` varchar(50),
  `device_name` varchar(200),
  `last_ip_address` varchar(45),
  `last_location` varchar(200),
  `trust_level` bigint DEFAULT 1,
  `last_used` datetime(3),
  `created_at` datetime(3),
  `updated_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_trusted_user_fp` ON `trusted_devices` (`user_id`, `device_fingerprint`);

CREATE TABLE `user_ai_config` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `user_id` char(36) NOT NULL,
  `use_system_config` boolean DEFAULT true,
  `custom_enabled` boolean DEFAULT false,
  `custom_provider` varchar(20),
  `custom_api_key` longtext,
  `custom_endpoint` longtext,
  `custom_models` longtext,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE UNIQUE INDEX `idx_user_ai_config_user_id` ON `user_ai_config` (`user_id`);

CREATE INDEX `idx_user_ai_config_deleted_at` ON `user_ai_config` (`deleted_at`);

CREATE TABLE `user_sessions` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `oauth_request_id` varchar(191) NOT NULL,
  `device_type` longtext,
  `device_name` longtext,
  `ip_address` longtext,
  `location` longtext,
  `user_agent` longtext,
  `last_activity` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `remember_login` boolean NOT NULL DEFAULT false,
  `created_at` datetime(3),
  `deleted_at` datetime(3),
  `device_fingerprint` varchar(191),
  `is_new_device` boolean DEFAULT false,
  `is_new_location` boolean DEFAULT false,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE INDEX `idx_user_sessions_user_id` ON `user_sessions` (`user_id`);

CREATE INDEX `idx_sessions_user_expires` ON `user_sessions` (`user_id`, `expires_at`);

CREATE UNIQUE INDEX `idx_user_sessions_o_auth_request_id` ON `user_sessions` (`oauth_request_id`);

CREATE INDEX `idx_user_sessions_expires_at` ON `user_sessions` (`expires_at`);

CREATE INDEX `idx_user_sessions_deleted_at` ON `user_sessions` (`deleted_at`);

CREATE INDEX `idx_sessions_user_device` ON `user_sessions` (`device_fingerprint`);

CREATE TABLE `users` (
  `id` char(36) NOT NULL,
  `username` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` varchar(64) DEFAULT 'user',
  `avatar` longtext,
  `google_sub` varchar(255),
  `language` varchar(20) DEFAULT (''),
  `timezone` varchar(50) DEFAULT (''),
  `two_factor_enabled` boolean DEFAULT false,
  `two_factor_secret` varchar(255),
  `backup_codes` longtext,
  `notify_email_login` boolean DEFAULT true,
  `notify_email_alert` boolean DEFAULT true,
  `notify_browser` boolean DEFAULT true,
  `notify_new_device` boolean DEFAULT true,
  `notify_new_location` boolean DEFAULT true,
  `notify_suspicious` boolean DEFAULT true,
  `notify_task_in_app` boolean DEFAULT true,
  `notify_task_success` boolean DEFAULT true,
  `notify_task_failure` boolean DEFAULT true,
  `notify_task_partial` boolean DEFAULT true,
  `notify_task_external` boolean DEFAULT false,
  `failed_login_attempts` bigint DEFAULT 0,
  `last_failed_login` datetime(3),
  `locked_until` datetime(3),
  `lock_reason` varchar(200),
  `monitor_data_source` varchar(20) DEFAULT ('easyssh'),
  `nezha_api_endpoint` longtext,
  `nezha_api_token` longtext,
  `komari_api_endpoint` longtext,
  `komari_api_token` longtext,
  `created_at` datetime(3),
  `updated_at` datetime(3),
  `deleted_at` datetime(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);

CREATE UNIQUE INDEX `idx_users_google_sub` ON `users` (`google_sub`);

CREATE INDEX `idx_users_locked` ON `users` (`locked_until`);

CREATE INDEX `idx_users_deleted_at` ON `users` (`deleted_at`);

-- +goose Down

DROP TABLE `users`;

DROP TABLE `user_sessions`;

DROP TABLE `user_ai_config`;

DROP TABLE `trusted_devices`;

DROP TABLE `transfer_jobs`;

DROP TABLE `totp_replays`;

DROP TABLE `task_runs`;

DROP TABLE `task_events`;

DROP TABLE `system_config`;

DROP TABLE `sync_vault_objects`;

DROP TABLE `sync_vault_documents`;

DROP TABLE `sync_states`;

DROP TABLE `sync_instance`;

DROP TABLE `sync_devices`;

DROP TABLE `sync_authorizations`;

DROP TABLE `ssh_host_keys`;

DROP TABLE `servers`;

DROP TABLE `ssh_keys`;

DROP TABLE `security_config`;

DROP TABLE `scripts`;

DROP TABLE `scheduled_tasks`;

DROP TABLE `roles`;

DROP TABLE `operation_records`;

DROP TABLE `oauth_signing_keys`;

DROP TABLE `oauth_login_challenges`;

DROP TABLE `oauth_grants`;

DROP TABLE `oauth_clients`;

DROP TABLE `oauth_client_assertions`;

DROP TABLE `notification_deliveries`;

DROP TABLE `notification_config`;

DROP TABLE `login_attempts`;

DROP TABLE `login_alerts`;

DROP TABLE `job_queue`;

DROP TABLE `inbox_notifications`;

DROP TABLE `casbin_rule`;

DROP TABLE `batch_tasks`;

DROP TABLE `auth_tickets`;

DROP TABLE `ai_sessions`;

DROP TABLE `ai_config`;
