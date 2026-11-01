package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/easyssh/server/internal/infra/config"
	dbinfra "github.com/easyssh/server/internal/infra/db"
	"github.com/easyssh/server/internal/storage/schema"
	"github.com/easyssh/shared/dbmigration"
	"github.com/easyssh/shared/instancebackup"
	"gorm.io/gorm"
)

func migrationFixture(t *testing.T) (*config.Config, *gorm.DB, *sql.DB) {
	t.Helper()
	root := t.TempDir()
	t.Setenv("EASYSSH_BACKUP_DIR", filepath.Join(root, "backups"))
	t.Setenv("EASYSSH_AUTO_MIGRATE", "on")
	t.Setenv("EASYSSH_MIGRATION_TIMEOUT", "5m")
	cfg := &config.Config{
		Server:   config.ServerConfig{EncryptionKey: base64.StdEncoding.EncodeToString(make([]byte, 32))},
		Database: config.DatabaseConfig{Driver: "sqlite", DSN: filepath.Join(root, "data", "easyssh.db"), MaxOpenConns: 1, MaxIdleConns: 1},
	}
	lock, err := instancebackup.Lock(maintenanceDataDir(cfg))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lock.Close() })
	database, err := dbinfra.NewDB(&cfg.Database)
	if err != nil {
		t.Fatal(err)
	}
	db, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	if err = schema.Initialize(ctx, db, "sqlite"); err != nil {
		t.Fatal(err)
	}
	for version := schema.Version; version > 5; version-- {
		if err = schema.Migrate(ctx, db, "sqlite", true); err != nil {
			t.Fatal(err)
		}
	}
	return cfg, database, db
}

func migrationRecord(t *testing.T, cfg *config.Config) (string, startupMigration) {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(maintenanceDataDir(cfg), ".easyssh-migration-*.json"))
	if err != nil || len(files) != 1 {
		t.Fatalf("migration journal: %v %v", files, err)
	}
	data, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	var state startupMigration
	if err = json.Unmarshal(data, &state); err != nil {
		t.Fatal(err)
	}
	return files[0], state
}

func TestStartupMigrationPreservesHistoricalForeignKeysAndReusesRecovery(t *testing.T) {
	cfg, database, db := migrationFixture(t)
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		"PRAGMA foreign_keys=OFF",
		"CREATE TABLE legacy_parents (id TEXT PRIMARY KEY)",
		"CREATE TABLE legacy_children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES legacy_parents(id))",
		"INSERT INTO legacy_children (rowid,id,parent_id) VALUES (8000,'kept','missing')",
		"PRAGMA foreign_keys=ON",
	} {
		if _, err = conn.ExecContext(ctx, statement); err != nil {
			conn.Close()
			t.Fatal(err)
		}
	}
	conn.Close()
	if err = startDatabase(cfg, database, nil, migrationOptions{}); err != nil {
		t.Fatal(err)
	}
	version, err := dbmigration.Version(ctx, db, "sqlite")
	if err != nil || version != schema.Version {
		t.Fatalf("version=%d err=%v", version, err)
	}
	journal, state := migrationRecord(t, cfg)
	if state.Phase != "complete" || len(state.ForeignKeys) != 1 || state.ArchiveHash == "" {
		t.Fatalf("incomplete recovery record: %+v", state)
	}
	var value string
	if err = db.QueryRow("SELECT parent_id FROM legacy_children WHERE id='kept'").Scan(&value); err != nil || value != "missing" {
		t.Fatalf("historical row changed: %q %v", value, err)
	}
	password, err := migrationPassword(cfg.Server.EncryptionKey)
	if err != nil {
		t.Fatal(err)
	}
	stage := t.TempDir()
	manifest, err := instancebackup.Unpack(ctx, state.Archive, stage, password)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.SchemaVersion != 5 || manifest.Profile != "server-migration" {
		t.Fatalf("wrong recovery source: %+v", manifest)
	}

	// Simulate a process exit after all SQL committed but before validation was
	// durably completed. Even a current-version DB must finish this validation.
	state.Phase, state.CompletedAt = "validating", nil
	if err = saveMigration(journal, &state); err != nil {
		t.Fatal(err)
	}
	if err = startDatabase(cfg, database, nil, migrationOptions{}); err != nil {
		t.Fatal(err)
	}
	if err = startDatabase(cfg, database, nil, migrationOptions{}); err != nil {
		t.Fatal(err)
	}
	archives, err := filepath.Glob(filepath.Join(os.Getenv("EASYSSH_BACKUP_DIR"), "migrations", "*.age"))
	if err != nil || len(archives) != 1 {
		t.Fatalf("repeated recovery archives: %v %v", archives, err)
	}

	// A damaged recovery point must not be ignored just because Goose is current.
	state.Phase = "validating"
	if err = saveMigration(journal, &state); err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(state.Archive, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, err = file.WriteString("corrupt")
	file.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err = startDatabase(cfg, database, nil, migrationOptions{}); err == nil {
		t.Fatal("accepted damaged recovery point for unfinished migration")
	}
}

