-- Additive production migration: existing connections remain direct (NULL).
-- Stop EasySSH and use maintenance schema-upgrade / schema-rollback.
-- A recovery archive is required before either direction. Down removes only
-- jump associations; recover them from that archive if needed.
-- Goose wraps each direction AND version tracking in BEGIN/COMMIT and
-- ROLLBACK on error. Do not run both directions manually in one transaction.

-- +goose Up
ALTER TABLE servers ADD COLUMN jump_server_id char(36) REFERENCES servers(id) ON DELETE RESTRICT;
CREATE INDEX idx_servers_jump_server_id ON servers(jump_server_id);

-- +goose Down
DROP INDEX idx_servers_jump_server_id;
ALTER TABLE servers DROP COLUMN jump_server_id;
