package app

import (
	"context"
	"database/sql"
	"sync"

	"github.com/easyssh/easyssh-desktop/internal/storage/schema"
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
	return schema.Start(context.Background(), database, "sqlite")
}
