-- Goose wraps each direction and its version record in a transaction.
-- Preserve every row, column definition, CHECK, FK and index. Only the four
-- actor columns change nullability; TEXT types and absent defaults are retained.
-- No PRAGMA foreign_keys change and no parent-table rename are needed.

-- +goose Up
UPDATE "operation_records" SET "actor_kind" = '' WHERE "actor_kind" IS NULL;
UPDATE "operation_records" SET "actor_id" = '' WHERE "actor_id" IS NULL;
UPDATE "operation_records" SET "actor_session_id" = '' WHERE "actor_session_id" IS NULL;
UPDATE "operation_records" SET "actor_grant_id" = '' WHERE "actor_grant_id" IS NULL;

-- Save both tables before touching the parent. Temporary tables have no FKs.
CREATE TEMP TABLE "__easyssh_operation_records_00008" AS
SELECT * FROM "operation_records";
CREATE TEMP TABLE "__easyssh_operation_resources_00008" AS
SELECT "record_id", "server_id", "name" FROM "operation_resources";

-- The saved child rows are restored after their parent. Keep the child table
-- itself: its FK must continue to reference operation_records, never a renamed
-- backup table. Foreign-key enforcement stays enabled throughout.
DELETE FROM "operation_resources";
DROP TABLE "operation_records";

