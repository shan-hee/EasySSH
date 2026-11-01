-- Stop EasySSHDesktop and use maintenance schema-upgrade / schema-rollback.
-- Both commands create an encrypted recovery archive before changing schema.
-- Goose executes each direction and its version update in one transaction:
-- BEGIN/COMMIT on success, ROLLBACK on error. Existing fields are retained.
-- Down removes jump associations; restore the archive to recover them.

-- +goose Up
ALTER TABLE desktop_servers ADD COLUMN jump_server_id TEXT REFERENCES desktop_servers(id) ON DELETE RESTRICT;
CREATE INDEX idx_desktop_servers_jump_server_id ON desktop_servers(jump_server_id);

-- +goose Down
DROP INDEX idx_desktop_servers_jump_server_id;
ALTER TABLE desktop_servers DROP COLUMN jump_server_id;
