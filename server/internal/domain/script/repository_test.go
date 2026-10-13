package script

import (
	"reflect"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestRepositoryUpdateSerializesTags(t *testing.T) {
	database, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := database.AutoMigrate(&Script{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}

	repository := NewRepository(database)
	script := &Script{
		UserID: uuid.New(), Name: "before", Content: "echo before", Language: "bash",
		Tags: []string{"before"},
	}
	if err := repository.Create(script); err != nil {
		t.Fatalf("create script: %v", err)
	}

	wantTags := []string{"acceptance", "updated"}
	if err := repository.Update(script.ID, map[string]interface{}{
		"name": "after",
		"tags": wantTags,
	}); err != nil {
		t.Fatalf("update script: %v", err)
	}
	updated, err := repository.GetByID(script.ID)
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
