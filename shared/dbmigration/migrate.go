// Package dbmigration owns the immutable, numbered database schemas for both applications.
package dbmigration

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
)

//go:embed server/*/*.sql desktop/*/*.sql
var migrations embed.FS

const Latest int64 = 1

func provider(db *sql.DB, profile, driver string) (*goose.Provider, error) {
	if profile != "server" && profile != "desktop" {
		return nil, errors.New("invalid migration profile")
	}
	if driver != "sqlite" && driver != "postgres" && driver != "mysql" {
		return nil, errors.New("invalid migration driver")
	}
	files, err := fs.Sub(migrations, profile+"/"+driver)
	if err != nil {
		return nil, err
	}
	dialect := goose.Dialect(driver)
	if driver == "sqlite" {
		dialect = goose.DialectSQLite3
	}
	return goose.NewProvider(dialect, db, files, goose.WithDisableGlobalRegistry(true))
}

// Version is read-only; it never creates a version table in an existing database.
func Version(ctx context.Context, db *sql.DB, driver string) (int64, error) {
	names, err := Tables(ctx, db, driver)
	if err != nil {
		return 0, err
	}
	found := false
	for _, name := range names {
		if name == "goose_db_version" {
			found = true
		}
	}
	if !found {
		if len(names) != 0 {
			return 0, errors.New("unversioned development database: preserve it with the matching previous application and initialize a new empty database; automatic conversion is not supported")
		}
		return 0, nil
	}
	rows, err := db.QueryContext(ctx, "SELECT version_id,is_applied FROM goose_db_version ORDER BY id DESC")
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	seen := map[int64]bool{}
	for rows.Next() {
		var version int64
		var applied bool
		if err := rows.Scan(&version, &applied); err != nil {
			return 0, err
		}
		if seen[version] {
			continue
		}
		seen[version] = true
		if applied {
			return version, nil
		}
	}
	return 0, rows.Err()
}

func Tables(ctx context.Context, db *sql.DB, driver string) ([]string, error) {
	query := ""
	switch driver {
	case "sqlite":
		query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
	case "postgres":
		query = "SELECT tablename FROM pg_tables WHERE schemaname='public'"
	case "mysql":
		query = "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'"
	default:
		return nil, errors.New("unsupported database driver")
	}
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

// Start initializes an empty installation. Existing installations require explicit upgrades.
func Start(ctx context.Context, db *sql.DB, profile, driver string) error {
	version, err := Version(ctx, db, driver)
	if err != nil {
		return err
	}
	if version == 0 {
		return Up(ctx, db, profile, driver)
	}
	if version != Latest {
		return fmt.Errorf("database version %d, application requires %d; run maintenance migrate with the appropriate application version", version, Latest)
	}
	return nil
}

// Up must be called while the instance lock is held and application services are stopped.
func Up(ctx context.Context, db *sql.DB, profile, driver string) error {
	version, err := Version(ctx, db, driver)
	if err != nil {
		return err
	}
	if version > Latest {
		return fmt.Errorf("database version %d is newer than supported version %d", version, Latest)
	}
	p, err := provider(db, profile, driver)
	if err != nil {
		return err
	}
	_, err = p.Up(ctx)
	return err
}