func TestStartupMigrationDisabledDoesNotMutateOldSchema(t *testing.T) {
	cfg, database, db := migrationFixture(t)
	t.Setenv("EASYSSH_AUTO_MIGRATE", "off")
	if err := startDatabase(cfg, database, nil, migrationOptions{}); err == nil {
		t.Fatal("started against old schema with automatic migration disabled")
	}
	version, err := dbmigration.Version(context.Background(), db, "sqlite")
	if err != nil || version != 5 {
		t.Fatalf("unexpected schema mutation: %d %v", version, err)
	}
	files, err := filepath.Glob(filepath.Join(maintenanceDataDir(cfg), ".easyssh-migration-*.json"))
	if err != nil || len(files) != 0 {
		t.Fatalf("unexpected migration journal: %v %v", files, err)
	}
}

func TestStartupMigrationBackupFailurePreventsDDL(t *testing.T) {
	cfg, database, db := migrationFixture(t)
	blocked := filepath.Join(t.TempDir(), "file-not-directory")
	if err := os.WriteFile(blocked, []byte("occupied"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EASYSSH_BACKUP_DIR", blocked)
	if err := startDatabase(cfg, database, nil, migrationOptions{}); err == nil {
		t.Fatal("upgraded without usable recovery storage")
	}
	version, err := dbmigration.Version(context.Background(), db, "sqlite")
	if err != nil || version != 5 {
		t.Fatalf("DDL ran without backup: %d %v", version, err)
	}
}

func TestMigrationIntegrityComparesIdentitiesNotCounts(t *testing.T) {
	if err := compareMigrationIntegrity(map[string]int{"old": 1}, map[string]int{"different": 1}); err == nil {
		t.Fatal("equal counts concealed a new violation")
	}
	if err := compareMigrationIntegrity(map[string]int{"old": 2}, map[string]int{"old": 1}); err != nil {
		t.Fatal(err)
	}
}

func TestStartupMigrationRefusesEmptyReplacementWithExistingJournal(t *testing.T) {
	cfg, _, db := migrationFixture(t)
	identity, err := migrationIdentity(cfg)
	if err != nil {
		t.Fatal(err)
	}
	journal := filepath.Join(maintenanceDataDir(cfg), ".easyssh-migration-"+identity[:24]+".json")
	if err = saveMigration(journal, &startupMigration{Format: 1, Identity: identity, Driver: "sqlite", From: 5, To: schema.Version, Phase: "complete"}); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(cfg.Database.DSN, cfg.Database.DSN+".retained"); err != nil {
		t.Fatal(err)
	}
	replacement, err := dbinfra.NewDB(&cfg.Database)
	if err != nil {
		t.Fatal(err)
	}
	empty, err := replacement.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer empty.Close()
	if err = startDatabase(cfg, replacement, nil, migrationOptions{}); err == nil {
		t.Fatal("silently initialized an empty replacement for a recorded database")
	}
	tables, err := dbmigration.Tables(context.Background(), empty, "sqlite")
	if err != nil || len(tables) != 0 {
		t.Fatalf("replacement database was mutated: %v %v", tables, err)
	}
}
