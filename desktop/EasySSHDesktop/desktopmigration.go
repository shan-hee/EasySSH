package main

import (
	"context"
	"database/sql"
	"sync"

	"github.com/easyssh/shared/dbmigration"
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
	return dbmigration.Start(context.Background(), database, "desktop", "sqlite")
}
