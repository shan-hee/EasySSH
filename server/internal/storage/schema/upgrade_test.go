package schema

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/easyssh/shared/dbmigration"
	_ "github.com/glebarez/go-sqlite"
	"github.com/pressly/goose/v3"
)

func TestVersionDoesNotHideHigherMigrationHistory(t *testing.T) {
	for _, item := range []struct {
		name string
		rows [][2]int
		want int64
	}{
		{"empty history", nil, 0},
		{"current baseline", [][2]int{{0, 1}, {1, 1}}, 1},
		{"late baseline after legacy versions", [][2]int{{0, 1}, {5, 1}, {6, 1}, {7, 1}, {8, 1}, {9, 1}, {10, 1}, {1, 1}}, 10},
		{"out of order upgrade", [][2]int{{0, 1}, {1, 1}, {4, 1}, {2, 1}, {3, 1}}, 4},
		{"rolled back version", [][2]int{{0, 1}, {1, 1}, {2, 1}, {2, 0}}, 1},
	} {
		t.Run(item.name, func(t *testing.T) {
			db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "versions.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if _, err = db.Exec("CREATE TABLE goose_db_version (id INTEGER PRIMARY KEY, version_id INTEGER NOT NULL, is_applied INTEGER NOT NULL)"); err != nil {
				t.Fatal(err)
			}
			for _, row := range item.rows {
				if _, err = db.Exec("INSERT INTO goose_db_version (version_id,is_applied) VALUES (?,?)", row[0], row[1]); err != nil {
					t.Fatal(err)
				}
			}
			version, err := dbmigration.Version(context.Background(), db, "sqlite")
			if err != nil || version != item.want {
				t.Fatalf("version = %d, want %d: %v", version, item.want, err)
			}
		})
	}
}

func TestRemoveCSRFOriginsPreservesOtherSettings(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "migration.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	definition, err := Definition("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, db, definition.Files, goose.WithDisableGlobalRegistry(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = provider.UpTo(ctx, BaselineVersion); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO security_config (id,csrf_trusted_origins,login_limit) VALUES (1,?,9)", "https://old.example"); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", BaselineVersion); err != nil {
		t.Fatal(err)
	}
	if _, err = provider.UpTo(ctx, 2); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 2); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", BaselineVersion); err == nil {
		t.Fatal("accepted a baseline marker after its column was removed")
	}
	var loginLimit int
	if err = db.QueryRowContext(ctx, "SELECT login_limit FROM security_config WHERE id=1").Scan(&loginLimit); err != nil || loginLimit != 9 {
		t.Fatalf("unrelated setting changed: %d %v", loginLimit, err)
	}
	if err = Migrate(ctx, db, "sqlite", true); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", BaselineVersion); err != nil {
		t.Fatal(err)
	}
	var oldOrigins sql.NullString
	if err = db.QueryRowContext(ctx, "SELECT csrf_trusted_origins,login_limit FROM security_config WHERE id=1").Scan(&oldOrigins, &loginLimit); err != nil || oldOrigins.Valid || loginLimit != 9 {
		t.Fatalf("rollback must restore an empty column and retain other settings: %+v %d %v", oldOrigins, loginLimit, err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 2); err == nil {
		t.Fatal("accepted a schema 2 marker with the obsolete column present")
	}
}

func TestRemovePublicURLPreservesOtherSettings(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "public-url.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	definition, err := Definition("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, db, definition.Files, goose.WithDisableGlobalRegistry(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = provider.UpTo(ctx, 2); err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(ctx, "INSERT INTO system_config (id,public_url,system_name) VALUES (1,?,?)", "https://old.example", "My instance"); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 2); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 3); err == nil {
		t.Fatal("accepted schema 3 with the obsolete public_url column")
	}
	if _, err = provider.UpTo(ctx, 3); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 3); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 2); err == nil {
		t.Fatal("accepted schema 2 without public_url")
	}
	var name string
	if err = db.QueryRowContext(ctx, "SELECT system_name FROM system_config WHERE id=1").Scan(&name); err != nil || name != "My instance" {
		t.Fatalf("unrelated setting changed: %q %v", name, err)
	}
	if _, err = provider.DownTo(ctx, 2); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 2); err != nil {
		t.Fatal(err)
	}
	var oldURL sql.NullString
	if err = db.QueryRowContext(ctx, "SELECT public_url,system_name FROM system_config WHERE id=1").Scan(&oldURL, &name); err != nil || oldURL.Valid || name != "My instance" {
		t.Fatalf("rollback must restore an empty column and retain other settings: %+v %q %v", oldURL, name, err)
	}
}

func TestAutomationTokenCipherColumnFollowsVersion(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "token-cipher.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	definition, err := Definition("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, db, definition.Files, goose.WithDisableGlobalRegistry(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = provider.UpTo(ctx, 3); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 4); err == nil {
		t.Fatal("accepted schema 4 without token_cipher")
	}
	if _, err = provider.UpTo(ctx, 4); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 4); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 3); err == nil {
		t.Fatal("accepted schema 3 with token_cipher present")
	}
	if _, err = provider.DownTo(ctx, 3); err != nil {
		t.Fatal(err)
	}
	if err = CheckUpgradeSource(ctx, db, "sqlite", 3); err != nil {
		t.Fatal(err)
	}
}
