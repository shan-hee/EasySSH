package schema

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "github.com/glebarez/go-sqlite"
	"github.com/pressly/goose/v3"
)

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
	if err = Migrate(ctx, db, "sqlite", false); err != nil {
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
