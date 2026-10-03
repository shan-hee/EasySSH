-- Run inside the migration transaction, after transferring private keys.
-- Existing ssh_key_id / FK / unique index were already created by AutoMigrate.
DROP INDEX IF EXISTS idx_ssh_keys_deleted_at;
DROP INDEX IF EXISTS idx_ssh_keys_user_id;
ALTER TABLE ssh_keys DROP COLUMN deleted_at;
ALTER TABLE servers DROP COLUMN private_key;
