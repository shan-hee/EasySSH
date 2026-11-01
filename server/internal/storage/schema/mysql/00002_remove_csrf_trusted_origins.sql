-- +goose NO TRANSACTION
-- MySQL DDL commits implicitly. Restore the recovery point after interrupted DDL.

-- +goose Up
-- Removes obsolete Origin allowlist values. The startup recovery point retains
-- the original data; Down restores only the column, not the deleted values.
ALTER TABLE security_config DROP COLUMN csrf_trusted_origins;

-- +goose Down
ALTER TABLE security_config ADD COLUMN csrf_trusted_origins longtext;
