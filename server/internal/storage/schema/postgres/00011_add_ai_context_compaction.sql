-- Goose wraps each direction and its version record in a transaction.

-- +goose Up
-- Server AI sessions may replace older turns with a summary in model requests.
-- The stored history stays complete; the summary is derived state that edits
-- or synchronization reset. Defaults enable compaction for a 128K-token window.
ALTER TABLE ai_sessions ADD COLUMN context_summary_turns integer NOT NULL DEFAULT 0;
ALTER TABLE system_config ADD COLUMN ai_compaction_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE system_config ADD COLUMN ai_context_window bigint NOT NULL DEFAULT 128000;
ALTER TABLE system_config ADD COLUMN ai_compaction_threshold bigint NOT NULL DEFAULT 80;
ALTER TABLE system_config ADD COLUMN ai_compaction_keep_turns bigint NOT NULL DEFAULT 4;
-- Added last: its presence marks a completed upgrade.
ALTER TABLE ai_sessions ADD COLUMN context_summary TEXT;

-- +goose Down
-- Drops summaries and settings; the next request sends full histories again.
ALTER TABLE ai_sessions DROP COLUMN context_summary;
ALTER TABLE system_config DROP COLUMN ai_compaction_keep_turns;
ALTER TABLE system_config DROP COLUMN ai_compaction_threshold;
ALTER TABLE system_config DROP COLUMN ai_context_window;
ALTER TABLE system_config DROP COLUMN ai_compaction_enabled;
ALTER TABLE ai_sessions DROP COLUMN context_summary_turns;
