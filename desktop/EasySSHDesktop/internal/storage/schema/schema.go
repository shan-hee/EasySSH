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

const Version int64 = 6

func Definition(driver string) (dbmigration.Definition, error) {
	switch driver {
	case "sqlite":
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
	if version == 5 {
		return fmt.Errorf("database schema 5 requires an explicit upgrade: stop EasySSHDesktop and run maintenance schema-upgrade --file <backup> --password-file <password>")
	}
	return dbmigration.Start(ctx, db, driver, definition)
}

func Initialize(ctx context.Context, db *sql.DB, driver string) error {
	definition, err := Definition(driver)
	if err != nil {
		return err
	}
	return dbmigration.Initialize(ctx, db, driver, definition)
}

// Migrate is called only by maintenance while holding the instance lock, after
// creating the recovery archive. SQLite DDL and version updates are transactional.
func Migrate(ctx context.Context, db *sql.DB, rollback bool) error {
	version, err := dbmigration.Version(ctx, db, "sqlite")
	if err != nil {
		return err
	}
	expected := int64(5)
	if rollback {
		expected = Version
	}
	if version != expected {
		return fmt.Errorf("unexpected source schema %d", version)
	}
	if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys=ON"); err != nil {
		return err
	}
	definition, err := Definition("sqlite")
	if err != nil {
		return err
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, db, definition.Files, goose.WithDisableGlobalRegistry(true))
	if err != nil {
		return err
	}
	if rollback {
		_, err = provider.DownTo(ctx, 5)
	} else {
		_, err = provider.UpTo(ctx, Version)
	}
	return err
}
