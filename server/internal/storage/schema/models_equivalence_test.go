package schema_test

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/easyssh/server/internal/storage/schema"
	"github.com/easyssh/shared/dbmigration"
)

// This compares the structures actually created, not just GORM field tags.
// Type spellings are intentionally not compared. Defaults are also omitted:
// SQLite exposes SQL expressions, whose equivalence depends on evaluation and
// affinity (e.g. false vs 0); trimming quotes/parentheses is not sufficient.
func TestAutoMigrateMatchesInitializedSchema(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	scriptDB := newSchemaDatabase(t, ctx, "sqlite")
	if err := schema.Initialize(ctx, scriptDB, "sqlite"); err != nil {
		t.Fatalf("initialize scripts: %v", err)
	}
	modelDB, modelSQL := newSQLiteModelDatabase(t)
	if err := modelDB.WithContext(ctx).AutoMigrate(models...); err != nil {
		t.Fatalf("AutoMigrate models: %v", err)
	}
	scriptTables := applicationTables(t, ctx, scriptDB)
	modelTables := applicationTables(t, ctx, modelSQL)
	for _, table := range schemaFactNames(scriptTables, modelTables) {
		t.Run(table, func(t *testing.T) {
			if scriptTables[table] != modelTables[table] {
				t.Errorf("table %s exists: scripts=%t models=%t", table, scriptTables[table], modelTables[table])
				return
			}
			scriptColumns := sqliteColumnFacts(t, ctx, scriptDB, table)
			modelColumns := sqliteColumnFacts(t, ctx, modelSQL, table)
			for _, column := range schemaFactNames(scriptColumns, modelColumns) {
				script, scriptExists := scriptColumns[column]
				model, modelExists := modelColumns[column]
				if scriptExists != modelExists {
					t.Errorf("table %s column %s exists: scripts=%t models=%t", table, column, scriptExists, modelExists)
					continue
				}
				if script.notNull != model.notNull {
					t.Errorf("table %s column %s NOT NULL: scripts=%t models=%t", table, column, script.notNull, model.notNull)
				}
				if script.primaryKeyPosition != model.primaryKeyPosition {
					t.Errorf("table %s column %s primary key position (0 = not a key): scripts=%d models=%d", table, column, script.primaryKeyPosition, model.primaryKeyPosition)
				}
			}
			scriptIndexes := sqliteUniqueIndexes(t, ctx, scriptDB, table, "scripts")
			modelIndexes := sqliteUniqueIndexes(t, ctx, modelSQL, table, "models")
			for _, columns := range schemaFactNames(scriptIndexes, modelIndexes) {
				scriptNames, scriptExists := scriptIndexes[columns]
				modelNames, modelExists := modelIndexes[columns]
				if scriptExists != modelExists {
					t.Errorf("table %s unique index columns %s: scripts=%t (indexes=%v) models=%t (indexes=%v)", table, columns, scriptExists, scriptNames, modelExists, modelNames)
				}
			}
		})
	}
}

func applicationTables(t *testing.T, ctx context.Context, db *sql.DB) map[string]bool {
	t.Helper()
	tables, err := dbmigration.Tables(ctx, db, "sqlite")
	if err != nil {
		t.Fatal(err)
	}
	result := make(map[string]bool, len(tables))
	for _, table := range tables {
		// Goose owns migration bookkeeping; it is not an application model.
		// dbmigration.Tables already omits SQLite's internal sqlite_* tables.
		if table != "goose_db_version" {
			result[table] = true
		}
	}
	return result
}

type sqliteColumnFact struct {
	notNull            bool
	primaryKeyPosition int
}

func sqliteColumnFacts(t *testing.T, ctx context.Context, db *sql.DB, table string) map[string]sqliteColumnFact {
	t.Helper()
	rows, err := db.QueryContext(ctx, `SELECT name, "notnull", pk FROM pragma_table_info(?) ORDER BY cid`, table)
	if err != nil {
		t.Fatalf("table %s columns: %v", table, err)
	}
	defer rows.Close()
	columns := map[string]sqliteColumnFact{}
	for rows.Next() {
		var name string
		var notNull, pk int
		if err := rows.Scan(&name, &notNull, &pk); err != nil {
			t.Fatalf("table %s column: %v", table, err)
		}
		// Do not infer NOT NULL from PK membership: SQLite allows NULL in
		// non-integer primary keys on ordinary rowid tables.
		columns[name] = sqliteColumnFact{notNull: notNull != 0, primaryKeyPosition: pk}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("table %s columns: %v", table, err)
	}
	return columns
}

// Compare ordered column combinations, not index names: SQLite generates names
// for inline UNIQUE and primary-key constraints. Include those automatic indexes
// as well as explicit unique indexes. Names are retained for failure messages.
func sqliteUniqueIndexes(t *testing.T, ctx context.Context, db *sql.DB, table, side string) map[string][]string {
	t.Helper()
	rows, err := db.QueryContext(ctx, `SELECT name, partial FROM pragma_index_list(?) WHERE "unique" = 1 ORDER BY name`, table)
	if err != nil {
		t.Fatalf("%s table %s unique indexes: %v", side, table, err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		var partial int
		if err := rows.Scan(&name, &partial); err != nil {
			t.Fatalf("%s table %s index: %v", side, table, err)
		}
		if partial != 0 {
			// Never silently treat a partial index as an unconditional UNIQUE.
			t.Errorf("%s table %s index %s is partial; extend the structural comparison to include its predicate", side, table, name)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("%s table %s unique indexes: %v", side, table, err)
	}
	// Release the rows before querying each index, including with a one-connection pool.
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	indexes := map[string][]string{}
	for _, name := range names {
		columns := sqliteIndexColumns(t, ctx, db, table, name, side)
		key := fmt.Sprintf("%q", columns)
		indexes[key] = append(indexes[key], name)
	}
	return indexes
}

func sqliteIndexColumns(t *testing.T, ctx context.Context, db *sql.DB, table, index, side string) []string {
	t.Helper()
	rows, err := db.QueryContext(ctx, "SELECT name FROM pragma_index_info(?) ORDER BY seqno", index)
	if err != nil {
		t.Fatalf("%s table %s index %s columns: %v", side, table, index, err)
	}
	defer rows.Close()
	var columns []string
	for rows.Next() {
		var column sql.NullString
		if err := rows.Scan(&column); err != nil {
			t.Fatalf("%s table %s index %s column: %v", side, table, index, err)
		}
		if !column.Valid {
			t.Fatalf("%s table %s index %s has an expression/rowid key; extend the structural comparison to include it", side, table, index)
		}
		columns = append(columns, column.String)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("%s table %s index %s columns: %v", side, table, index, err)
	}
	return columns
}

// A sorted union reports missing and extra facts in a stable order.
func schemaFactNames[V any](left, right map[string]V) []string {
	names := make([]string, 0, len(left)+len(right))
	for name := range left {
		names = append(names, name)
	}
	for name := range right {
		if _, exists := left[name]; !exists {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	return names
}
