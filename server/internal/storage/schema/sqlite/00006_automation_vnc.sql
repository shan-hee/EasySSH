-- Additive production migration: existing schema and records are preserved.

-- +goose Up
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

-- +goose Down
-- Invalidate only credentials introduced by this feature before removing its metadata.
UPDATE automation_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL;
UPDATE grants SET revoked_at = CURRENT_TIMESTAMP, version = version + 1 WHERE default_content = 'vnc' AND revoked_at IS NULL;
DROP TABLE server_vnc_configs;
DROP TABLE automation_tokens;
