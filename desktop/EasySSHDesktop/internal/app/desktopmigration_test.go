package app

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/easyssh/easyssh-desktop/internal/storage/schema"
	"github.com/easyssh/shared/dbmigration"
)

func TestStartupUpgradesAnOlderDatabaseAfterSnapshottingIt(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	backups := filepath.Join(directory, "backups")
	t.Setenv("EASYSSH_DESKTOP_BACKUP_DIR", backups)
	db, err := sql.Open("sqlite", filepath.Join(directory, "desktop.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(1)
	// Build a schema 1 database the way an older release left it.
	if err = schema.Initialize(ctx, db, "sqlite"); err != nil {
		t.Fatal(err)
	}
	for version := schema.Version; version > schema.BaselineVersion; version-- {
		if err = schema.Migrate(ctx, db, true); err != nil {
			t.Fatal(err)
		}
	}
	if version, err := dbmigration.Version(ctx, db, "sqlite"); err != nil || version != schema.BaselineVersion {
		t.Fatalf("setup: schema %d %v", version, err)
	}
	for _, statement := range []string{
		`INSERT INTO desktop_sync_spaces(id,instance_id,user_id,account_name,server_url,document,remote_heads) VALUES('space','instance','user','owner','https://sync.test','old document','["head"]')`,
		`INSERT INTO desktop_sync_records(kind,local_id,space_id,remote_id) VALUES('script','local','space','remote')`,
	} {
		if _, err = db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}

	if err = configureDesktopDatabase(db); err != nil {
		t.Fatal("startup did not upgrade the database:", err)
	}
	if version, err := dbmigration.Version(ctx, db, "sqlite"); err != nil || version != schema.Version {
		t.Fatalf("schema %d after startup: %v", version, err)
	}
	var document string
	var enrolled int
	if err = db.QueryRow(`SELECT document FROM desktop_sync_spaces WHERE id='space'`).Scan(&document); err != nil || document != "" {
		t.Fatalf("sync document not reset: %q %v", document, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM desktop_sync_records WHERE space_id='space'`).Scan(&enrolled); err != nil || enrolled != 1 {
		t.Fatalf("enrollment lost: %d %v", enrolled, err)
	}
	if _, err = db.Exec(`SELECT remote_heads FROM desktop_sync_spaces`); err == nil {
		t.Fatal("retired column still present")
	}

	snapshots, err := filepath.Glob(filepath.Join(backups, "migrations", "schema-1-to-*.sqlite"))
	if err != nil || len(snapshots) != 1 {
		t.Fatalf("pre-upgrade snapshots: %v %v", snapshots, err)
	}
	snapshot, err := sql.Open("sqlite", snapshots[0])
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	var heads string
	if err = snapshot.QueryRow(`SELECT document,remote_heads FROM desktop_sync_spaces WHERE id='space'`).Scan(&document, &heads); err != nil || document != "old document" || heads != `["head"]` {
		t.Fatalf("snapshot does not hold the pre-upgrade data: %q %q %v", document, heads, err)
	}
	if version, err := dbmigration.Version(ctx, snapshot, "sqlite"); err != nil || version != schema.BaselineVersion {
		t.Fatalf("snapshot schema %d: %v", version, err)
	}

	// A database already at the current schema is opened without another snapshot.
	if err = configureDesktopDatabase(db); err != nil {
		t.Fatal(err)
	}
	if again, _ := filepath.Glob(filepath.Join(backups, "migrations", "*.sqlite")); len(again) != 1 {
		t.Fatalf("an up-to-date database was snapshotted again: %v", again)
	}
}
