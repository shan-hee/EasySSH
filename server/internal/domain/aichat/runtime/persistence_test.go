package runtime

import (
	"context"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"sync"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiwire"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type memorySessionStore struct {
	mu        sync.Mutex
	snapshots map[string]SessionSnapshot
}

func newMemorySessionStore() *memorySessionStore {
	return &memorySessionStore{snapshots: make(map[string]SessionSnapshot)}
}

func (s *memorySessionStore) Save(ctx context.Context, snapshot SessionSnapshot) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshots[snapshot.ID] = snapshot
	return nil
}

func (s *memorySessionStore) Get(ctx context.Context, actor protocol.Actor, sessionID string) (*SessionSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot, ok := s.snapshots[sessionID]
	if !ok || !sameConversationActor(snapshot.Actor, actor) {
		return nil, ErrSessionNotFound
	}
	return &snapshot, nil
}

// This fake has no file store; artifact endpoint tests use the real GORM fixture.
func (s *memorySessionStore) TaskFile(ctx context.Context, actor protocol.Actor, sessionID, taskID string) (protocol.ContentReference, error) {
	if _, err := s.Get(ctx, actor, sessionID); err != nil {
		return protocol.ContentReference{}, err
	}
	return protocol.ContentReference{}, ErrTaskNotFound
}

func (s *memorySessionStore) History(ctx context.Context, actor protocol.Actor, sessionID string, input protocol.AIHistoryInput) (protocol.AIHistoryPage, error) {
	snapshot, err := s.Get(ctx, actor, sessionID)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	if snapshot.Status == SessionStatusClosed {
		return protocol.AIHistoryPage{}, ErrSessionNotFound
	}
	ids := make([]string, len(snapshot.MessageViews))
	read := func(i int) (any, error) { return snapshot.MessageViews[i], nil }
	if input.Kind == "tasks" {
		ids = make([]string, len(snapshot.Tasks))
		for i := range ids {
			ids[i] = snapshot.Tasks[i].View.ID
		}
		read = func(i int) (any, error) { return snapshot.Tasks[i].View.Public(), nil }
	} else {
		for i := range ids {
			ids[i] = snapshot.MessageViews[i].ID
		}
	}
	return aiwire.BuildHistoryPage(sessionID, snapshot.UpdatedAt, input, ids, read)
}

func (s *memorySessionStore) GetLatestActive(ctx context.Context, actor protocol.Actor) (*SessionSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var latest *SessionSnapshot
	for _, snapshot := range s.snapshots {
		if !sameConversationActor(snapshot.Actor, actor) || snapshot.Status == SessionStatusClosed {
			continue
		}
		candidate := snapshot
		if latest == nil || candidate.UpdatedAt.After(latest.UpdatedAt) {
			latest = &candidate
		}
	}
	if latest == nil {
		return nil, ErrSessionNotFound
	}
	return latest, nil
}

func (s *memorySessionStore) List(ctx context.Context, actor protocol.Actor, query string, limit, offset int, filter SessionScope) ([]SessionListItem, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]SessionListItem, 0)
	for _, snapshot := range s.snapshots {
		if !sameConversationActor(snapshot.Actor, actor) || !scopeMatches(snapshot.Scope, filter) || len(snapshot.MessageViews) == 0 {
			continue
		}
		if query != "" && !aichatui.SessionMatchesSearch(snapshot.Title, snapshot.MessageViews, query) {
			continue
		}
		items = append(items, sessionListItemFromSnapshot(snapshot, query))
	}
	return paginateSessionListItems(items, limit, offset), int64(len(items)), nil
}

func (s *memorySessionStore) Delete(ctx context.Context, actor protocol.Actor, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot, ok := s.snapshots[sessionID]
	if !ok || !sameConversationActor(snapshot.Actor, actor) {
		return ErrSessionNotFound
	}
	delete(s.snapshots, sessionID)
	return nil
}

