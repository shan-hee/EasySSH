-- Goose wraps each direction and its version record in a transaction.

-- +goose Up
-- Deleted servers, scripts and AI conversations are copied here and can be
-- restored until the retention period for deleted data passes.
CREATE TABLE "recycle_bin" (
  "id" char(36) NOT NULL,
  "kind" text NOT NULL,
  "resource_id" text NOT NULL,
  "name" text NOT NULL,
  "payload" text NOT NULL,
  "removed_at" datetime NOT NULL,
  PRIMARY KEY ("id")
);
CREATE INDEX "idx_recycle_bin_resource" ON "recycle_bin" ("kind", "resource_id");
CREATE INDEX "idx_recycle_bin_removed_at" ON "recycle_bin" ("removed_at");
ALTER TABLE system_config ADD COLUMN deleted_retention_days integer NOT NULL DEFAULT 30;
-- Preserve old soft-deleted scripts as restorable entries. Start their
-- retention period now so an old deletion is not purged immediately on startup.
INSERT INTO recycle_bin (id, kind, resource_id, name, payload, removed_at)
SELECT id, 'script', id, name,
  json_object(
    'version', version, 'name', name, 'description', COALESCE(description, ''),
    'content', content, 'language', language, 'tags', json(COALESCE(tags, '[]')),
    'executions', COALESCE(executions, 0), 'author', COALESCE(author, ''),
    'created_at', COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', created_at), '0001-01-01T00:00:00Z')
  ), CURRENT_TIMESTAMP
FROM scripts WHERE deleted_at IS NOT NULL;
-- Restoring the original ID must not resume old schedules.
UPDATE scheduled_tasks SET enabled = false, next_run_at = NULL
WHERE task_type = 'script' AND script_id IN (SELECT id FROM scripts WHERE deleted_at IS NOT NULL);
DELETE FROM scripts WHERE deleted_at IS NOT NULL;
DROP INDEX "idx_scripts_deleted_at";
ALTER TABLE scripts DROP COLUMN deleted_at;

-- +goose Down
-- Drops the recycle bin with everything in it, including migrated scripts.
-- To retain deleted data when downgrading, restore the pre-upgrade recovery point.
ALTER TABLE scripts ADD COLUMN deleted_at datetime;
CREATE INDEX "idx_scripts_deleted_at" ON "scripts" ("deleted_at");
ALTER TABLE system_config DROP COLUMN deleted_retention_days;
DROP TABLE "recycle_bin";
