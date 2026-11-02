-- +goose NO TRANSACTION
-- MySQL DDL commits implicitly. Restore the recovery point after interrupted DDL.

-- +goose Up
-- Removes the obsolete fixed instance origin. Down restores an empty column;
-- recovering its original value requires the pre-upgrade recovery point.
ALTER TABLE system_config DROP COLUMN public_url;

-- +goose Down
ALTER TABLE system_config ADD COLUMN public_url longtext;
