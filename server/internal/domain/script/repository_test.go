package script

import (
	"context"
	"reflect"
	"testing"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestRepositoryUpdateSerializesTags(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := database.AutoMigrate(&Script{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}

	repository := NewRepository(database)
	script := &Script{
		Name: "before", Content: "echo before", Language: "bash",
		Tags: []string{"before"},
	}
	if err := repository.Create(catalogContext(t), script); err != nil {
		t.Fatalf("create script: %v", err)
	}

	wantTags := []string{"acceptance", "updated"}
	if err := repository.Update(catalogContext(t), script.ID, script.Content, script.Language, map[string]interface{}{
		"name":    "after",
		"tags":    wantTags,
		"content": script.Content, "language": script.Language,
	}); err != nil {
		t.Fatalf("update script: %v", err)
	}
	updated, err := repository.GetByID(context.Background(), script.ID)
	if err != nil {
		t.Fatalf("get updated script: %v", err)
	}
	if updated.Name != "after" {
		t.Fatalf("expected updated name, got %q", updated.Name)
	}
	if !reflect.DeepEqual(updated.Tags, wantTags) {
		t.Fatalf("expected tags %v, got %v", wantTags, updated.Tags)
	}
}
