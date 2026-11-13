-- +goose NO TRANSACTION
-- MySQL DDL commits implicitly. Restore the recovery point after interrupted DDL.

-- +goose Up
-- Retention periods for finished task records and for logs, in days. 0 keeps
-- records forever. Existing instances start with 90 days, which for logs is a
-- change: until now logs were only removed by hand.
ALTER TABLE system_config ADD COLUMN task_retention_days bigint NOT NULL DEFAULT 90;
ALTER TABLE system_config ADD COLUMN log_retention_days bigint NOT NULL DEFAULT 90;

-- +goose Down
-- Drops the chosen periods; the previous program used its built-in ones.
ALTER TABLE system_config DROP COLUMN log_retention_days;
ALTER TABLE system_config DROP COLUMN task_retention_days;
