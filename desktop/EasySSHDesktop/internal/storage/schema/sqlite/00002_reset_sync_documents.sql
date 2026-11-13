-- Goose wraps each direction and its version record in a transaction.

-- +goose Up
-- Sync protocol 6 keeps versioned field state in these documents instead of
-- Automerge histories, which the new engine cannot read. Clearing them discards
-- sync history and unresolved conflicts only: servers, scripts, credentials and
-- the vault objects they reference are untouched. Every device then starts a
-- fresh exchange, in which equal values merge without a conflict.
UPDATE desktop_sync_spaces SET document = '';
-- A record left in conflict had a server version selected; without the
-- document its version is the one applied locally.
UPDATE desktop_sync_vault SET document = '', conflicts = '[]', current_ref = applied_ref;
-- The sync cursor now lives inside the document.
ALTER TABLE desktop_sync_spaces DROP COLUMN remote_heads;
ALTER TABLE desktop_sync_vault DROP COLUMN heads;

-- +goose Down
-- The previous engine cannot read protocol 6 documents either, so they are
-- cleared again. The Automerge histories removed by Up exist only in the
-- pre-upgrade recovery point.
UPDATE desktop_sync_spaces SET document = '';
UPDATE desktop_sync_vault SET document = '', conflicts = '[]';
ALTER TABLE desktop_sync_spaces ADD COLUMN remote_heads TEXT NOT NULL DEFAULT '[]';
ALTER TABLE desktop_sync_vault ADD COLUMN heads TEXT NOT NULL DEFAULT '[]';
