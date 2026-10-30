package runtime

import (
	"context"
	"github.com/easyssh/shared/protocol"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestConversationHistoryIsolatesVisitorsBeforePagination(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&AISessionRecord{}, &AIMessageRecord{}, &AIModelMessageRecord{}, &AISessionTaskRecord{}, &ToolExecutionRecord{}))
	store := newGormTestSessionStore(t, db)
	ctx := context.Background()
	owner := testAIActor(uuid.New())
	grant := uuid.NewString()
	visitor := func() protocol.Actor {
		id := uuid.NewString()
		return protocol.Actor{Kind: protocol.Visitor, ID: id, SessionID: id, GrantID: grant}
	}
	first, second := visitor(), visitor()
	now := time.Now().UTC()
	var firstID string
	for i, actor := range []protocol.Actor{owner, first, second} {
		id := uuid.NewString()
		if i == 1 {
			firstID = id
		}
		require.NoError(t, store.Save(ctx, SessionSnapshot{ID: id, Actor: actor, Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now.Add(time.Duration(i) * time.Second), Scope: SessionScope{Kind: "terminal", ServerID: "server-one"}, MessageViews: []MessageView{{ID: "message", Role: "user", Content: "private"}}}))
	}
	for _, actor := range []protocol.Actor{owner, first, second} {
		rows, total, err := store.List(ctx, actor, "", 1, 0, SessionScope{Kind: "terminal", ServerID: "server-one"})
		require.NoError(t, err)
		require.Equal(t, int64(1), total)
		require.Len(t, rows, 1)
		saved, err := store.Get(ctx, actor, rows[0].ID)
		require.NoError(t, err)
		require.Equal(t, actor, saved.Actor)
		require.Equal(t, "server-one", rows[0].Scope.ServerID)
	}
	_, err = store.Get(ctx, second, firstID)
	require.ErrorIs(t, err, ErrSessionNotFound)
	page, err := store.History(ctx, first, firstID, protocol.AIHistoryInput{Kind: "messages", Limit: 1})
	require.NoError(t, err)
	require.Equal(t, 1, page.Total)
	require.Len(t, page.Items, 1)
	for _, other := range []protocol.Actor{owner, second} {
		_, err := store.History(ctx, other, firstID, protocol.AIHistoryInput{Kind: "messages", AfterID: "message", Limit: 1})
		require.ErrorIs(t, err, ErrSessionNotFound, "history must authorize before resolving the cursor")
	}
	require.ErrorIs(t, store.Save(ctx, SessionSnapshot{ID: firstID, Actor: second, Title: "stolen", Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now.Add(time.Hour)}), ErrSnapshotConflict)
	require.ErrorIs(t, store.Delete(ctx, owner, firstID), ErrSessionNotFound)
	owner.SessionID = uuid.NewString()
	_, total, err := store.List(ctx, owner, "", 10, 0, SessionScope{})
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
}

type visitorAI struct {
	aiTestAuthority
	serverID string
}

func (a visitorAI) Authorize(ctx context.Context, actor protocol.Actor, req access.Requirement) error {
	if req.Action == protocol.WorkspaceRead || req.Action == protocol.AIUse && req.ServerID == a.serverID {
		return ctx.Err()
	}
	return access.ErrForbidden
}
func (a visitorAI) ServerIDs(context.Context, protocol.Actor) ([]string, error) {
	return []string{a.serverID}, nil
}
func (a visitorAI) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, requirements ...access.Requirement) (*access.Lease, error) {
	return a.runtime.Reserve(ctx, scope, kind, 0, requirements...)
}

func TestVisitorSubscriptionClosesOnRevocation(t *testing.T) {
	runtime := access.NewRuntime()
	t.Cleanup(runtime.Close)
	id := uuid.NewString()
	actor := protocol.Actor{Kind: protocol.Visitor, ID: id, SessionID: id, GrantID: uuid.NewString()}
	authority := visitorAI{aiTestAuthority: aiTestAuthority{runtime: runtime}, serverID: uuid.NewString()}
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), authority)
	require.NoError(t, err)
	ctx := access.WithScope(context.Background(), scope)
	manager := NewManager(fakeResolver{}, nil, nil, time.Minute)
	session, err := manager.CreateSession(ctx, CreateSessionInput{})
	require.NoError(t, err)
	events, stop, err := manager.Subscribe(ctx, session.ID)
	require.NoError(t, err)
	defer stop()
	<-events
	runtime.Invalidate(actor.GrantID, "", "", access.ErrRevoked)
	select {
	case _, ok := <-events:
		require.False(t, ok)
	case <-time.After(time.Second):
		t.Fatal("revocation did not close AI subscription")
	}
}
