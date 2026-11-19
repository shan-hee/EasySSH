-- Goose wraps each direction and its version record in a transaction.

-- +goose Up
-- Chat accounts are bound by approving their request on the web page instead
-- of sending a binding code. bind_code_hash and bind_expires_at are no longer
-- used; they stay so this release can be rolled back without a schema change.
CREATE TABLE chat_bind_requests (
  id char(36) PRIMARY KEY,
  connection_id char(36) NOT NULL,
  user_id bigint NOT NULL DEFAULT 0,
  chat_id bigint NOT NULL DEFAULT 0,
  external_user_id varchar(128) NOT NULL DEFAULT '',
  external_chat_id varchar(128) NOT NULL DEFAULT '',
  is_group boolean NOT NULL DEFAULT false,
  display_name varchar(400) NOT NULL,
  message varchar(400) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES chat_connections (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_chat_bind_request_subject ON chat_bind_requests (connection_id, user_id, external_user_id, external_chat_id);
-- Owner-written instructions appended to the Agent's system prompt. NULL and
-- '' both mean none. Added last: its presence marks a completed upgrade.
ALTER TABLE chat_connections ADD COLUMN system_prompt TEXT;

-- +goose Down
-- Drops pending requests and system prompts. Existing bindings are unaffected.
ALTER TABLE chat_connections DROP COLUMN system_prompt;
DROP TABLE chat_bind_requests;
