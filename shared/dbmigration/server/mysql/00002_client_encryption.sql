-- +goose NO TRANSACTION
-- Client-owned encrypted synchronization. No server decryption keys.
-- +goose Up
CREATE TABLE encrypted_spaces (
 user_id char(36) PRIMARY KEY,
 space varchar(64) NOT NULL UNIQUE,
 manifest_hash varchar(64) NOT NULL,
 revision bigint NOT NULL,
 write_revision bigint NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE encrypted_manifests (
 user_id char(36) NOT NULL,
 hash varchar(64) NOT NULL,
 revision bigint NOT NULL,
 payload LONGTEXT NOT NULL,
 PRIMARY KEY (user_id, hash),
 UNIQUE (user_id, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE encrypted_objects (
 user_id char(36) NOT NULL,
 id varchar(64) NOT NULL,
 scope varchar(20) NOT NULL,
 document_id varchar(64) NOT NULL,
 payload LONGTEXT NOT NULL,
 size bigint NOT NULL,
 created_at datetime(3) NOT NULL,
 PRIMARY KEY (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_encrypted_objects_document ON encrypted_objects(user_id, scope, document_id);
CREATE TABLE encrypted_heads (
 user_id char(36) NOT NULL,
 scope varchar(20) NOT NULL,
 document_id varchar(64) NOT NULL,
 object_id varchar(64) NOT NULL,
 PRIMARY KEY (user_id, scope, document_id, object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE relay_routes (
 user_id char(36) NOT NULL,
 id char(36) NOT NULL,
 host varchar(255) NOT NULL,
 port integer NOT NULL,
 PRIMARY KEY (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Development cutover: remove the server-owned plaintext business store.
DROP TABLE ai_config;
DROP TABLE ai_sessions;
DROP TABLE batch_tasks;
DROP TABLE scheduled_tasks;
DROP TABLE scripts;
DROP TABLE servers;
DROP TABLE ssh_keys;
DROP TABLE ssh_host_keys;
DROP TABLE user_ai_config;
DROP TABLE sync_vault_documents;
DROP TABLE sync_vault_objects;
DROP TABLE transfer_jobs;
ALTER TABLE sync_states DROP COLUMN document;
ALTER TABLE sync_states DROP COLUMN revision;
ALTER TABLE users DROP COLUMN monitor_data_source;
ALTER TABLE users DROP COLUMN nezha_api_endpoint;
ALTER TABLE users DROP COLUMN nezha_api_token;
ALTER TABLE users DROP COLUMN komari_api_endpoint;
ALTER TABLE users DROP COLUMN komari_api_token;
DELETE FROM operation_records WHERE category <> 'audit';
DELETE FROM inbox_notifications;
DROP TABLE notification_deliveries;
DROP TABLE job_queue;
DROP TABLE task_events;
DROP TABLE task_runs;
DELETE FROM auth_tickets;
ALTER TABLE auth_tickets DROP COLUMN payload_json;

ALTER TABLE system_config DROP COLUMN transfer_storage_path;
ALTER TABLE system_config DROP COLUMN transfer_retention_days;
ALTER TABLE system_config DROP COLUMN transfer_max_storage_gb;
ALTER TABLE system_config DROP COLUMN transfer_max_concurrency;
ALTER TABLE system_config DROP COLUMN transfer_cleanup_enabled;
ALTER TABLE system_config DROP COLUMN sftp_max_idle_time_seconds;
ALTER TABLE system_config DROP COLUMN sftp_cleanup_interval_seconds;
ALTER TABLE system_config DROP COLUMN sftp_max_life_time_minutes;
ALTER TABLE system_config DROP COLUMN sftp_conn_timeout_seconds;
ALTER TABLE system_config DROP COLUMN sftp_max_sessions_per_conn;
ALTER TABLE system_config DROP COLUMN job_queue_max_concurrency;
