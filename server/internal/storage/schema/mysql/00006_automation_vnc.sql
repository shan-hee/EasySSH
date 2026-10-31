-- Additive production migration: existing schema and records are preserved.
-- MySQL DDL implicitly commits. Up is restartable; Down compensates DDL.
-- +goose NO TRANSACTION

-- +goose Up
CREATE TABLE IF NOT EXISTS `automation_tokens` (
  `session_id` char(36) PRIMARY KEY,
  `name` varchar(100) NOT NULL,
  `grant_id` char(36) NOT NULL,
  `grant_version` bigint NOT NULL,
  `token_hash` varchar(64) NOT NULL UNIQUE,
  `created_at` datetime(3) NOT NULL,
  `last_seen_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3),
  FOREIGN KEY (`grant_id`) REFERENCES `grants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `server_vnc_configs` (
  `server_id` char(36) PRIMARY KEY,
  `enabled` boolean NOT NULL DEFAULT false,
  `port` integer NOT NULL DEFAULT 5900 CHECK (`port` BETWEEN 1 AND 65535),
  `tls` boolean NOT NULL DEFAULT false,
  FOREIGN KEY (`server_id`) REFERENCES `servers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- +goose Down
-- Invalidate only credentials introduced by this feature before removing its metadata.
-- The transaction executes inside one CALL on one connection. DDL is
-- compensated below because MySQL cannot roll it back transactionally.
DROP PROCEDURE IF EXISTS easyssh_rollback_00006;
-- +goose StatementBegin
CREATE PROCEDURE easyssh_rollback_00006()
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;
  UPDATE grants SET revoked_at = CURRENT_TIMESTAMP, version = version + 1
    WHERE default_content = 'vnc' AND revoked_at IS NULL;
  COMMIT;
END;
-- +goose StatementEnd
CALL easyssh_rollback_00006();
DROP PROCEDURE easyssh_rollback_00006;
DROP TABLE IF EXISTS server_vnc_configs;
DROP TABLE IF EXISTS automation_tokens;
