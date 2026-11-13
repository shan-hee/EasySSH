-- +goose NO TRANSACTION
-- MySQL DDL commits implicitly. Restore the recovery point after interrupted DDL.

-- +goose Up
-- Deleted servers, scripts and AI conversations are copied here and can be
-- restored until the retention period for deleted data passes.
CREATE TABLE `recycle_bin` (
  `id` char(36) NOT NULL,
  `kind` varchar(20) NOT NULL,
  `resource_id` varchar(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `payload` longtext NOT NULL,
  `removed_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_recycle_bin_resource` (`kind`, `resource_id`),
  INDEX `idx_recycle_bin_removed_at` (`removed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
ALTER TABLE system_config ADD COLUMN deleted_retention_days bigint NOT NULL DEFAULT 30;
-- Preserve old soft-deleted scripts as restorable entries. Start their
-- retention period now so an old deletion is not purged immediately on startup.
INSERT INTO recycle_bin (id, kind, resource_id, name, payload, removed_at)
SELECT id, 'script', id, name,
  JSON_OBJECT(
    'version', version, 'name', name, 'description', COALESCE(description, ''),
    'content', content, 'language', language, 'tags', CAST(COALESCE(tags, '[]') AS JSON),
    'executions', COALESCE(executions, 0), 'author', COALESCE(author, ''),
    'created_at', COALESCE(DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ'), '0001-01-01T00:00:00Z')
  ), CURRENT_TIMESTAMP
FROM scripts WHERE deleted_at IS NOT NULL;
-- Restoring the original ID must not resume old schedules.
UPDATE scheduled_tasks SET enabled = false, next_run_at = NULL
WHERE task_type = 'script' AND script_id IN (SELECT id FROM scripts WHERE deleted_at IS NOT NULL);
DELETE FROM scripts WHERE deleted_at IS NOT NULL;
ALTER TABLE scripts DROP INDEX `idx_scripts_deleted_at`;
ALTER TABLE scripts DROP COLUMN deleted_at;

-- +goose Down
-- Drops the recycle bin with everything in it, including migrated scripts.
-- To retain deleted data when downgrading, restore the pre-upgrade recovery point.
ALTER TABLE scripts ADD COLUMN deleted_at datetime(3);
CREATE INDEX `idx_scripts_deleted_at` ON `scripts` (`deleted_at`);
ALTER TABLE system_config DROP COLUMN deleted_retention_days;
DROP TABLE `recycle_bin`;
