package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"

	"github.com/easyssh/server/internal/infra/config"
)

func migrationSpacePreflight(ctx context.Context, db *sql.DB, cfg *config.Config, directory string) error {
	var size int64
	switch cfg.Database.Driver {
	case "sqlite":
		var pages, pageSize int64
		if err := db.QueryRowContext(ctx, "PRAGMA page_count").Scan(&pages); err != nil {
			return err
		}
		if err := db.QueryRowContext(ctx, "PRAGMA page_size").Scan(&pageSize); err != nil {
			return err
		}
		size = pages * pageSize
	case "postgres":
		if err := db.QueryRowContext(ctx, "SELECT pg_database_size(current_database())").Scan(&size); err != nil {
			return err
		}
	case "mysql":
		if err := db.QueryRowContext(ctx, "SELECT COALESCE(SUM(data_length+index_length),0) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&size); err != nil {
			return err
		}
	}
	// Snapshot, archive, and verification extraction coexist. Logical dumps can
	// exceed physical database size; native write failures still block migration.
	if size < 0 || size > (1<<60) {
		return errors.New("invalid database size estimate")
	}
	if err := requireMigrationSpace(directory, uint64(size)*4+(64<<20)); err != nil {
		return err
	}
	if cfg.Database.Driver == "sqlite" {
		return requireMigrationSpace(filepath.Dir(sqliteDatabasePath(cfg.Database.DSN)), uint64(size)*2+(64<<20))
	}
	return nil
}

func requireMigrationSpace(directory string, required uint64) error {
	available, err := migrationAvailableBytes(directory)
	if err != nil {
		return err
	}
	if available < required {
		return fmt.Errorf("insufficient migration disk space in %s: need approximately %d bytes, available %d", directory, required, available)
	}
	return nil
}

func migrationDDLPreflight(ctx context.Context, db *sql.DB, driver, id string) (result error) {
	if driver == "postgres" {
		var allowed bool
		err := db.QueryRowContext(ctx, "SELECT has_schema_privilege(current_user,'public','CREATE') AND pg_has_role(c.relowner,'USAGE') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='grants'").Scan(&allowed)
		if err != nil {
			return err
		}
		if !allowed {
			return errors.New("PostgreSQL migration requires CREATE on public and ownership privileges on grants")
		}
		return nil
	}
	if driver != "mysql" {
		return nil
	}
	// Exercise actual grants, including active roles, rather than guessing from
	// SHOW GRANTS. Only reserved scratch objects are touched, after the recovery
	// point has been verified. Their deterministic names allow crash cleanup.
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	name := "`__easyssh_migration_probe_" + id + "`"
	cleanup := func(ctx context.Context) error {
		_, routineErr := conn.ExecContext(ctx, "DROP PROCEDURE IF EXISTS "+name)
		_, tableErr := conn.ExecContext(ctx, "DROP TABLE IF EXISTS "+name)
		return errors.Join(routineErr, tableErr)
	}
	if err = cleanup(ctx); err != nil {
		return err
	}
	defer func() {
		// A cancelled context leaves only reserved scratch objects; the next
		// preflight cleans them before touching application schema.
		result = errors.Join(result, cleanup(ctx))
	}()
	for _, statement := range []string{
		"CREATE TABLE " + name + " (id integer PRIMARY KEY) ENGINE=InnoDB",
		"ALTER TABLE " + name + " ADD COLUMN value integer NOT NULL DEFAULT 0",
		"CREATE INDEX probe_value ON " + name + " (value)",
		"INSERT INTO " + name + " (id) VALUES (1)",
		"UPDATE " + name + " SET value=1 WHERE id=1",
		"DELETE FROM " + name + " WHERE id=1",
		"CREATE PROCEDURE " + name + "() SQL SECURITY INVOKER SELECT 1",
		"CALL " + name + "()",
	} {
		if _, err = conn.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}
