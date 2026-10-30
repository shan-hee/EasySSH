package auth

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestOwnerExecutionHasNoLoginSessionOrPerCheckQueries(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	if err := db.AutoMigrate(&Owner{}, &Session{}); err != nil {
		t.Fatal(err)
	}
	owner := Owner{ID: uuid.New(), Slot: 1, Username: "fixture", Email: "owner@example.test", Password: "not-used"}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	runtime := access.NewRuntime()
	t.Cleanup(runtime.Close)
	service := &Service{db: db, runtime: runtime}
	scope, err := service.OwnerExecutionScope(context.Background(), owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !scope.Actor().Valid() || scope.Actor().SessionID != "" || scope.Actor().ID != owner.ID.String() {
		t.Fatalf("unexpected execution identity: %+v", scope.Actor())
	}
	var sessions int64
	if err := db.Model(&Session{}).Count(&sessions).Error; err != nil || sessions != 0 {
		t.Fatalf("minted a login session: %d %v", sessions, err)
	}
	var reads atomic.Int64
	if err := db.Callback().Query().Before("gorm:query").Register("execution_query_counter", func(*gorm.DB) { reads.Add(1) }); err != nil {
		t.Fatal(err)
	}
	requirement := access.Requirement{Action: protocol.TerminalConnect, ServerID: uuid.NewString()}
	for range 100 {
		if err := scope.Check(context.Background(), requirement); err != nil {
			t.Fatal(err)
		}
	}
	lease, err := scope.OpenWork(context.Background(), access.Task, requirement)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close(nil)
	if reads.Load() != 0 {
		t.Fatalf("owner execution checks query database: %d", reads.Load())
	}
	if _, err := service.Restore(context.Background(), scope.Actor()); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("execution identity accepted as login: %v", err)
	}
	if err := scope.RequireOwner(context.Background(), protocol.OwnerManage); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("execution scope can manage owner: %v", err)
	}
	runtime.InvalidateOwner(owner.ID.String(), access.ErrRevoked)
	select {
	case <-lease.Context().Done():
	case <-time.After(time.Second):
		t.Fatal("owner invalidation did not cancel execution lease")
	}
	if _, err := service.OwnerExecutionScope(context.Background(), uuid.New()); err == nil {
		t.Fatal("unknown owner accepted")
	}
}
