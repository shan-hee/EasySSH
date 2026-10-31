-- +goose Up
ALTER TABLE grants ADD COLUMN purpose varchar(16) NOT NULL DEFAULT 'share';
CREATE TABLE server_rdp_configs (
  server_id char(36) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  port integer NOT NULL DEFAULT 3389 CHECK (port BETWEEN 1 AND 65535),
  security varchar(8) NOT NULL DEFAULT 'nla' CHECK (security IN ('nla', 'tls')),
  ignore_certificate boolean NOT NULL DEFAULT false,
  FOREIGN KEY (server_id) REFERENCES servers (id) ON DELETE CASCADE
);

-- +goose Down
UPDATE grants SET revoked_at = CURRENT_TIMESTAMP, version = version + 1
  WHERE (default_content = 'rdp' OR purpose = 'automation') AND revoked_at IS NULL;
DROP TABLE server_rdp_configs;
ALTER TABLE grants DROP COLUMN purpose;
