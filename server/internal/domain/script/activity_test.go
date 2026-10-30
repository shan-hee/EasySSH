package script

import (
	"reflect"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"gorm.io/gorm"
)

func scriptActivityDB(t *testing.T) *gorm.DB {
	t.Helper()
	db := catalogDB(t)
	if err := db.AutoMigrate(&Script{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestScriptConfigurationRecordsChangesWithoutCopyingContent(t *testing.T) {
	db := scriptActivityDB(t)
	ctx := catalogContext(t)
	repo := NewRepository(db)
	row := &Script{Name: "before", Language: "bash", Content: "echo private-command-value", Tags: []string{"prod"}}
	if err := repo.Create(ctx, row); err != nil {
		t.Fatal(err)
	}
	if err := repo.Update(ctx, row.ID, row.Content, row.Language, map[string]interface{}{"content": row.Content, "language": row.Language, "tags": row.Tags}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Update(ctx, row.ID, row.Content, row.Language, map[string]interface{}{"content": row.Content, "language": row.Language, "name": "after"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, row.ID); err != nil {
		t.Fatal(err)
	}
	var facts []operationrecord.OperationRecord
	if err := db.Find(&facts).Error; err != nil || len(facts) != 3 {
		t.Fatalf("script changes miscounted: %d %v", len(facts), err)
	}
	for _, fact := range facts {
		if fact.Actor != access.Current(ctx).Actor() || fact.Status != operationrecord.StatusSuccess || strings.Contains(fact.DetailJSON, row.Content) {
			t.Fatalf("invalid script activity: %+v", fact)
		}
		if fact.Action == "script_delete" && fact.Resource != "after" {
			t.Fatal("script name not retained after deletion")
		}
	}
}

func TestScriptChangesRollBackWhenActivityWriteFails(t *testing.T) {
	for _, action := range []string{"create", "update", "delete"} {
		t.Run(action, func(t *testing.T) {
			db := scriptActivityDB(t)
			ctx := catalogContext(t)
			repo := NewRepository(db)
			row := &Script{Name: "before", Content: "echo before", Language: "bash", Tags: []string{"before"}}
			if err := repo.Create(ctx, row); err != nil {
				t.Fatal(err)
			}
			var before []Script
			if err := db.Unscoped().Order("id").Find(&before).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec(`CREATE TRIGGER reject_script_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
				t.Fatal(err)
			}
			var err error
			switch action {
			case "create":
				err = repo.Create(ctx, &Script{Name: "new", Content: "true", Language: "bash"})
			case "update":
				err = repo.Update(ctx, row.ID, row.Content, row.Language, map[string]interface{}{"content": "echo after", "language": "sh", "tags": []string{"after"}})
			case "delete":
				err = repo.Delete(ctx, row.ID)
			}
			if err == nil {
				t.Fatal("script mutation committed without activity")
			}
			var after []Script
			if err := db.Unscoped().Order("id").Find(&after).Error; err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("script content/version/tags/deletion did not roll back")
			}
		})
	}
}
