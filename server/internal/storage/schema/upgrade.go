package schema

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io/fs"
	"strconv"
	"strings"

	"github.com/easyssh/shared/dbmigration"
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

// CheckUpgradeSource refuses untracked/partially applied additive DDL. In
// particular, MySQL IF NOT EXISTS must never silently accept unknown objects.
func CheckUpgradeSource(ctx context.Context, db *sql.DB, driver string, version int64) error {
	tables, err := dbmigration.Tables(ctx, db, driver)
	if err != nil {
		return err
	}
	present := make(map[string]bool, len(tables))
	for _, name := range tables {
		present[name] = true
	}
	for name, introduced := range map[string]int64{"automation_tokens": 6, "server_vnc_configs": 6, "server_rdp_configs": 7, "chat_connections": 8, "chat_bindings": 8, "chat_approvals": 8, "chat_received_events": 10} {
		if present[name] != (version >= introduced) {
			return fmt.Errorf("schema %d disagrees with table %s; inspect interrupted DDL before retrying", version, name)
		}
	}
	for _, name := range []string{"chat_conversations", "chat_inbox", "chat_outbox"} {
		if present[name] != (version == 8) {
			return fmt.Errorf("schema %d disagrees with table %s; inspect interrupted DDL before retrying", version, name)
		}
	}
	for _, name := range []string{"chat_approvals_v8", "chat_approvals_v9"} {
		if present[name] {
			return fmt.Errorf("unfinished chat migration table %s; restore the migration recovery point", name)
		}
	}
	// An interrupted MySQL upgrade may have added columns but not yet created
	// chat_received_events. Refuse to resume those untracked partial changes.
	if version >= 8 {
		for table, columns := range map[string][]string{
			"chat_connections": {"provider", "app_id"},
			"chat_bindings":    {"external_user_id", "external_chat_id"},
		} {
			for _, column := range columns {
				var count int
				var err error
				switch driver {
				case "sqlite":
					err = db.QueryRowContext(ctx, "SELECT count(*) FROM pragma_table_info(?) WHERE name = ?", table, column).Scan(&count)
				case "postgres":
					err = db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2", table, column).Scan(&count)
				case "mysql":
					err = db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?", table, column).Scan(&count)
				}
				if err != nil {
					return err
				}
				if (count == 1) != (version >= 10) {
					return fmt.Errorf("schema %d disagrees with %s.%s; inspect interrupted DDL before retrying", version, table, column)
				}
			}
		}
	}
	// Detect a committed MySQL ALTER whose version update was interrupted.
	var jumpColumns int
	switch driver {
	case "sqlite":
		err = db.QueryRowContext(ctx, "SELECT count(*) FROM pragma_table_info('servers') WHERE name='jump_server_id'").Scan(&jumpColumns)
	case "postgres":
		err = db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='servers' AND column_name='jump_server_id'").Scan(&jumpColumns)
	case "mysql":
		err = db.QueryRowContext(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='servers' AND column_name='jump_server_id'").Scan(&jumpColumns)
	}
	if err != nil {
		return err
	}
	if (jumpColumns == 1) != (version >= 11) {
		return fmt.Errorf("schema %d disagrees with servers.jump_server_id; restore the migration recovery point", version)
	}
	// Validate the columns introduced by completed versions, not just table names.
	for _, check := range []struct {
		introduced int64
		removed    int64
		query      string
	}{
		{6, 0, "SELECT session_id,name,grant_id,grant_version,token_hash,created_at,last_seen_at,expires_at,revoked_at FROM automation_tokens WHERE 1=0"},
		{6, 0, "SELECT server_id,enabled,port,tls FROM server_vnc_configs WHERE 1=0"},
		{7, 0, "SELECT server_id,enabled,port,security,ignore_certificate FROM server_rdp_configs WHERE 1=0"},
		{8, 0, "SELECT id,owner_id,name,token_cipher,bot_id,bot_username,server_ids_json,permission_mode,enabled,next_update_id,bind_code_hash,bind_expires_at,last_poll_at,last_error,created_at,updated_at FROM chat_connections WHERE 1=0"},
		{8, 0, "SELECT id,connection_id,user_id,chat_id,display_name,current_session_id,revoked_at,created_at FROM chat_bindings WHERE 1=0"},
		{8, 0, "SELECT id,binding_id,session_id,task_id,digest,expires_at,used_at FROM chat_approvals WHERE 1=0"},
		{8, 9, "SELECT id,binding_id,watching,status,message_count,created_at,updated_at FROM chat_conversations WHERE 1=0"},
		{8, 9, "SELECT id,connection_id,update_id,payload,status,created_at FROM chat_inbox WHERE 1=0"},
		{8, 9, "SELECT id,connection_id,binding_id,chat_id,text,buttons,status,attempts,next_attempt_at,last_error,created_at FROM chat_outbox WHERE 1=0"},
		{9, 0, "SELECT revision FROM chat_connections WHERE 1=0"},
		{9, 0, "SELECT message_count,watching FROM chat_bindings WHERE 1=0"},
		{10, 0, "SELECT provider,app_id FROM chat_connections WHERE 1=0"},
		{10, 0, "SELECT external_user_id,external_chat_id FROM chat_bindings WHERE 1=0"},
		{10, 0, "SELECT id,connection_id,created_at FROM chat_received_events WHERE 1=0"},
		{11, 0, "SELECT jump_server_id FROM servers WHERE 1=0"},
	} {
		if version < check.introduced || check.removed != 0 && version >= check.removed {
			continue
		}
		rows, err := db.QueryContext(ctx, check.query)
		if err != nil {
			return fmt.Errorf("schema %d has incomplete migrated columns: %w", version, err)
		}
		if err = rows.Close(); err != nil {
			return err
		}
	}
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
	if (count == 1) != (version >= 7) {
		return fmt.Errorf("schema %d disagrees with grants.purpose; inspect interrupted DDL before retrying", version)
	}
	if version >= 7 {
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
	}
	return nil
}
