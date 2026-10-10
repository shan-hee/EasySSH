package instancebackup

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

func SnapshotSQLite(ctx context.Context, database *sql.DB, dest string) error {
	// SQLite's VACUUM INTO creates a transactionally consistent standalone database,
	// including WAL contents. The destination must not already exist.
	if _, err := database.ExecContext(ctx, "VACUUM INTO '"+strings.ReplaceAll(dest, "'", "''")+"'"); err != nil {
		return fmt.Errorf("native SQLite snapshot: %w", err)
	}
	return nil
}
func CheckSQLite(ctx context.Context, database *sql.DB) error {
	var result string
	if err := database.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&result); err != nil {
		return err
	}
	if result != "ok" {
		return errors.New("SQLite integrity check failed")
	}
	rows, err := database.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return errors.New("SQLite foreign key check failed")
	}
	return rows.Err()
}
