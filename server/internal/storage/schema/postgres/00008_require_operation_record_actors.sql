-- Goose wraps each direction and its version record in a transaction.
-- Keep the existing varchar(36) types and absent defaults on all four columns.

-- +goose Up
UPDATE "operation_records" SET "actor_kind" = '' WHERE "actor_kind" IS NULL;
UPDATE "operation_records" SET "actor_id" = '' WHERE "actor_id" IS NULL;
UPDATE "operation_records" SET "actor_session_id" = '' WHERE "actor_session_id" IS NULL;
UPDATE "operation_records" SET "actor_grant_id" = '' WHERE "actor_grant_id" IS NULL;

ALTER TABLE "operation_records"
  ALTER COLUMN "actor_kind" SET NOT NULL,
  ALTER COLUMN "actor_id" SET NOT NULL,
  ALTER COLUMN "actor_session_id" SET NOT NULL,
  ALTER COLUMN "actor_grant_id" SET NOT NULL;

-- +goose Down
-- Empty strings stay empty; no rows are removed.
ALTER TABLE "operation_records"
  ALTER COLUMN "actor_kind" DROP NOT NULL,
  ALTER COLUMN "actor_id" DROP NOT NULL,
  ALTER COLUMN "actor_session_id" DROP NOT NULL,
  ALTER COLUMN "actor_grant_id" DROP NOT NULL;
