CREATE TABLE desktop_ssh_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL UNIQUE,
    algorithm TEXT NOT NULL,
    key_size INTEGER NOT NULL DEFAULT 0,
    passphrase_required INTEGER NOT NULL DEFAULT 0,
    private_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
ALTER TABLE desktop_servers ADD COLUMN ssh_key_id INTEGER
    REFERENCES desktop_ssh_keys(id) ON DELETE RESTRICT;
CREATE INDEX idx_desktop_servers_ssh_key ON desktop_servers(ssh_key_id);
