-- +goose NO TRANSACTION
-- Stop EasySSH before applying Up or Down. The maintenance command creates a recovery snapshot.
-- MySQL DDL commits implicitly; DDL cannot be rolled back by ROLLBACK.
-- If Up is interrupted, restore the recovery snapshot before retrying.
-- Down revokes access in a DML transaction, then drops the six feature tables.
-- The Down procedure rolls back revocation if any DML statement fails.
-- Agent history and execution records are retained by Down.

-- +goose Up
CREATE TABLE chat_connections (
  id char(36) PRIMARY KEY,
  owner_id char(36) NOT NULL,
  name varchar(100) NOT NULL,
  token_cipher longtext NOT NULL,
  bot_id bigint NOT NULL UNIQUE,
  bot_username varchar(100) NOT NULL,
  server_ids_json longtext NOT NULL,
  permission_mode varchar(16) NOT NULL CHECK (permission_mode IN ('readonly', 'balanced')),
  enabled boolean NOT NULL DEFAULT false,
  next_update_id bigint NOT NULL DEFAULT 0,
  bind_code_hash varchar(64) NOT NULL DEFAULT '',
  bind_expires_at datetime(6),
  last_poll_at datetime(6),
  last_error longtext NOT NULL,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES owners (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE chat_bindings (
  id char(36) PRIMARY KEY,
  connection_id char(36) NOT NULL,
  user_id bigint NOT NULL,
  chat_id bigint NOT NULL,
  display_name varchar(400) NOT NULL,
  current_session_id varchar(36) NOT NULL DEFAULT '',
  revoked_at datetime(6),
  created_at datetime(6) NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES chat_connections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_chat_binding_user ON chat_bindings (connection_id, user_id);
CREATE TABLE chat_conversations (
  id char(36) PRIMARY KEY,
  binding_id char(36) NOT NULL,
  watching boolean NOT NULL DEFAULT false,
  status varchar(32) NOT NULL,
  message_count integer NOT NULL DEFAULT 0,
  created_at datetime(6) NOT NULL,
  updated_at datetime(6) NOT NULL,
  FOREIGN KEY (binding_id) REFERENCES chat_bindings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_chat_conversation_watch ON chat_conversations (watching, updated_at);
CREATE TABLE chat_inbox (
  id char(36) PRIMARY KEY,
  connection_id char(36) NOT NULL,
  update_id bigint NOT NULL,
  payload longtext NOT NULL,
  status varchar(16) NOT NULL,
  created_at datetime(6) NOT NULL,
  UNIQUE (connection_id, update_id),
  FOREIGN KEY (connection_id) REFERENCES chat_connections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_chat_inbox_due ON chat_inbox (status, created_at);
CREATE TABLE chat_outbox (
  id char(36) PRIMARY KEY,
  connection_id char(36) NOT NULL,
  binding_id varchar(36) NOT NULL DEFAULT '',
  chat_id bigint NOT NULL,
  text longtext NOT NULL,
  buttons longtext NOT NULL,
  status varchar(16) NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at datetime(6) NOT NULL,
  last_error longtext NOT NULL,
  created_at datetime(6) NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES chat_connections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE INDEX idx_chat_outbox_due ON chat_outbox (status, next_attempt_at);
CREATE INDEX idx_chat_outbox_order ON chat_outbox (connection_id, chat_id, created_at);
CREATE TABLE chat_approvals (
  id char(32) PRIMARY KEY,
  binding_id char(36) NOT NULL,
  session_id char(36) NOT NULL,
  task_id varchar(100) NOT NULL,
  digest varchar(64) NOT NULL,
  expires_at datetime(6) NOT NULL,
  used_at datetime(6),
  UNIQUE (session_id, task_id),
  FOREIGN KEY (binding_id) REFERENCES chat_bindings (id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES chat_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- +goose Down
-- +goose StatementBegin
CREATE PROCEDURE easyssh_rollback_00008()
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;
  UPDATE chat_connections SET enabled = false, bind_code_hash = '', bind_expires_at = NULL;
  UPDATE chat_bindings SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL;
  UPDATE chat_approvals SET used_at = CURRENT_TIMESTAMP WHERE used_at IS NULL;
  COMMIT;
END;
-- +goose StatementEnd
CALL easyssh_rollback_00008();
DROP PROCEDURE easyssh_rollback_00008;
DROP TABLE chat_approvals;
DROP TABLE chat_outbox;
DROP TABLE chat_inbox;
DROP TABLE chat_conversations;
DROP TABLE chat_bindings;
DROP TABLE chat_connections;
