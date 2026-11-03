package schema

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io/fs"
	"strconv"
	"strings"
)

// UpgradeDigest binds an interrupted upgrade to exactly the scripts it started
// with. Never edit a released migration; add a new version instead.
func UpgradeDigest(driver string, from int64) (string, error) {
	definition, err := Definition(driver)
	if err != nil {
		return "", err
	}
	entries, err := fs.ReadDir(definition.Files, ".")
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	next := from + 1
	for _, entry := range entries {
		prefix, _, ok := strings.Cut(entry.Name(), "_")
		version, err := strconv.ParseInt(prefix, 10, 64)
		if !ok || err != nil || version <= from || version > Version {
			continue
		}
		if version != next {
			return "", fmt.Errorf("missing migration version %d", next)
		}
		data, err := fs.ReadFile(definition.Files, entry.Name())
		if err != nil {
			return "", err
		}
		if driver != "mysql" && strings.Contains(string(data), "+goose NO TRANSACTION") {
			return "", fmt.Errorf("automatic upgrade requires transactional migration %s", entry.Name())
		}
		fmt.Fprintf(hash, "%s\x00%s\x00", entry.Name(), data)
		next++
	}
	if next != Version+1 {
		return "", fmt.Errorf("incomplete upgrade path from schema %d", from)
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

// CheckUpgradeSource verifies versioned columns before startup, migration, or
// backup/restore. A version marker must agree with the actual structure.
func CheckUpgradeSource(ctx context.Context, db *sql.DB, driver string, version int64) error {
	if version < BaselineVersion || version > Version {
		return fmt.Errorf("unsupported source schema %d", version)
	}
	// These columns are unchanged from the immutable baseline.
	for _, query := range []string{
		"SELECT session_id,name,grant_id,grant_version,token_hash,created_at,last_seen_at,expires_at,revoked_at FROM automation_tokens WHERE 1=0",
		"SELECT server_id,enabled,port,tls FROM server_vnc_configs WHERE 1=0",
		"SELECT server_id,enabled,port,security,ignore_certificate FROM server_rdp_configs WHERE 1=0",
		"SELECT id,owner_id,name,token_cipher,bot_id,bot_username,server_ids_json,permission_mode,enabled,next_update_id,bind_code_hash,bind_expires_at,last_poll_at,last_error,created_at,updated_at FROM chat_connections WHERE 1=0",
		"SELECT id,connection_id,user_id,chat_id,display_name,current_session_id,revoked_at,created_at FROM chat_bindings WHERE 1=0",
		"SELECT id,binding_id,session_id,task_id,digest,expires_at,used_at FROM chat_approvals WHERE 1=0",
		"SELECT revision FROM chat_connections WHERE 1=0",
		"SELECT message_count,watching FROM chat_bindings WHERE 1=0",
		"SELECT provider,app_id FROM chat_connections WHERE 1=0",
		"SELECT external_user_id,external_chat_id FROM chat_bindings WHERE 1=0",
		"SELECT id,connection_id,created_at FROM chat_received_events WHERE 1=0",
		"SELECT jump_server_id FROM servers WHERE 1=0",
	} {
		rows, err := db.QueryContext(ctx, query)
		if err != nil {
			return fmt.Errorf("schema %d has incomplete columns: %w", version, err)
		}
		if err = rows.Close(); err != nil {
			return err
		}
	}
	for _, field := range []struct {
		table, column string
		present       bool
	}{
		{"security_config", "csrf_trusted_origins", version == BaselineVersion},
		{"system_config", "public_url", version < 3},
		{"automation_tokens", "token_cipher", version >= 4},
	} {
		rows, err := db.QueryContext(ctx, "SELECT * FROM "+field.table+" WHERE 1=0")
		if err != nil {
			return err
		}
		columns, columnErr := rows.Columns()
		closeErr := rows.Close()
		if columnErr != nil {
			return columnErr
		}
		if closeErr != nil {
			return closeErr
		}
		present := false
		for _, column := range columns {
			if strings.EqualFold(column, field.column) {
				present = true
				break
			}
		}
		if present != field.present {
			return fmt.Errorf("schema %d disagrees with %s.%s; inspect interrupted DDL before retrying", version, field.table, field.column)
		}
	}
	var err error
	var count int
	switch driver {
	case "sqlite":
		err = db.QueryRowContext(ctx, "SELECT count(*) FROM pragma_table_info('grants') WHERE name='purpose'").Scan(&count)
	case "postgres":
		err = db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='grants' AND column_name='purpose'").Scan(&count)
	case "mysql":
		err = db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='grants' AND column_name='purpose'").Scan(&count)
	}
	if err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("schema %d disagrees with grants.purpose; inspect interrupted DDL before retrying", version)
	}
	var kind, nullable, defaultValue string
	if driver == "sqlite" {
		var notNull int
		err = db.QueryRowContext(ctx, `SELECT type,"notnull",dflt_value FROM pragma_table_info('grants') WHERE name='purpose'`).Scan(&kind, &notNull, &defaultValue)
		if notNull == 1 {
			nullable = "NO"
		}
		if strings.EqualFold(kind, "varchar(16)") {
			kind = "varchar"
		}
	} else {
		query := "SELECT data_type,is_nullable,column_default,character_maximum_length FROM information_schema.columns WHERE table_schema="
		if driver == "postgres" {
			query += "'public'"
		} else {
			query += "DATABASE()"
		}
		query += " AND table_name='grants' AND column_name='purpose'"
		var length int
		err = db.QueryRowContext(ctx, query).Scan(&kind, &nullable, &defaultValue, &length)
		if err != nil {
			return err
		}
		if length != 16 {
			return fmt.Errorf("grants.purpose has an unexpected length")
		}
		if kind == "character varying" {
			kind = "varchar"
		}
	}
	if err != nil {
		return err
	}
	defaultValue = strings.Trim(strings.Split(defaultValue, "::")[0], "'\"")
	if strings.ToLower(kind) != "varchar" || nullable != "NO" || defaultValue != "share" {
		return fmt.Errorf("grants.purpose does not match schema %d", version)
	}
	return nil
}
