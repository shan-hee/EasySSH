-- Goose wraps each direction and its version record in a transaction.

-- +goose Up
-- Removes obsolete Origin allowlist values. The startup recovery point retains
-- the original data; Down restores only the column, not the deleted values.
ALTER TABLE security_config DROP COLUMN csrf_trusted_origins;

-- +goose Down
ALTER TABLE security_config ADD COLUMN csrf_trusted_origins text;
