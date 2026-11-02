-- Goose wraps each direction and its version record in a transaction.

-- +goose Up
-- Removes the obsolete fixed instance origin. Down restores an empty column;
-- recovering its original value requires the pre-upgrade recovery point.
ALTER TABLE system_config DROP COLUMN public_url;

-- +goose Down
ALTER TABLE system_config ADD COLUMN public_url text;
