package datasync

import (
	"context"
	"testing"

	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

func TestInspectConfigurationWorksWithReadOnlyDatabase(t *testing.T) {
	s := newSyncTestService(t)
	ctx := context.Background()
	owner := uuid.New()
	for _, table := range []string{"servers", "scripts"} {
		if err := s.DB.Exec("CREATE TABLE " + table + " (id TEXT PRIMARY KEY, user_id TEXT, deleted_at DATETIME)").Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := s.DB.Exec("INSERT INTO servers(id,user_id) VALUES(?,?)", uuid.NewString(), owner).Error; err != nil {
		t.Fatal(err)
	}
	document, err := s.Engine.Run(ctx, EngineInput{Configuration: true, Current: syncdata.Snapshot{syncdata.ServerOrderKey: {"ids": "[]"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DB.Create(&State{UserID: owner, Document: Document(document.Document), Revision: 7}).Error; err != nil {
		t.Fatal(err)
	}
	raw, err := s.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	raw.SetMaxOpenConns(1)
	if err := s.DB.Exec("PRAGMA query_only=ON").Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		result, count, err := s.InspectConfiguration(ctx, owner)
		if err != nil || count != 1 || len(result.Conflicts) != 0 {
			t.Fatalf("read-only inspection: count=%d conflicts=%v error=%v", count, result.Conflicts, err)
		}
	}
	if _, count, err := s.InspectConfiguration(ctx, uuid.New()); err != nil || count != 0 {
		t.Fatalf("uninitialized account inspection: count=%d error=%v", count, err)
	}
	var state State
	if err := s.DB.First(&state, "user_id=?", owner).Error; err != nil {
		t.Fatal(err)
	}
	if state.Document != Document(document.Document) || state.Revision != 7 {
		t.Fatal("inspection changed persisted sync state")
	}
}
