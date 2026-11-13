package app

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/easyssh/easyssh-desktop/internal/storage/schema"
	"github.com/easyssh/shared/dbmigration"
	"github.com/easyssh/shared/instancebackup"
)

var desktopMigrationMu sync.Mutex

func configureDesktopDatabase(database *sql.DB) error {
	desktopMigrationMu.Lock()
	defer desktopMigrationMu.Unlock()
	database.SetMaxOpenConns(1)
	for _, statement := range []string{"PRAGMA journal_mode=WAL", "PRAGMA busy_timeout=5000", "PRAGMA foreign_keys=ON"} {
		if _, err := database.Exec(statement); err != nil {
			return err
		}
	}
	ctx := context.Background()
	version, err := dbmigration.Version(ctx, database, "sqlite")
	if err != nil {
		return err
	}
	if version >= schema.BaselineVersion && version < schema.Version {
		if err = upgradeDesktopDatabase(ctx, database, version); err != nil {
			return err
		}
	}
	return schema.Start(ctx, database, "sqlite")
}

// upgradeDesktopDatabase brings an older database to the current schema when
// the application starts. Every service opens the database through
// configureDesktopDatabase, so nothing has used it yet.
//
// The recovery point is a plain snapshot. It holds the same ciphertext as the
// live database beside it and is unlocked by the same root key, which never
// leaves the OS credential store, so a password would protect nothing more.
func upgradeDesktopDatabase(ctx context.Context, database *sql.DB, from int64) error {
	directory, err := filepath.Abs(filepath.Join(desktopBackupDirectory(), "migrations"))
	if err != nil {
		return err
	}
	if err = os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	snapshot := filepath.Join(directory, fmt.Sprintf("schema-%d-to-%d-%s.sqlite", from, schema.Version, time.Now().UTC().Format("20060102T150405.000000000")))
	if err = instancebackup.SnapshotSQLite(ctx, database, snapshot); err != nil {
		return fmt.Errorf("database schema %d needs an upgrade, but its recovery snapshot could not be created: %w", from, err)
	}
	if err = os.Chmod(snapshot, 0600); err != nil {
		return err
	}
	if err = schema.Migrate(ctx, database, false); err != nil {
		// Each migration and its version record share one transaction, so the
		// database stays at the last version that completed.
		reached, versionErr := dbmigration.Version(ctx, database, "sqlite")
		if versionErr != nil {
			return fmt.Errorf("database upgrade from schema %d failed (%w); the pre-upgrade snapshot is %s", from, err, snapshot)
		}
		return fmt.Errorf("database upgrade from schema %d stopped at schema %d (%w); the pre-upgrade snapshot is %s", from, reached, err, snapshot)
	}
	desktopLogPrintf("database upgraded from schema %d to %d; pre-upgrade snapshot: %s", from, schema.Version, snapshot)
	return nil
}
