package schema_test

import (
	"context"
	"testing"
	"time"

	"github.com/easyssh/server/internal/storage/schema"
	"github.com/easyssh/shared/dbmigration"
	"github.com/pressly/goose/v3"
)

func TestMySQLOperationTableSettings(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db := newSchemaDatabase(t, ctx, "mysql")
	exec := func(query string) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	exec(`ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`)
	if err := schema.Start(ctx, db, "mysql"); err == nil {
		t.Fatal("accepted incompatible defaults for a new database")
	}
	if tables, err := dbmigration.Tables(ctx, db, "mysql"); err != nil || len(tables) != 0 {
		t.Fatalf("initialization should leave the empty database untouched: tables=%v err=%v", tables, err)
	}
	exec(`ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`)
	definition, err := schema.Definition("mysql")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectMySQL, db, definition.Files, goose.WithDisableGlobalRegistry(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 8); err != nil {
		t.Fatal(err)
	}
	exec(`ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`)
	exec(`ALTER TABLE operation_resources DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
		MODIFY name varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL`)
	exec(`ALTER TABLE activity_coverage ENGINE=MyISAM, CONVERT TO CHARACTER SET latin1`)
	exec(`INSERT INTO activity_coverage (id,started_at) VALUES ('café',CURRENT_TIMESTAMP)`)
	exec(`INSERT INTO operation_records (id,work_id,work_started_at,actor_kind,actor_id,actor_session_id,actor_grant_id,type,action,status,source_table,source_id)
		VALUES ('record','work',CURRENT_TIMESTAMP,'owner','actor','','','read','read','success','test','record')`)
	exec(`INSERT INTO operation_resources VALUES ('record','server','服务器')`)
	for _, missingFK := range []bool{false, true} {
		if missingFK {
			exec(`ALTER TABLE operation_resources DROP FOREIGN KEY operation_resources_ibfk_1`)
			exec(`ALTER TABLE operation_resources ENGINE=MyISAM, CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`)
		}
		if err := schema.CheckUpgradeSource(ctx, db, "mysql", 9); err == nil {
			t.Fatal("accepted non-normalized schema")
		}
		if _, err := provider.UpTo(ctx, 9); err != nil {
			t.Fatal(err)
		}
		if err := schema.CheckUpgradeSource(ctx, db, "mysql", 9); err != nil {
			t.Fatal(err)
		}
		var name, coverage string
		if err := db.QueryRowContext(ctx, `SELECT name FROM operation_resources WHERE record_id='record' AND server_id='server'`).Scan(&name); err != nil || name != "服务器" {
			t.Fatalf("resource name=%q error=%v", name, err)
		}
		if err := db.QueryRowContext(ctx, `SELECT id FROM activity_coverage`).Scan(&coverage); err != nil || coverage != "café" {
			t.Fatalf("coverage id=%q error=%v", coverage, err)
		}
		if _, err := provider.DownTo(ctx, 8); err != nil {
			t.Fatal(err)
		}
		if err := schema.CheckUpgradeSource(ctx, db, "mysql", 8); err != nil {
			t.Fatal(err)
		}
	}
}
