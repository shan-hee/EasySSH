package schema

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/easyssh/shared/dbmigration"
	_ "github.com/glebarez/go-sqlite"
	"github.com/pressly/goose/v3"
)

func TestRequireOperationRecordActorsPreservesDataAndDependencies(t *testing.T) {
	ctx := context.Background()
	open := func(name string) *sql.DB {
		t.Helper()
		db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), name))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = db.Close() })
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
		// Match production: foreign keys stay ON throughout both directions.
		if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys = ON"); err != nil {
			t.Fatal(err)
		}
		return db
	}
	db := open("upgrade-actors.db")
	definition, err := Definition("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, db, definition.Files, goose.WithDisableGlobalRegistry(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.UpTo(ctx, 7); err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"detail-content", "task-content"} {
		exec(`INSERT INTO content_objects (id, source_type, source_id, server_id, action, media_type)
			VALUES (?, 'test', 'source', 'server', 'read', 'application/json')`, id)
	}
	// Give every column a value so a rebuild that drops or changes any payload,
	// timestamp, counter or optional reference is observable. Exercise NULL,
	// non-NULL and mixed actors, plus both content foreign keys and inline JSON.
	columns := []string{
		"detail_content_id", "detail_content_size", "detail_content_sha256",
		"task_content_id", "task_content_size", "task_content_sha256",
		"work_id", "parent_work_id", "work_started_at", "attempt", "established_at", "connection_uncertain_until",
		"actor_kind", "actor_id", "actor_session_id", "actor_grant_id", "id", "username",
		"type", "category", "action", "status", "server_id", "server_name", "title", "resource", "source", "ip", "user_agent",
		"started_at", "finished_at", "duration_ms", "progress", "total_count", "success_count", "failure_count",
		"bytes_total", "bytes_processed", "bytes_completed", "speed_bps", "error_message", "detail_json",
		"source_table", "source_id", "created_at", "updated_at", "deleted_at",
	}
	for i := 0; i < 3; i++ {
		var detailID, taskID any
		var actor []any
		payload := `{"retained":true}`
		switch i {
		case 0:
			actor = []any{nil, nil, nil, nil}
		case 1:
			actor = []any{"visitor", "actor-id", "session-id", "grant-id"}
			detailID, payload = "detail-content", ""
		case 2:
			actor = []any{"owner", "owner-id", nil, nil}
			taskID, payload = "task-content", ""
		}
		id := fmt.Sprintf("record-%d", i)
		values := []any{
			detailID, 11 + i, "detail-sha", taskID, 22 + i, "task-sha",
			"work-" + id, "parent-work", "2026-01-02 03:04:05", 2 + i, "2026-01-02 03:05:06", "2026-01-02 03:06:07",
			actor[0], actor[1], actor[2], actor[3], id, "retained-user",
			"execution", "activity", "read", "success", "server-1", "服务器", "title-" + id, "resource", "source", "127.0.0.1", "test-agent",
			"2026-01-02 03:07:08", "2026-01-02 03:08:09", 1234 + i, 75, 4, 3, 1,
			9000 + i, 8000 + i, 7000 + i, 600 + i, "retained-message", payload,
			"migration-test", id, "2026-01-02 03:04:05", "2026-01-02 03:09:10", nil,
		}
		if i == 2 {
			values[len(values)-1] = "2026-01-03 03:04:05"
		}
		exec("INSERT INTO operation_records ("+strings.Join(columns, ",")+") VALUES ("+strings.TrimSuffix(strings.Repeat("?,", len(columns)), ",")+")", values...)
		for child := 0; child < 2; child++ {
			exec("INSERT INTO operation_resources (record_id, server_id, name) VALUES (?, ?, ?)", id, fmt.Sprintf("server-%d", child), fmt.Sprintf("endpoint-%d-%d", i, child))
		}
	}
	expectedColumns, expectedRows := operationMigrationRows(t, db, "operation_records", "id")
	if !reflect.DeepEqual(expectedColumns, columns) {
		t.Fatalf("fixture must cover every column in order: schema=%v fixture=%v", expectedColumns, columns)
	}
	childColumns, children := operationMigrationRows(t, db, "operation_resources", "record_id, server_id")
	_, contentRows := operationMigrationRows(t, db, "content_objects", "id")
	_, originalObjects := operationMigrationObjects(t, db)
	actorColumns := []string{"actor_kind", "actor_id", "actor_session_id", "actor_grant_id"}
	for _, row := range expectedRows {
		for column, name := range expectedColumns {
			if strings.HasPrefix(name, "actor_") && row[column] == nil {
				row[column] = ""
			}
		}
	}
	assertVersion := func(want int64) {
		t.Helper()
		version, err := dbmigration.Version(ctx, db, "sqlite")
		if err != nil || version != want {
			t.Fatalf("version=%d want=%d: %v", version, want, err)
		}
		if err := CheckUpgradeSource(ctx, db, "sqlite", want); err != nil {
			t.Fatal(err)
		}
	}
	assertData := func() {
		t.Helper()
		for _, table := range []struct {
			name, order string
			columns     []string
			rows        [][]any
		}{
			{"operation_records", "id", expectedColumns, expectedRows},
			{"operation_resources", "record_id, server_id", childColumns, children},
		} {
			gotColumns, got := operationMigrationRows(t, db, table.name, table.order)
			if !reflect.DeepEqual(gotColumns, table.columns) || len(got) != len(table.rows) {
				t.Fatalf("%s columns/row count changed: columns=%v rows=%d want columns=%v rows=%d", table.name, gotColumns, len(got), table.columns, len(table.rows))
			}
			for row := range got {
				for column, name := range gotColumns {
					if !reflect.DeepEqual(got[row][column], table.rows[row][column]) {
						t.Errorf("%s row %d column %s changed: got=%#v want=%#v", table.name, row, name, got[row][column], table.rows[row][column])
					}
				}
			}
		}
		_, gotContent := operationMigrationRows(t, db, "content_objects", "id")
		if !reflect.DeepEqual(gotContent, contentRows) {
			t.Error("referenced content_objects changed")
		}
		var foreignKeys, violations, references int
		if err := db.QueryRow("PRAGMA foreign_keys").Scan(&foreignKeys); err != nil || foreignKeys != 1 {
			t.Fatalf("foreign_keys=%d, want 1: %v", foreignKeys, err)
		}
		if err := db.QueryRow("SELECT count(*) FROM pragma_foreign_key_check").Scan(&violations); err != nil || violations != 0 {
			t.Fatalf("foreign key violations=%d: %v", violations, err)
		}
		if err := db.QueryRow(`SELECT count(*) FROM pragma_foreign_key_list('operation_resources') WHERE "table"='operation_records' AND "from"='record_id' AND "to"='id' AND on_delete='CASCADE'`).Scan(&references); err != nil || references != 1 {
			t.Fatalf("child foreign key no longer references operation_records(id) ON DELETE CASCADE: count=%d error=%v", references, err)
		}
	}
	assertNullability := func(notNull bool) {
		t.Helper()
		for _, column := range actorColumns {
			var actual bool
			if err := db.QueryRow(`SELECT "notnull" FROM pragma_table_info('operation_records') WHERE name=?`, column).Scan(&actual); err != nil || actual != notNull {
				t.Errorf("%s NOT NULL=%t want=%t: %v", column, actual, notNull, err)
			}
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			_, updateErr := tx.ExecContext(ctx, "UPDATE operation_records SET "+column+"=NULL WHERE id='record-1'")
			rollbackErr := tx.Rollback()
			if rollbackErr != nil {
				t.Fatal(rollbackErr)
			}
			if notNull {
				if updateErr == nil || !strings.Contains(updateErr.Error(), "NOT NULL constraint failed: operation_records."+column) {
					t.Errorf("%s must reject NULL with its NOT NULL constraint: %v", column, updateErr)
				}
			} else if updateErr != nil {
				t.Errorf("%s must accept NULL after Down: %v", column, updateErr)
			}
		}
	}
	assertVersion(7)
	if err := CheckUpgradeSource(ctx, db, "sqlite", 8); err == nil {
		t.Fatal("accepted schema 8 before actor constraints were installed")
	}
	if _, err := provider.UpTo(ctx, 8); err != nil {
		t.Fatal(err)
	}
	assertVersion(8)
	assertData()
	assertNullability(true)
	if err := CheckUpgradeSource(ctx, db, "sqlite", 7); err == nil {
		t.Fatal("accepted schema 7 with actor constraints installed")
	}
	fresh := open("fresh-actors.db")
	if err := Initialize(ctx, fresh, "sqlite"); err != nil {
		t.Fatal(err)
	}
	_, upgradedObjects := operationMigrationObjects(t, db)
	_, freshObjects := operationMigrationObjects(t, fresh)
	if !reflect.DeepEqual(upgradedObjects, freshObjects) {
		t.Errorf("upgraded table/index/trigger definitions differ from fresh installation: got=%v want=%v", upgradedObjects, freshObjects)
	}
	// Compare against schema 7 as well: both installation paths run 00008,
	// so comparing only those paths could conceal the same lost constraint or
	// index in both. Only these four NOT NULL clauses may change the DDL.
	expectedObjects := make([][]any, len(originalObjects))
	for i, object := range originalObjects {
		expectedObjects[i] = append([]any(nil), object...)
		if object[0] == "table" && object[1] == "operation_records" {
			ddl := object[3].(string)
			for _, column := range actorColumns {
				before := `"` + column + `" TEXT,`
				if strings.Count(ddl, before) != 1 {
					t.Fatalf("unexpected schema 7 definition for %s: %s", column, ddl)
				}
				ddl = strings.Replace(ddl, before, `"`+column+`" TEXT NOT NULL,`, 1)
			}
			expectedObjects[i][3] = ddl
		}
	}
	if !reflect.DeepEqual(upgradedObjects, expectedObjects) {
		t.Errorf("Up changed DDL beyond the four NOT NULL clauses: got=%v want=%v", upgradedObjects, expectedObjects)
	}
	if _, err := provider.DownTo(ctx, 7); err != nil {
		t.Fatal(err)
	}
	assertVersion(7)
	assertData()
	assertNullability(false)
	_, rolledBackObjects := operationMigrationObjects(t, db)
	if !reflect.DeepEqual(rolledBackObjects, originalObjects) {
		t.Errorf("Down did not restore original table/index/trigger definitions: got=%v want=%v", rolledBackObjects, originalObjects)
	}
}

func operationMigrationRows(t *testing.T, db *sql.DB, table, order string) ([]string, [][]any) {
	t.Helper()
	return operationMigrationQuery(t, db, "SELECT * FROM "+table+" ORDER BY "+order)
}

func operationMigrationObjects(t *testing.T, db *sql.DB) ([]string, [][]any) {
	t.Helper()
	return operationMigrationQuery(t, db, `SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE tbl_name IN ('operation_records', 'operation_resources') ORDER BY type, name`)
}

func operationMigrationQuery(t *testing.T, db *sql.DB, query string) ([]string, [][]any) {
	t.Helper()
	rows, err := db.Query(query)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		t.Fatal(err)
	}
	var result [][]any
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			t.Fatal(err)
		}
		for i, value := range values {
			if bytes, ok := value.([]byte); ok {
				values[i] = string(bytes)
			}
		}
		result = append(result, values)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return columns, result
}

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
