-- Goose wraps each direction and its version record in a transaction.

-- +goose Up
-- Sync protocol 6 keeps versioned field state in these documents instead of
-- Automerge histories, which the new engine cannot read. Clearing them discards
-- sync history and unresolved conflicts only: servers, scripts, credentials and
-- the vault objects they reference are untouched. Every device then starts a
-- fresh exchange, in which equal values merge without a conflict.
UPDATE sync_states SET document = '';
UPDATE sync_vault_documents SET document = '', conflicts = '[]';

-- +goose Down
-- The previous engine cannot read protocol 6 documents either, so they are
-- cleared again. The Automerge histories removed by Up exist only in the
-- pre-upgrade recovery point.
UPDATE sync_states SET document = '';
UPDATE sync_vault_documents SET document = '', conflicts = '[]';
