package script

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/scriptutil"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func catalogDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	return db
}

func TestCatalogReadsOnlyMetadataAndPagesApprovedVersions(t *testing.T) {
	db := catalogDB(t)
	// Deliberately no source column: this query must not depend on loading code.
	for _, ddl := range []string{
		`CREATE TABLE scripts (id TEXT PRIMARY KEY, name TEXT, description TEXT, language TEXT, version TEXT)`,
		`CREATE TABLE grant_script_scopes (grant_id TEXT, server_id TEXT, script_id TEXT, version TEXT)`,
	} {
		if err := db.Exec(ddl).Error; err != nil {
			t.Fatal(err)
		}
	}
	version := scriptutil.Version("bash", "true")
	ids := []string{"00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"}
	for _, id := range ids {
		if err := db.Exec(`INSERT INTO scripts(id,name,description,language,version) VALUES(?,?,?,?,?)`, id, "same name", "", "bash", version).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Exec(`INSERT INTO grant_script_scopes(grant_id,server_id,script_id,version) VALUES(?,?,?,?)`, "grant", "server", id, version).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`UPDATE grant_script_scopes SET version=? WHERE script_id=?`, strings.Repeat("0", 64), ids[1]).Error; err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db)
	rows, more, err := repo.Available(context.Background(), "grant", "server", protocol.ScriptCatalogInput{Limit: 1})
	if err != nil || len(rows) != 1 || rows[0].ID.String() != ids[0] || !more {
		t.Fatalf("first page: %+v %v %v", rows, more, err)
	}
	rows, more, err = repo.Available(context.Background(), "grant", "server", protocol.ScriptCatalogInput{Limit: 1, AfterID: ids[0]})
	if err != nil || len(rows) != 1 || rows[0].ID.String() != ids[2] || more {
		t.Fatalf("next page: %+v %v %v", rows, more, err)
	}
	rows, _, err = repo.Available(context.Background(), "other-grant", "server", protocol.ScriptCatalogInput{Limit: 20})
	if err != nil || len(rows) != 0 {
		t.Fatalf("foreign grant: %+v %v", rows, err)
	}
}

func TestScriptVersionIsPersistedForCreateUpdateAndSyncSave(t *testing.T) {
	db := catalogDB(t)
	if err := db.AutoMigrate(&Script{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db)
	row := &Script{Name: "script", Content: "echo first"}
	if err := repo.Create(catalogContext(t), row); err != nil {
		t.Fatal(err)
	}
	check := func(language, content string) {
		t.Helper()
		var stored struct{ Version string }
		if err := db.Table("scripts").Select("version").Where("id = ?", row.ID).First(&stored).Error; err != nil {
			t.Fatal(err)
		}
		if stored.Version != scriptutil.Version(language, content) {
			t.Fatalf("stale persisted version: %s", stored.Version)
		}
	}
	check("bash", "echo first")
	if err := repo.Update(catalogContext(t), row.ID, "echo first", "bash", map[string]interface{}{"content": "echo second", "language": "sh"}); err != nil {
		t.Fatal(err)
	}
	check("sh", "echo second")
	row.Language, row.Content = "python", "print('sync')"
	if err := db.Save(row).Error; err != nil {
		t.Fatal(err)
	}
	check("python", "print('sync')")
	if err := repo.Update(catalogContext(t), row.ID, "echo first", "bash", map[string]interface{}{"content": "unexpected", "language": "sh"}); !errors.Is(err, access.ErrResourceChanged) {
		t.Fatalf("concurrent edit accepted: %v", err)
	}
	check("python", "print('sync')")
}

type catalogAuthority struct {
	testutil.AccessPolicy
}

func (catalogAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}

type catalogPolicy struct {
	denied map[string]bool
	rules  map[string]protocol.GrantParameterRule
}

func (p catalogPolicy) ScriptParameters(ctx context.Context, scope access.Scope, req access.Requirement) (map[string]protocol.GrantParameterRule, error) {
	if p.denied[req.ScriptID] {
		return nil, access.ErrResourceChanged
	}
	return p.rules, scope.Check(ctx, req)
}
func (p catalogPolicy) CheckScript(context.Context, access.Scope, access.Requirement, map[string]string) error {
	return nil
}

type catalogRows struct {
	Repository
	rows []CatalogEntry
}

func (r catalogRows) Available(_ context.Context, _, _ string, input protocol.ScriptCatalogInput) ([]CatalogEntry, bool, error) {
	var rows []CatalogEntry
	for _, row := range r.rows {
		if row.ID.String() > input.AfterID {
			rows = append(rows, row)
		}
	}
	more := len(rows) > input.Limit
	if more {
		rows = rows[:input.Limit]
	}
	return rows, more, nil
}
func catalogContext(t *testing.T) context.Context {
	t.Helper()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}, time.Now().Add(time.Hour), catalogAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}

func TestCatalogByteBudgetDoesNotConsumeTheNextItem(t *testing.T) {
	var entries []CatalogEntry
	for i := 1; i <= 100; i++ {
		id := uuid.MustParse(fmt.Sprintf("00000000-0000-4000-8000-%012d", i))
		entries = append(entries, CatalogEntry{ID: id, Name: "script", Language: "bash", Version: scriptutil.Version("bash", "true"), Description: strings.Repeat("<", 16384)})
	}
	s := NewService(catalogRows{rows: entries}, catalogPolicy{}, nil)
	ctx := catalogContext(t)
	serverID := uuid.NewString()
	first, err := s.Available(ctx, serverID, protocol.ScriptCatalogInput{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(first)
	if len(first.Items) == 0 || len(first.Items) >= 100 || len(encoded) > scriptutil.MaxCatalogBytes || !first.HasMore {
		t.Fatalf("unbounded page: %d %d %v", len(first.Items), len(encoded), first.HasMore)
	}
	second, err := s.Available(ctx, serverID, protocol.ScriptCatalogInput{Limit: 100, AfterID: first.NextAfterID})
	if err != nil || len(second.Items) == 0 || second.Items[0].ID != entries[len(first.Items)].ID {
		t.Fatalf("boundary row lost: %+v %v", second, err)
	}
}

func TestCatalogDeniedPageAdvancesCursorWithoutExposingRows(t *testing.T) {
	first, second := uuid.MustParse("00000000-0000-4000-8000-000000000001"), uuid.MustParse("00000000-0000-4000-8000-000000000002")
	s := NewService(catalogRows{rows: []CatalogEntry{{ID: first}, {ID: second}}}, catalogPolicy{denied: map[string]bool{first.String(): true}}, nil)
	page, err := s.Available(catalogContext(t), uuid.NewString(), protocol.ScriptCatalogInput{Limit: 1})
	if err != nil || len(page.Items) != 0 || !page.HasMore || page.NextAfterID != first.String() {
		t.Fatalf("filtered page: %+v %v", page, err)
	}
}