func TestSessionSnapshotRecordRoundTrip(t *testing.T) {
	t.Parallel()

	ownerID := uuid.New()
	now := time.Now().UTC().Truncate(time.Second)
	snapshot := SessionSnapshot{
		ID:             uuid.NewString(),
		Actor:          testAIActor(ownerID),
		Model:          "gpt-test",
		PermissionMode: "balanced",
		Status:         SessionStatusWaitingConfirmation,
		CreatedAt:      now,
		UpdatedAt:      now.Add(time.Minute),
		Messages: []provider.Message{
			{Role: "user", Content: "执行 uptime"},
			{
				Role:    "assistant",
				Content: "准备执行。",
				ToolCalls: []registry.ToolCall{{
					ID:        "call-1",
					Name:      "execute_command",
					Arguments: json.RawMessage(`{"server_id":"srv-1","command":"uptime"}`),
				}},
			},
		},
		MessageViews: []MessageView{
			{ID: "msg-1", Role: "user", Content: "执行 uptime", CreatedAt: now},
			{ID: "msg-2", Role: "assistant", Content: "准备执行。", CreatedAt: now.Add(time.Second)},
		},
		Tasks: []PersistedTask{{
			ToolCall: registry.ToolCall{ID: "call-1", Name: "execute_command", Arguments: json.RawMessage(`{"server_id":"srv-1","command":"uptime"}`)},
			View: TaskView{
				ID:                   "task-1",
				ToolCallID:           "call-1",
				ToolName:             "execute_command",
				Status:               TaskStatusWaitingConfirm,
				Dangerous:            true,
				RequiresConfirmation: true,
				CreatedAt:            now,
				UpdatedAt:            now,
			},
		}},
		TaskOrder: []string{"task-1"},
	}

	_, store := sessionItemsFixture(t)
	require.NoError(t, store.Save(context.Background(), snapshot))
	restored, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, snapshot.ID, restored.ID)
	require.Equal(t, snapshot.Actor, restored.Actor)
	require.Equal(t, snapshot.Status, restored.Status)
	require.Len(t, restored.Messages, 2)
	require.Len(t, restored.MessageViews, 2)
	require.Len(t, restored.Tasks, 1)
	require.Equal(t, "task-1", restored.TaskOrder[0])
	require.JSONEq(t, `{"server_id":"srv-1","command":"uptime"}`, string(restored.Tasks[0].ToolCall.Arguments))
}

func TestGormSessionStoreListScansSQLiteJSONText(t *testing.T) {
	t.Parallel()

	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&AISessionRecord{}, &AIMessageRecord{}, &AIModelMessageRecord{}, &AISessionTaskRecord{}, &ToolExecutionRecord{}))

	store := newGormTestSessionStore(t, db)
	ownerID := uuid.New()
	now := time.Now().UTC().Truncate(time.Second)
	snapshot := SessionSnapshot{
		ID:             uuid.NewString(),
		Actor:          testAIActor(ownerID),
		Model:          "gpt-test",
		Title:          "SQLite 会话",
		PermissionMode: "balanced",
		Status:         SessionStatusIdle,
		CreatedAt:      now,
		UpdatedAt:      now,
		Messages: []provider.Message{
			{Role: "user", Content: "你好"},
		},
		MessageViews: []MessageView{
			{ID: "msg-1", Role: "user", Content: "你好", CreatedAt: now},
		},
		Tasks:     []PersistedTask{},
		TaskOrder: []string{},
	}

	require.NoError(t, store.Save(context.Background(), snapshot))

	items, total, err := store.List(context.Background(), testAIActor(ownerID), "", 10, 0, SessionScope{})
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	require.Equal(t, snapshot.ID, items[0].ID)
	require.Equal(t, len(snapshot.MessageViews), items[0].MessageCount)
	require.Contains(t, items[0].Preview, snapshot.MessageViews[0].Content)
	restored, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, snapshot.Messages[0].Content, restored.Messages[0].Content)
}

func TestGormSessionStoreRejectsStaleSnapshotAndAllowsIdenticalReplay(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&AISessionRecord{}, &AIMessageRecord{}, &AIModelMessageRecord{}, &AISessionTaskRecord{}, &ToolExecutionRecord{}))
	store := newGormTestSessionStore(t, db)
	now := time.Now().UTC().Truncate(time.Microsecond)
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), Title: "first", Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now}
	require.NoError(t, store.Save(context.Background(), snapshot))
	newer := snapshot
	newer.Title, newer.UpdatedAt = "newer result", now.Add(time.Second)
	require.NoError(t, store.Save(context.Background(), newer))
	require.NoError(t, store.Save(context.Background(), newer))
	require.ErrorIs(t, store.Save(context.Background(), snapshot), ErrSnapshotConflict)
	saved, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, "newer result", saved.Title)
	record, err := newer.toRecord()
	require.NoError(t, err)
	require.True(t, sameSessionMetadata(record, record, time.Nanosecond))
	changed := record
	changed.ScopeJSON = jsonText(`{"kind":"terminal"}`)
	require.False(t, sameSessionMetadata(record, changed, time.Nanosecond))
}

