package auth

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func countOwnerSessionReads(t *testing.T, db *gorm.DB) *atomic.Int64 {
	t.Helper()
	count := new(atomic.Int64)
	name := "count_owner_sessions:" + uuid.NewString()
	if err := db.Callback().Query().After("gorm:query").Register(name, func(tx *gorm.DB) {
		if tx.Statement.Table == "owner_sessions" {
			count.Add(1)
		}
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove(name) })
	return count
}

func TestOwnerRequestCacheEndsWithRequest(t *testing.T) {
	s, original, _, _, _ := ownerActivityFixture(t)
	actor := access.Current(original).Actor()
	reads := countOwnerSessionReads(t, s.db)
	ctx, release := s.RequestContext(original)
	defer release()
	scope, err := s.Restore(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
			t.Fatal(err)
		}
	}
	if reads.Load() != 1 {
		t.Fatalf("session reads = %d, want 1", reads.Load())
	}
	if err := s.db.Model(&Session{}).Where("id=?", actor.SessionID).Update("revoked_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	next, endNext := s.RequestContext(original)
	defer endNext()
	if _, err := s.Restore(next, actor); err == nil {
		t.Fatal("next request reused revoked session")
	}
	detached := context.WithoutCancel(ctx)
	release()
	if err := scope.Check(detached, access.Requirement{Action: protocol.WorkspaceRead}); err == nil {
		t.Fatal("retained context reused completed request cache")
	}
}

func TestOwnerLeaseAdmissionDoesNotReuseRequestCache(t *testing.T) {
	s, original, _, _, _ := ownerActivityFixture(t)
	actor := access.Current(original).Actor()
	ctx, release := s.RequestContext(original)
	defer release()
	scope, err := s.Restore(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.db.Model(&Session{}).Where("id=?", actor.SessionID).Update("revoked_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	lease, err := scope.OpenWork(ctx, access.Connection, access.Requirement{Action: protocol.TerminalConnect, ServerID: uuid.NewString()})
	if lease != nil {
		lease.Close(nil)
	}
	if err == nil {
		t.Fatal("cached authentication admitted a revoked connection")
	}
}

func TestAuthenticateSeedsRequestCacheWithoutReloadingSession(t *testing.T) {
	s, original, owner, _, _ := ownerActivityFixture(t)
	token, csrf := uuid.NewString(), uuid.NewString()
	row := Session{ID: uuid.New(), OwnerID: owner.ID, TokenHash: ownerDigest(token), CSRFHash: ownerDigest(csrf), ExpiresAt: time.Now().Add(time.Hour)}
	if err := s.db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	reads := countOwnerSessionReads(t, s.db)
	ctx, release := s.RequestContext(original)
	defer release()
	scope, _, err := s.Authenticate(ctx, token, csrf, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Restore(ctx, scope.Actor()); err != nil {
		t.Fatal(err)
	}
	if reads.Load() != 1 {
		t.Fatalf("session reads = %d, want 1", reads.Load())
	}
}
