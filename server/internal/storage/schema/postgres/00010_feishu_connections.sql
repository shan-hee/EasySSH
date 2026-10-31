-- Stop EasySSH and use maintenance schema-upgrade / schema-rollback.
-- Goose wraps each direction AND its version update in BEGIN/COMMIT, rolling
-- everything back on failure. For manual execution wrap ONE direction in a
-- transaction; issue ROLLBACK on error. Never run both directions together.
-- Up is additive: Telegram columns/data remain unchanged; old rows default to
-- provider=telegram. app_id is NULL for Telegram so the unique index permits it.
-- Down removes Feishu connections/bindings/approvals/event claims, retaining
-- Telegram configuration and Agent history. Restore the maintenance recovery
-- snapshot to recover Feishu data after a rollback.

-- +goose Up
ALTER TABLE chat_connections ADD COLUMN provider varchar(16) NOT NULL DEFAULT 'telegram';
ALTER TABLE chat_connections ADD COLUMN app_id varchar(100);
CREATE UNIQUE INDEX idx_chat_connection_app ON chat_connections (provider, app_id);
ALTER TABLE chat_bindings ADD COLUMN external_user_id varchar(128) NOT NULL DEFAULT '';
ALTER TABLE chat_bindings ADD COLUMN external_chat_id varchar(128) NOT NULL DEFAULT '';
CREATE INDEX idx_chat_binding_external_user ON chat_bindings (connection_id, external_user_id);
CREATE TABLE chat_received_events (
  id char(36) PRIMARY KEY,
  connection_id char(36) NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES chat_connections (id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_received_connection ON chat_received_events (connection_id);

-- +goose Down
DELETE FROM chat_connections WHERE provider = 'feishu';
DROP TABLE chat_received_events;
DROP INDEX idx_chat_binding_external_user;
ALTER TABLE chat_bindings DROP COLUMN external_chat_id;
ALTER TABLE chat_bindings DROP COLUMN external_user_id;
DROP INDEX idx_chat_connection_app;
ALTER TABLE chat_connections DROP COLUMN app_id;
ALTER TABLE chat_connections DROP COLUMN provider;
