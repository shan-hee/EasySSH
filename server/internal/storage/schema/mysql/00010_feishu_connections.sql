-- +goose NO TRANSACTION
-- Stop EasySSH and use maintenance schema-upgrade / schema-rollback, which
-- creates a recovery snapshot. MySQL DDL commits implicitly and is NOT undone
-- by ROLLBACK. Restore that snapshot if DDL is interrupted; do not blindly rerun.
-- Up is additive; all existing Telegram fields/data are retained.
-- Down removes Feishu connections/bindings/approvals/event claims. Its data
-- changes use an explicit transaction with a rollback handler. Telegram data
-- and Agent history remain; recover Feishu data from the recovery snapshot.

-- +goose Up
ALTER TABLE chat_connections
  ADD COLUMN provider varchar(16) NOT NULL DEFAULT 'telegram',
  ADD COLUMN app_id varchar(100) NULL;
CREATE UNIQUE INDEX idx_chat_connection_app ON chat_connections (provider, app_id);
ALTER TABLE chat_bindings
  ADD COLUMN external_user_id varchar(128) NOT NULL DEFAULT '',
  ADD COLUMN external_chat_id varchar(128) NOT NULL DEFAULT '';
CREATE INDEX idx_chat_binding_external_user ON chat_bindings (connection_id, external_user_id);
CREATE TABLE chat_received_events (
  id char(36) PRIMARY KEY,
  connection_id char(36) NOT NULL,
  created_at datetime(6) NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES chat_connections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_chat_received_connection ON chat_received_events (connection_id);

-- +goose Down
-- +goose StatementBegin
CREATE PROCEDURE easyssh_rollback_00010()
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;
  DELETE FROM chat_connections WHERE provider = 'feishu';
  COMMIT;
END;
-- +goose StatementEnd
CALL easyssh_rollback_00010();
DROP PROCEDURE easyssh_rollback_00010;
DROP TABLE chat_received_events;
DROP INDEX idx_chat_binding_external_user ON chat_bindings;
ALTER TABLE chat_bindings DROP COLUMN external_chat_id, DROP COLUMN external_user_id;
DROP INDEX idx_chat_connection_app ON chat_connections;
ALTER TABLE chat_connections DROP COLUMN app_id, DROP COLUMN provider;
