-- +goose NO TRANSACTION
-- MySQL DDL commits implicitly. The backfill has its own transaction and error
-- handler; ALTER and the Goose version record are not part of that transaction.
-- UPDATE, MODIFY and reserved-routine cleanup can safely be repeated after
-- inspection. Follow schema-upgrade --resume recovery rules; never edit history.
-- Retain varchar(36), the table's existing collation and absent defaults.

-- +goose Up
DROP PROCEDURE IF EXISTS `__easyssh_migration_00008_fill_actors`;
-- +goose StatementBegin
CREATE PROCEDURE `__easyssh_migration_00008_fill_actors`()
SQL SECURITY INVOKER
BEGIN
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;
  START TRANSACTION;
  UPDATE `operation_records` SET `actor_kind` = '' WHERE `actor_kind` IS NULL;
  UPDATE `operation_records` SET `actor_id` = '' WHERE `actor_id` IS NULL;
  UPDATE `operation_records` SET `actor_session_id` = '' WHERE `actor_session_id` IS NULL;
  UPDATE `operation_records` SET `actor_grant_id` = '' WHERE `actor_grant_id` IS NULL;
  COMMIT;
END;
-- +goose StatementEnd
CALL `__easyssh_migration_00008_fill_actors`();
DROP PROCEDURE `__easyssh_migration_00008_fill_actors`;

ALTER TABLE `operation_records`
  MODIFY COLUMN `actor_kind` varchar(36) NOT NULL,
  MODIFY COLUMN `actor_id` varchar(36) NOT NULL,
  MODIFY COLUMN `actor_session_id` varchar(36) NOT NULL,
  MODIFY COLUMN `actor_grant_id` varchar(36) NOT NULL;

-- +goose Down
-- Empty strings stay empty; no rows are removed. Each MODIFY is repeatable.
ALTER TABLE `operation_records`
  MODIFY COLUMN `actor_kind` varchar(36) NULL,
  MODIFY COLUMN `actor_id` varchar(36) NULL,
  MODIFY COLUMN `actor_session_id` varchar(36) NULL,
  MODIFY COLUMN `actor_grant_id` varchar(36) NULL;
