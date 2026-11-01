-- Additive production migration: existing connections remain direct (NULL).
-- Stop EasySSH and use maintenance schema-upgrade / schema-rollback.
-- A recovery archive is required before either direction. Down removes only
-- jump associations; recover them from that archive if needed.
-- +goose NO TRANSACTION
-- MySQL DDL implicitly commits: a transaction cannot roll it back. Each
-- direction is one atomic ALTER TABLE on MySQL 8/InnoDB. If interrupted, inspect
-- the schema and restore the recovery archive before retrying/version repair.

-- +goose Up
ALTER TABLE servers
 ADD COLUMN jump_server_id char(36) NULL,
 ADD INDEX idx_servers_jump_server_id (jump_server_id),
 ADD CONSTRAINT fk_servers_jump_server FOREIGN KEY (jump_server_id) REFERENCES servers(id) ON DELETE RESTRICT;

-- +goose Down
ALTER TABLE servers
 DROP FOREIGN KEY fk_servers_jump_server,
 DROP INDEX idx_servers_jump_server_id,
 DROP COLUMN jump_server_id;