CREATE TABLE "operation_records" (
  "detail_content_id" char(36),
  "detail_content_size" bigint NOT NULL DEFAULT 0,
  "detail_content_sha256" varchar(64) NOT NULL DEFAULT '',
  "task_content_id" char(36),
  "task_content_size" bigint NOT NULL DEFAULT 0,
  "task_content_sha256" varchar(64) NOT NULL DEFAULT '',
  "work_id" char(36) NOT NULL,
  "parent_work_id" char(36),
  "work_started_at" datetime NOT NULL,
  "attempt" integer NOT NULL DEFAULT 1,
  "established_at" datetime,
  "connection_uncertain_until" datetime,
  "actor_kind" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "actor_session_id" TEXT NOT NULL,
  "actor_grant_id" TEXT NOT NULL,
  "id" char(36) NOT NULL,
  "username" text,
  "type" varchar(30) NOT NULL,
  "category" varchar(20) NOT NULL DEFAULT 'activity',
  "action" varchar(50) NOT NULL,
  "status" varchar(30) NOT NULL,
  "server_id" char(36),
  "server_name" text,
  "title" text,
  "resource" text,
  "source" text,
  "ip" text,
  "user_agent" text,
  "started_at" datetime,
  "finished_at" datetime,
  "duration_ms" integer DEFAULT 0,
  "progress" integer DEFAULT 0,
  "total_count" integer DEFAULT 0,
  "success_count" integer DEFAULT 0,
  "failure_count" integer DEFAULT 0,
  "bytes_total" integer DEFAULT 0,
  "bytes_processed" integer DEFAULT 0,
  "bytes_completed" integer DEFAULT 0,
  "speed_bps" integer DEFAULT 0,
  "error_message" text,
  "detail_json" text,
  "source_table" text NOT NULL,
  "source_id" text NOT NULL,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  CONSTRAINT "fk_operation_detail_content" FOREIGN KEY ("detail_content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT,
  CHECK ("detail_content_id" IS NULL OR (COALESCE("detail_json",'')='' AND "task_content_id" IS NULL)),
  CONSTRAINT "fk_operation_task_content" FOREIGN KEY ("task_content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT,
  CHECK ("task_content_id" IS NULL OR COALESCE("detail_json",'')=''),
  PRIMARY KEY ("id")
);

INSERT INTO "operation_records" (
  "detail_content_id", "detail_content_size", "detail_content_sha256", "task_content_id",
  "task_content_size", "task_content_sha256", "work_id", "parent_work_id",
  "work_started_at", "attempt", "established_at", "connection_uncertain_until",
  "actor_kind", "actor_id", "actor_session_id", "actor_grant_id",
  "id", "username", "type", "category",
  "action", "status", "server_id", "server_name",
  "title", "resource", "source", "ip",
  "user_agent", "started_at", "finished_at", "duration_ms",
  "progress", "total_count", "success_count", "failure_count",
  "bytes_total", "bytes_processed", "bytes_completed", "speed_bps",
  "error_message", "detail_json", "source_table", "source_id",
  "created_at", "updated_at", "deleted_at"
)
SELECT
  "detail_content_id", "detail_content_size", "detail_content_sha256", "task_content_id",
  "task_content_size", "task_content_sha256", "work_id", "parent_work_id",
  "work_started_at", "attempt", "established_at", "connection_uncertain_until",
  "actor_kind", "actor_id", "actor_session_id", "actor_grant_id",
  "id", "username", "type", "category",
  "action", "status", "server_id", "server_name",
  "title", "resource", "source", "ip",
  "user_agent", "started_at", "finished_at", "duration_ms",
  "progress", "total_count", "success_count", "failure_count",
  "bytes_total", "bytes_processed", "bytes_completed", "speed_bps",
  "error_message", "detail_json", "source_table", "source_id",
  "created_at", "updated_at", "deleted_at"
FROM temp."__easyssh_operation_records_00008";

CREATE INDEX "idx_operation_detail_content" ON "operation_records" ("detail_content_id");
CREATE INDEX "idx_operation_task_content" ON "operation_records" ("task_content_id");
CREATE INDEX "idx_operation_type_time" ON "operation_records" ("type", "created_at");
CREATE INDEX "idx_operation_category_time" ON "operation_records" ("category", "created_at");
CREATE INDEX "idx_operation_records_action" ON "operation_records" ("action");
CREATE INDEX "idx_operation_records_status" ON "operation_records" ("status");
CREATE INDEX "idx_operation_records_server_id" ON "operation_records" ("server_id");
CREATE INDEX "idx_operation_records_source" ON "operation_records" ("source");
CREATE INDEX "idx_operation_ip_time" ON "operation_records" ("ip", "created_at");
CREATE INDEX "idx_operation_records_started_at" ON "operation_records" ("started_at");
CREATE INDEX "idx_operation_records_finished_at" ON "operation_records" ("finished_at");
CREATE UNIQUE INDEX "idx_operation_source" ON "operation_records" ("source_table", "source_id");
CREATE INDEX "idx_operation_records_created_at" ON "operation_records" ("created_at");
CREATE INDEX "idx_operation_records_deleted_at" ON "operation_records" ("deleted_at");
CREATE INDEX "idx_operation_actor_time" ON "operation_records" ("actor_kind", "actor_session_id", "created_at");
CREATE INDEX "idx_operation_records_work" ON "operation_records" ("work_id", "work_started_at");

INSERT INTO "operation_resources" ("record_id", "server_id", "name")
SELECT "record_id", "server_id", "name" FROM temp."__easyssh_operation_resources_00008";
DROP TABLE temp."__easyssh_operation_resources_00008";
DROP TABLE temp."__easyssh_operation_records_00008";

-- +goose Down
-- Restore nullable columns. Previously normalized empty strings stay empty;
-- the original distinction between NULL and empty requires the recovery point.
-- Save both tables before touching the parent. Temporary tables have no FKs.
CREATE TEMP TABLE "__easyssh_operation_records_00008" AS
SELECT * FROM "operation_records";
CREATE TEMP TABLE "__easyssh_operation_resources_00008" AS
SELECT "record_id", "server_id", "name" FROM "operation_resources";

-- The saved child rows are restored after their parent. Keep the child table
-- itself: its FK must continue to reference operation_records, never a renamed
-- backup table. Foreign-key enforcement stays enabled throughout.
DELETE FROM "operation_resources";
DROP TABLE "operation_records";

CREATE TABLE "operation_records" (
  "detail_content_id" char(36),
  "detail_content_size" bigint NOT NULL DEFAULT 0,
  "detail_content_sha256" varchar(64) NOT NULL DEFAULT '',
  "task_content_id" char(36),
  "task_content_size" bigint NOT NULL DEFAULT 0,
  "task_content_sha256" varchar(64) NOT NULL DEFAULT '',
  "work_id" char(36) NOT NULL,
  "parent_work_id" char(36),
  "work_started_at" datetime NOT NULL,
  "attempt" integer NOT NULL DEFAULT 1,
  "established_at" datetime,
  "connection_uncertain_until" datetime,
  "actor_kind" TEXT,
  "actor_id" TEXT,
  "actor_session_id" TEXT,
  "actor_grant_id" TEXT,
  "id" char(36) NOT NULL,
  "username" text,
  "type" varchar(30) NOT NULL,
  "category" varchar(20) NOT NULL DEFAULT 'activity',
  "action" varchar(50) NOT NULL,
  "status" varchar(30) NOT NULL,
  "server_id" char(36),
  "server_name" text,
  "title" text,
  "resource" text,
  "source" text,
  "ip" text,
  "user_agent" text,
  "started_at" datetime,
  "finished_at" datetime,
  "duration_ms" integer DEFAULT 0,
  "progress" integer DEFAULT 0,
  "total_count" integer DEFAULT 0,
  "success_count" integer DEFAULT 0,
  "failure_count" integer DEFAULT 0,
  "bytes_total" integer DEFAULT 0,
  "bytes_processed" integer DEFAULT 0,
  "bytes_completed" integer DEFAULT 0,
  "speed_bps" integer DEFAULT 0,
  "error_message" text,
  "detail_json" text,
  "source_table" text NOT NULL,
  "source_id" text NOT NULL,
  "created_at" datetime,
  "updated_at" datetime,
  "deleted_at" datetime,
  CONSTRAINT "fk_operation_detail_content" FOREIGN KEY ("detail_content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT,
  CHECK ("detail_content_id" IS NULL OR (COALESCE("detail_json",'')='' AND "task_content_id" IS NULL)),
  CONSTRAINT "fk_operation_task_content" FOREIGN KEY ("task_content_id") REFERENCES "content_objects" ("id") ON DELETE RESTRICT,
  CHECK ("task_content_id" IS NULL OR COALESCE("detail_json",'')=''),
  PRIMARY KEY ("id")
);

INSERT INTO "operation_records" (
  "detail_content_id", "detail_content_size", "detail_content_sha256", "task_content_id",
  "task_content_size", "task_content_sha256", "work_id", "parent_work_id",
  "work_started_at", "attempt", "established_at", "connection_uncertain_until",
  "actor_kind", "actor_id", "actor_session_id", "actor_grant_id",
  "id", "username", "type", "category",
  "action", "status", "server_id", "server_name",
  "title", "resource", "source", "ip",
  "user_agent", "started_at", "finished_at", "duration_ms",
  "progress", "total_count", "success_count", "failure_count",
  "bytes_total", "bytes_processed", "bytes_completed", "speed_bps",
  "error_message", "detail_json", "source_table", "source_id",
  "created_at", "updated_at", "deleted_at"
)
SELECT
  "detail_content_id", "detail_content_size", "detail_content_sha256", "task_content_id",
  "task_content_size", "task_content_sha256", "work_id", "parent_work_id",
  "work_started_at", "attempt", "established_at", "connection_uncertain_until",
  "actor_kind", "actor_id", "actor_session_id", "actor_grant_id",
  "id", "username", "type", "category",
  "action", "status", "server_id", "server_name",
  "title", "resource", "source", "ip",
  "user_agent", "started_at", "finished_at", "duration_ms",
  "progress", "total_count", "success_count", "failure_count",
  "bytes_total", "bytes_processed", "bytes_completed", "speed_bps",
  "error_message", "detail_json", "source_table", "source_id",
  "created_at", "updated_at", "deleted_at"
FROM temp."__easyssh_operation_records_00008";

CREATE INDEX "idx_operation_detail_content" ON "operation_records" ("detail_content_id");
CREATE INDEX "idx_operation_task_content" ON "operation_records" ("task_content_id");
CREATE INDEX "idx_operation_type_time" ON "operation_records" ("type", "created_at");
CREATE INDEX "idx_operation_category_time" ON "operation_records" ("category", "created_at");
CREATE INDEX "idx_operation_records_action" ON "operation_records" ("action");
CREATE INDEX "idx_operation_records_status" ON "operation_records" ("status");
CREATE INDEX "idx_operation_records_server_id" ON "operation_records" ("server_id");
CREATE INDEX "idx_operation_records_source" ON "operation_records" ("source");
CREATE INDEX "idx_operation_ip_time" ON "operation_records" ("ip", "created_at");
CREATE INDEX "idx_operation_records_started_at" ON "operation_records" ("started_at");
CREATE INDEX "idx_operation_records_finished_at" ON "operation_records" ("finished_at");
CREATE UNIQUE INDEX "idx_operation_source" ON "operation_records" ("source_table", "source_id");
CREATE INDEX "idx_operation_records_created_at" ON "operation_records" ("created_at");
CREATE INDEX "idx_operation_records_deleted_at" ON "operation_records" ("deleted_at");
CREATE INDEX "idx_operation_actor_time" ON "operation_records" ("actor_kind", "actor_session_id", "created_at");
CREATE INDEX "idx_operation_records_work" ON "operation_records" ("work_id", "work_started_at");

INSERT INTO "operation_resources" ("record_id", "server_id", "name")
SELECT "record_id", "server_id", "name" FROM temp."__easyssh_operation_resources_00008";
DROP TABLE temp."__easyssh_operation_resources_00008";
DROP TABLE temp."__easyssh_operation_records_00008";
