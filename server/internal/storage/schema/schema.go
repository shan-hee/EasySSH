// Package schema owns this application's fresh database definition.
package schema

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"

	"github.com/easyssh/shared/dbmigration"
	"github.com/pressly/goose/v3"
)

//go:embed */*.sql
var scripts embed.FS

const Version int64 = 7

const BaselineVersion int64 = 1

func Definition(driver string) (dbmigration.Definition, error) {
	switch driver {
	case "sqlite", "postgres", "mysql":
	default:
		return dbmigration.Definition{}, fmt.Errorf("unsupported database driver %q", driver)
	}
	files, err := fs.Sub(scripts, driver)
	if err != nil {
		return dbmigration.Definition{}, err
	}
	return dbmigration.Definition{Files: files, Version: Version}, nil
}

func Start(ctx context.Context, db *sql.DB, driver string) error {
	definition, err := Definition(driver)
	if err != nil {
		return err
	}
	version, err := dbmigration.Version(ctx, db, driver)
	if err != nil {
		return err
	}
	if version >= BaselineVersion && version < Version {
		return fmt.Errorf("database schema %d requires an explicit upgrade: stop the server, back up with the matching executable, then run maintenance schema-upgrade", version)
	}
	if err := dbmigration.Start(ctx, db, driver, definition); err != nil {
		return err
	}
	return CheckUpgradeSource(ctx, db, driver, Version)
}

func Initialize(ctx context.Context, db *sql.DB, driver string) error {
	definition, err := Definition(driver)
	if err != nil {
		return err
	}
	return dbmigration.Initialize(ctx, db, driver, definition)
}

// Migrate runs only under the host's instance/database locks. Startup and CLI
// callers must create a recovery point before invoking an in-place upgrade.
// Goose wraps SQLite/PostgreSQL SQL in a transaction, including version tracking.
func Migrate(ctx context.Context, db *sql.DB, driver string, rollback bool) error {
	current, err := dbmigration.Version(ctx, db, driver)
	if err != nil {
		return err
	}
	if !rollback && current == Version || rollback && current == BaselineVersion {
		return nil
	}
	if current < BaselineVersion || current > Version {
		return fmt.Errorf("unsupported source schema %d", current)
	}
	definition, err := Definition(driver)
	if err != nil {
		return err
	}
	dialect := goose.Dialect(driver)
	if driver == "sqlite" {
		dialect = goose.DialectSQLite3
	}
	provider, err := goose.NewProvider(dialect, db, definition.Files, goose.WithDisableGlobalRegistry(true))
	if err != nil {
		return err
	}
	if rollback {
		_, err = provider.DownTo(ctx, current-1)
	} else {
		_, err = provider.UpTo(ctx, Version)
	}
	return err
}
