-- Goose wraps each direction and its version record in a transaction.

-- +goose Up
-- Deleted servers, scripts and AI conversations are copied here and can be
-- restored until the retention period for deleted data passes.
CREATE TABLE desktop_recycle_bin (
 id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('server','script','ai_session')),
 resource_id TEXT NOT NULL,
 name TEXT NOT NULL,
 payload TEXT NOT NULL,
 removed_at TEXT NOT NULL
);
CREATE INDEX idx_desktop_recycle_bin_resource ON desktop_recycle_bin(kind,resource_id);
CREATE INDEX idx_desktop_recycle_bin_removed_at ON desktop_recycle_bin(removed_at);

-- +goose Down
-- Drops the recycle bin with everything in it.
DROP TABLE desktop_recycle_bin;