func TestManagerPersistsRestoresAndListsSessions(t *testing.T) {
	t.Parallel()

	ownerID := uuid.New()
	store := newMemorySessionStore()
	runner := &fakeTurnRunner{
		scripts: []fakeTurnScript{
			{result: provider.TurnResult{Content: "完成。"}},
			{result: provider.TurnResult{Content: "已切换服务器。"}},
			{result: provider.TurnResult{Content: "终端会话完成。"}},
		},
	}

	manager := NewManager(
		fakeResolver{config: provider.Config{Model: "fake-model", Models: []string{"fake-model", "gpt-test"}}},
		runner,
		registry.NewToolRegistry(nil),
		time.Minute,
	)
	manager.SetSessionStore(store)

	session, err := manager.CreateSession(testAIContext(t, ownerID), CreateSessionInput{
		Model:          "gpt-test",
		PermissionMode: "balanced",
	})
	require.NoError(t, err)
	require.NoError(t, manager.SendUserMessage(testAIContext(t, ownerID), session.ID, "你好"))

	require.Eventually(t, func() bool {
		latest, err := store.GetLatestActive(context.Background(), testAIActor(ownerID))
		return err == nil && latest.ID == session.ID && len(latest.MessageViews) >= 2 && latest.Status == SessionStatusIdle
	}, 2*time.Second, 20*time.Millisecond)

	items, total, err := manager.ListSessions(testAIContext(t, ownerID), "", 10, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	require.Equal(t, session.ID, items[0].ID)
	require.Equal(t, "你好", items[0].Title)
	require.Equal(t, 2, items[0].MessageCount)

	require.NoError(t, manager.RenameSession(testAIContext(t, ownerID), session.ID, "巡检会话"))
	items, total, err = manager.ListSessions(testAIContext(t, ownerID), "巡检", 10, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, "巡检会话", items[0].Title)
	require.True(t, items[0].CustomTitle)

	require.NoError(t, manager.SendUserMessageWithOptions(testAIContext(t, ownerID), session.ID, SendUserMessageInput{
		Content:        "切换到指定服务器",
		PermissionMode: "privileged",
		Scope: SessionScope{
			Kind:       "terminal",
			ServerID:   "server-2",
			ServerName: "Pve-Debian14",
		},
	}))
	require.Eventually(t, func() bool {
		view, err := manager.GetSession(testAIContext(t, ownerID), session.ID)
		return err == nil && view.Status == SessionStatusIdle && len(view.Messages) >= 4
	}, 2*time.Second, 20*time.Millisecond)

	items, total, err = manager.ListSessions(testAIContext(t, ownerID), "", 10, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Equal(t, session.ID, items[0].ID)
	require.Equal(t, "privileged", items[0].PermissionMode)
	require.Equal(t, 4, items[0].MessageCount)

	terminalSession, err := manager.CreateSession(testAIContext(t, ownerID), CreateSessionInput{
		Model:          "gpt-test",
		PermissionMode: "privileged",
		Scope: SessionScope{
			Kind:       "terminal",
			ServerID:   "server-1",
			ServerName: "Pve-Debian13",
		},
	})
	require.NoError(t, err)
	require.NoError(t, manager.SendUserMessage(testAIContext(t, ownerID), terminalSession.ID, "你好"))

	require.Eventually(t, func() bool {
		view, err := manager.GetSession(testAIContext(t, ownerID), terminalSession.ID)
		return err == nil && view.Status == SessionStatusIdle && len(view.Messages) >= 2
	}, 2*time.Second, 20*time.Millisecond)

	items, total, err = manager.ListSessions(testAIContext(t, ownerID), "", 10, 0)
	require.NoError(t, err)
	require.Equal(t, int64(2), total)
	require.Equal(t, terminalSession.ID, items[0].ID)
	require.Equal(t, "你好", items[0].Title)
	require.Equal(t, "privileged", items[0].PermissionMode)

	restoredManager := NewManager(
		fakeResolver{config: provider.Config{Model: "fake-model", Models: []string{"fake-model", "gpt-test"}}},
		nil,
		registry.NewToolRegistry(nil),
		time.Minute,
	)
	restoredManager.SetSessionStore(store)

	restored, err := restoredManager.GetLatestActiveSession(testAIContext(t, ownerID))
	require.NoError(t, err)
	require.Equal(t, terminalSession.ID, restored.ID)
	require.Equal(t, SessionStatusIdle, restored.Status)
	require.Len(t, restored.Messages, 2)

	require.NoError(t, manager.DeleteSession(testAIContext(t, ownerID), session.ID))
	require.NoError(t, manager.DeleteSession(testAIContext(t, ownerID), terminalSession.ID))
	items, total, err = manager.ListSessions(testAIContext(t, ownerID), "", 10, 0)
	require.NoError(t, err)
	require.Equal(t, int64(0), total)
	require.Empty(t, items)

}
