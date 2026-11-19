package schema_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/infra/config"
	infradb "github.com/easyssh/server/internal/infra/db"
	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/gorm"
)

func newSQLiteModelDatabase(t *testing.T) (*gorm.DB, *sql.DB) {
	t.Helper()
	// Use the production dialector, configuration and default naming strategy.
	db, err := infradb.NewDB(&config.DatabaseConfig{
		Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "schema.db"),
		MaxOpenConns: 1, MaxIdleConns: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	closeSchemaDatabase(t, sqlDB)
	return db, sqlDB
}

func closeSchemaDatabase(t *testing.T, db *sql.DB) {
	t.Helper()
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Errorf("close test database connection: %v", err)
		}
	})
}

// External DSNs supply connection credentials, not a database to overwrite.
// The account must be able to CREATE/DROP DATABASE. Only a database successfully
// created by this invocation is eligible for cleanup; name collisions fail.
func newSchemaDatabase(t *testing.T, ctx context.Context, driver string) *sql.DB {
	t.Helper()
	if driver == "sqlite" {
		_, db := newSQLiteModelDatabase(t)
		return db
	}
	env := "EASYSSH_TEST_" + strings.ToUpper(driver) + "_DSN"
	dsn := os.Getenv(env)
	if dsn == "" {
		t.Skipf("%s is not set", env)
	}
	cfg := &config.DatabaseConfig{Driver: driver, DSN: dsn}
	dsn, err := cfg.DialectorDSN()
	if err != nil {
		t.Fatalf("normalize %s: %v", env, err)
	}
	name := "easyssh_schema_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	var admin *sql.DB
	var openTestDatabase func() (*sql.DB, error)
	var create, drop string
	switch driver {
	case "postgres":
		// pgx is the driver used by GORM's postgres dialector; ParseConfig
		// accepts both URL and keyword/value DSNs, including TLS options.
		pgcfg, err := pgx.ParseConfig(dsn)
		if err != nil {
			t.Fatalf("parse %s: %v", env, err)
		}
		admin = stdlib.OpenDB(*pgcfg)
		testcfg := pgcfg.Copy()
		testcfg.Database = name
		// dbmigration.Tables and the application's scripts use public.
		testcfg.RuntimeParams["search_path"] = "public"
		openTestDatabase = func() (*sql.DB, error) { return stdlib.OpenDB(*testcfg), nil }
		// template0 avoids inheriting application objects from template1.
		create = `CREATE DATABASE "` + name + `" TEMPLATE template0`
		drop = `DROP DATABASE "` + name + `"`
	case "mysql":
		mycfg, err := mysqldriver.ParseDSN(dsn)
		if err != nil {
			t.Fatalf("parse %s: %v", env, err)
		}
		connector, err := mysqldriver.NewConnector(mycfg)
		if err != nil {
			t.Fatal(err)
		}
		admin = sql.OpenDB(connector)
		testcfg := mycfg.Clone()
		testcfg.DBName = name
		openTestDatabase = func() (*sql.DB, error) {
			connector, err := mysqldriver.NewConnector(testcfg)
			if err != nil {
				return nil, err
			}
			return sql.OpenDB(connector), nil
		}
		create = "CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
		drop = "DROP DATABASE `" + name + "`"
	default:
		t.Fatalf("unsupported test dialect %q", driver)
	}
	closeSchemaDatabase(t, admin)
	if _, err := admin.ExecContext(ctx, create); err != nil {
		t.Fatalf("create isolated %s database %s (requires CREATE DATABASE permission): %v", driver, name, err)
	}
	t.Logf("created isolated %s database %s", driver, name)
	// Cleanup runs in reverse registration order: close test connections,
	// drop only our database, then close the administration connection.
	// Use a new context so failed/timed-out initialization still gets cleanup.
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if _, err := admin.ExecContext(cleanupCtx, drop); err != nil {
			t.Errorf("drop isolated %s database %s: %v", driver, name, err)
		}
	})
	db, err := openTestDatabase()
	if err != nil {
		t.Fatal(err)
	}
	closeSchemaDatabase(t, db)
	if err := db.PingContext(ctx); err != nil {
		t.Fatalf("connect to isolated %s database %s: %v", driver, name, err)
	}
	return db
}

func schemaColumnNames(t *testing.T, ctx context.Context, db *sql.DB, driver, table string) []string {
	t.Helper()
	var query string
	switch driver {
	case "sqlite":
		query = "SELECT name FROM pragma_table_info(?) ORDER BY cid"
	case "postgres":
		query = "SELECT column_name FROM information_schema.columns WHERE table_catalog = current_database() AND table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position"
	case "mysql":
		query = "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position"
	default:
		t.Fatalf("unsupported test dialect %q", driver)
	}
	rows, err := db.QueryContext(ctx, query, table)
	if err != nil {
		t.Fatalf("%s table %s columns: %v", driver, table, err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("%s table %s column: %v", driver, table, err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("%s table %s columns: %v", driver, table, err)
	}
	return names
}
