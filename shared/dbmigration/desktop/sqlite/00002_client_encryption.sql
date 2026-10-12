-- Keep existing local business data and its OS-protected credential keys.
-- +goose Up
CREATE TABLE desktop_encrypted_state (
 space_id TEXT PRIMARY KEY NOT NULL,
 state_blob TEXT NOT NULL DEFAULT ''
);

ALTER TABLE desktop_sync_spaces DROP COLUMN document;
ALTER TABLE desktop_sync_spaces DROP COLUMN remote_heads;
ALTER TABLE desktop_sync_vault DROP COLUMN document;
ALTER TABLE desktop_sync_vault DROP COLUMN current_ref;
ALTER TABLE desktop_sync_vault DROP COLUMN observed_ref;
ALTER TABLE desktop_sync_vault DROP COLUMN applied_ref;
ALTER TABLE desktop_sync_vault DROP COLUMN heads;
ALTER TABLE desktop_sync_vault DROP COLUMN conflicts;
ALTER TABLE desktop_sync_vault DROP COLUMN revision;
ALTER TABLE desktop_ssh_keys ADD COLUMN passphrase TEXT NOT NULL DEFAULT '';
CREATE TABLE desktop_sync_keys (
 space_id TEXT NOT NULL REFERENCES desktop_sync_spaces(id),
 remote_id TEXT NOT NULL,
 local_id INTEGER NOT NULL,
 wire_id INTEGER NOT NULL,
 PRIMARY KEY(space_id,remote_id),
 UNIQUE(space_id,local_id), UNIQUE(space_id,wire_id)
);

ALTER TABLE desktop_sync_objects DROP COLUMN uploaded;
