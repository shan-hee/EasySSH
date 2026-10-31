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
	for name, introduced := range map[string]int64{"automation_tokens": 6, "server_vnc_configs": 6, "server_rdp_configs": 7} {
		if present[name] != (version >= introduced) {
			return fmt.Errorf("schema %d disagrees with table %s; inspect interrupted DDL before retrying", version, name)
		}
	}
	// Validate the columns introduced by completed versions, not just table names.
	for _, check := range []struct {
		introduced int64
		query      string
	}{
		{6, "SELECT session_id,name,grant_id,grant_version,token_hash,created_at,last_seen_at,expires_at,revoked_at FROM automation_tokens WHERE 1=0"},
		{6, "SELECT server_id,enabled,port,tls FROM server_vnc_configs WHERE 1=0"},
		{7, "SELECT server_id,enabled,port,security,ignore_certificate FROM server_rdp_configs WHERE 1=0"},
	} {
		if version < check.introduced {
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
