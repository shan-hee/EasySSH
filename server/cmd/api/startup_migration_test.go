package main

import (
	"context"
	"database/sql"
	"encoding/base64"
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
	return cfg, database, db
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
	if err = saveMigration(journal, &startupMigration{Format: 1, Identity: identity, Driver: "sqlite", From: schema.BaselineVersion, To: schema.Version, Phase: "complete"}); err != nil {
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
