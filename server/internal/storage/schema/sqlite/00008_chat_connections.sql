-- Stop EasySSH before applying Up or Down. Use maintenance schema-upgrade / schema-rollback.
-- Goose wraps EACH direction and its schema version update in BEGIN/COMMIT;
-- any failure triggers ROLLBACK. Do not add nested BEGIN statements here.
-- For manual SQL execution, extract ONE direction and wrap it in a transaction.
-- Down deletes chat configuration/bindings/delivery state, retaining Agent history.

-- +goose Up
CREATE TABLE chat_connections (
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
CREATE TABLE chat_bindings (
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
CREATE TABLE chat_conversations (
  id char(36) PRIMARY KEY,
  binding_id char(36) NOT NULL,
  watching boolean NOT NULL DEFAULT false,
  status varchar(32) NOT NULL,
  message_count integer NOT NULL DEFAULT 0,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  FOREIGN KEY (binding_id) REFERENCES chat_bindings (id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_conversation_watch ON chat_conversations (watching, updated_at);
CREATE TABLE chat_inbox (
  id char(36) PRIMARY KEY,
  connection_id char(36) NOT NULL,
  update_id bigint NOT NULL,
  payload TEXT NOT NULL,
  status varchar(16) NOT NULL,
  created_at datetime NOT NULL,
  UNIQUE (connection_id, update_id),
  FOREIGN KEY (connection_id) REFERENCES chat_connections (id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_inbox_due ON chat_inbox (status, created_at);
CREATE TABLE chat_outbox (
  id char(36) PRIMARY KEY,
  connection_id char(36) NOT NULL,
  binding_id varchar(36) NOT NULL DEFAULT '',
  chat_id bigint NOT NULL,
  text TEXT NOT NULL,
  buttons TEXT NOT NULL,
  status varchar(16) NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at datetime NOT NULL,
  last_error TEXT NOT NULL,
  created_at datetime NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES chat_connections (id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_outbox_due ON chat_outbox (status, next_attempt_at);
CREATE INDEX idx_chat_outbox_order ON chat_outbox (connection_id, chat_id, created_at);
CREATE TABLE chat_approvals (
  id char(32) PRIMARY KEY,
  binding_id char(36) NOT NULL,
  session_id char(36) NOT NULL,
  task_id varchar(100) NOT NULL,
  digest varchar(64) NOT NULL,
  expires_at datetime NOT NULL,
  used_at datetime,
  UNIQUE (session_id, task_id),
  FOREIGN KEY (binding_id) REFERENCES chat_bindings (id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES chat_conversations (id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE chat_approvals;
DROP TABLE chat_outbox;
DROP TABLE chat_inbox;
DROP TABLE chat_conversations;
DROP TABLE chat_bindings;
DROP TABLE chat_connections;
