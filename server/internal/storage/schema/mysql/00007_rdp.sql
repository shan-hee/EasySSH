-- +goose NO TRANSACTION

-- +goose Up
-- MySQL DDL commits implicitly. Check the additive column so an interrupted Up
-- can be retried without discarding existing data.
DROP PROCEDURE IF EXISTS easyssh_upgrade_00007;
-- +goose StatementBegin
CREATE PROCEDURE easyssh_upgrade_00007()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'grants' AND column_name = 'purpose') THEN
    ALTER TABLE grants ADD COLUMN purpose varchar(16) NOT NULL DEFAULT 'share';
  END IF;
END;
-- +goose StatementEnd
CALL easyssh_upgrade_00007();
DROP PROCEDURE easyssh_upgrade_00007;
CREATE TABLE IF NOT EXISTS server_rdp_configs (
  server_id char(36) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  port integer NOT NULL DEFAULT 3389 CHECK (port BETWEEN 1 AND 65535),
  security varchar(8) NOT NULL DEFAULT 'nla' CHECK (security IN ('nla', 'tls')),
  ignore_certificate boolean NOT NULL DEFAULT false,
  FOREIGN KEY (server_id) REFERENCES servers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- +goose Down
DROP PROCEDURE IF EXISTS easyssh_rollback_00007;
-- +goose StatementBegin
CREATE PROCEDURE easyssh_rollback_00007()
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'grants' AND column_name = 'purpose') THEN
  START TRANSACTION;
  UPDATE grants SET revoked_at = CURRENT_TIMESTAMP, version = version + 1
    WHERE (default_content = 'rdp' OR purpose = 'automation') AND revoked_at IS NULL;
  COMMIT;
  ALTER TABLE grants DROP COLUMN purpose;
  END IF;
END;
-- +goose StatementEnd
CALL easyssh_rollback_00007();
DROP PROCEDURE easyssh_rollback_00007;
DROP TABLE IF EXISTS server_rdp_configs;
