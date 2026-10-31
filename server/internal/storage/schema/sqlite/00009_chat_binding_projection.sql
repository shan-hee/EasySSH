-- Stop EasySSH and create a recovery snapshot before Up or Down.
-- Version 8 is immutable; this migration moves projection state to bindings.
-- Up removes obsolete conversation mappings/inbox/outbox, without replaying them.
-- Agent history, connections, bindings and approvals are retained.
-- Down restores the old structure and current mappings, but not discarded queues
-- or historical mappings. Use the recovery snapshot for an exact restoration.
-- Goose wraps each direction AND version tracking in BEGIN/COMMIT, and rolls
-- back on failure. For manual execution, wrap ONE direction in BEGIN/COMMIT;
-- issue ROLLBACK on error. Do not execute both directions as one SQL file.

-- +goose Up
ALTER TABLE chat_connections ADD COLUMN revision bigint NOT NULL DEFAULT 1;
ALTER TABLE chat_bindings ADD COLUMN message_count integer NOT NULL DEFAULT 0;
ALTER TABLE chat_bindings ADD COLUMN watching boolean NOT NULL DEFAULT false;
CREATE INDEX idx_chat_binding_watch ON chat_bindings (watching);

CREATE TABLE chat_approvals_v9 (
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

UPDATE chat_bindings
SET message_count = COALESCE((
      SELECT c.message_count FROM chat_conversations AS c
      WHERE c.id = chat_bindings.current_session_id AND c.binding_id = chat_bindings.id
    ), 0),
    watching = COALESCE((
      SELECT c.watching FROM chat_conversations AS c
      WHERE c.id = chat_bindings.current_session_id AND c.binding_id = chat_bindings.id
    ), false);
INSERT INTO chat_approvals_v9 (id, binding_id, session_id, task_id, digest, expires_at, used_at)
SELECT id, binding_id, session_id, task_id, digest, expires_at, used_at FROM chat_approvals;

-- Remove the old approval FK before dropping its conversation table.
DROP TABLE chat_approvals;
ALTER TABLE chat_approvals_v9 RENAME TO chat_approvals;
DROP TABLE chat_outbox;
DROP TABLE chat_inbox;
DROP TABLE chat_conversations;

-- +goose Down
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

CREATE TABLE chat_approvals_v8 (
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

-- Recreate only the current mappings and those required by retained approvals.
-- Removed historical mappings and delivery queues require the recovery snapshot.
INSERT INTO chat_conversations (id, binding_id, watching, status, message_count, created_at, updated_at)
SELECT current_session_id, id, watching,
       CASE WHEN watching THEN 'running' ELSE 'idle' END,
       message_count, created_at, CURRENT_TIMESTAMP
FROM chat_bindings WHERE current_session_id <> '';
INSERT INTO chat_conversations (id, binding_id, watching, status, message_count, created_at, updated_at)
SELECT a.session_id, a.binding_id, false, 'idle', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM chat_approvals AS a
WHERE NOT EXISTS (SELECT 1 FROM chat_conversations AS c WHERE c.id = a.session_id)
GROUP BY a.session_id, a.binding_id;
INSERT INTO chat_approvals_v8 (id, binding_id, session_id, task_id, digest, expires_at, used_at)
SELECT id, binding_id, session_id, task_id, digest, expires_at, used_at FROM chat_approvals;

DROP TABLE chat_approvals;
ALTER TABLE chat_approvals_v8 RENAME TO chat_approvals;
DROP INDEX idx_chat_binding_watch;
ALTER TABLE chat_bindings DROP COLUMN watching;
ALTER TABLE chat_bindings DROP COLUMN message_count;
ALTER TABLE chat_connections DROP COLUMN revision;
