-- +goose NO TRANSACTION
-- MySQL DDL commits implicitly. Restore the recovery point after interrupted DDL.

-- +goose Up
DROP PROCEDURE IF EXISTS `__easyssh_migration_00009_normalize`;
-- +goose StatementBegin
CREATE PROCEDURE `__easyssh_migration_00009_normalize`()
SQL SECURITY INVOKER
BEGIN
  IF @@session.foreign_key_checks = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Schema 9 requires foreign_key_checks=1';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND table_name = 'operation_resources' AND column_name = 'record_id'
        AND referenced_table_schema = DATABASE() AND referenced_table_name = 'operation_records' AND referenced_column_name = 'id') THEN
    ALTER TABLE `operation_resources` ENGINE=InnoDB, CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
    ALTER TABLE `operation_resources` ADD FOREIGN KEY (`record_id`) REFERENCES `operation_records` (`id`) ON DELETE CASCADE;
  ELSEIF (SELECT COUNT(*) FROM information_schema.tables t JOIN information_schema.columns c USING (table_schema, table_name)
      WHERE t.table_schema = DATABASE() AND t.table_name = 'operation_resources'
        AND t.engine = 'InnoDB' AND t.table_collation = 'utf8mb4_bin'
        AND c.column_name IN ('record_id', 'server_id', 'name') AND c.collation_name = 'utf8mb4_bin') <> 3 THEN
    ALTER TABLE `operation_resources` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
      MODIFY `server_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      MODIFY `name` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables t JOIN information_schema.columns c USING (table_schema, table_name)
      WHERE t.table_schema = DATABASE() AND t.table_name = 'activity_coverage'
        AND t.engine = 'InnoDB' AND t.table_collation = 'utf8mb4_bin'
        AND c.column_name = 'id' AND c.collation_name = 'utf8mb4_bin') THEN
    ALTER TABLE `activity_coverage` ENGINE=InnoDB, CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
  END IF;
END;
-- +goose StatementEnd
CALL `__easyssh_migration_00009_normalize`();
DROP PROCEDURE `__easyssh_migration_00009_normalize`;

-- +goose Down
-- Schema 8 accepts the normalized tables. Historical instance defaults are unknown.
DO 0;
