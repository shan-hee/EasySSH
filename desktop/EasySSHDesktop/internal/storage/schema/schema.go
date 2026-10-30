// Package schema owns this application's fresh database definition.
package schema

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"

	"github.com/easyssh/shared/dbmigration"
)

//go:embed */*.sql
var scripts embed.FS

const Version int64 = 5

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
	return dbmigration.Start(ctx, db, driver, definition)
}

func Initialize(ctx context.Context, db *sql.DB, driver string) error {
	definition, err := Definition(driver)
	if err != nil {
		return err
	}
	return dbmigration.Initialize(ctx, db, driver, definition)
}
