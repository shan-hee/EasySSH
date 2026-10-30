package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/shared/resultstore"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

type controlledSessionStore struct {
	*memorySessionStore
	control    sync.Mutex
	failure    error
	saves      int
	beforeSave func(SessionSnapshot)
}

func (s *controlledSessionStore) Save(ctx context.Context, snapshot SessionSnapshot) error {
	s.control.Lock()
	s.saves++
	err, before := s.failure, s.beforeSave
	s.control.Unlock()
	if before != nil {
		before(snapshot)
	}
	if err != nil {
		return err
	}
	return s.memorySessionStore.Save(ctx, snapshot)
}

func (s *controlledSessionStore) setFailure(err error) {
	s.control.Lock()
	s.failure = err
	s.control.Unlock()
}

func newPersistenceFixture(t *testing.T) (*Manager, *controlledSessionStore, context.Context, *session) {
	t.Helper()
	ctx := testAIContext(t, uuid.New())
	m := NewManager(fakeResolver{}, nil, nil, time.Minute)
	store := &controlledSessionStore{memorySessionStore: newMemorySessionStore()}
	m.SetSessionStore(store)
	t.Cleanup(func() {
		store.setFailure(nil)
		store.control.Lock()
		store.beforeSave = nil
		store.control.Unlock()
		bounded, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = m.Stop(bounded)
	})
	view, err := m.CreateSession(ctx, CreateSessionInput{})
	require.NoError(t, err)
	s, ok := m.getSessionByID(view.ID)
	require.True(t, ok)
	return m, store, ctx, s
}

func installPersistenceTool(m *Manager, s *session, executor registry.ToolExecutor) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s.taskOrder = []string{"tool"}
	s.tasks["tool"] = &taskState{
		view:     TaskView{ID: "tool", Status: TaskStatusQueued},
		toolCall: registry.ToolCall{ID: "call", Arguments: json.RawMessage(`{}`)},
		spec:     registry.ToolSpec{Executor: executor},
	}
}

func TestPersistenceFailureBeforeDispatchDoesNotExecuteTool(t *testing.T) {
	m, store, ctx, s := newPersistenceFixture(t)
	calls := 0
	installPersistenceTool(m, s, func(context.Context, json.RawMessage) (registry.ExecutionResult, error) {
		calls++
		return registry.ExecutionResult{Content: "changed"}, nil
	})
	// Exercise the exhausted-writer path without a 30-second outage in this test.
	store.setFailure(resultstore.Permanent(resultstore.ErrUnavailable))
	m.executeTask(ctx, s, "tool")
	require.Zero(t, calls)
	require.Equal(t, TaskStatusCancelled, s.tasks["tool"].view.Status)
	require.ErrorIs(t, s.storageErr, resultstore.ErrUnavailable)
	store.setFailure(nil)
	view, err := m.GetSession(ctx, s.id)
	require.NoError(t, err)
	require.Empty(t, view.Tasks, "failed intent was not committed")
	require.Zero(t, calls, "reopening reads storage, never dispatches a tool")
}

func TestExhaustedSaveStopsSessionAndReopensDurableIntentAsUnknown(t *testing.T) {
	m, store, ctx, s := newPersistenceFixture(t)
	calls := 0
	installPersistenceTool(m, s, func(context.Context, json.RawMessage) (registry.ExecutionResult, error) {
		calls++
		store.setFailure(resultstore.Permanent(resultstore.ErrUnavailable))
		return registry.ExecutionResult{Content: "confirmed remote effect", CommandOutput: "receipt"}, nil
	})
	m.executeTask(ctx, s, "tool")
	require.Equal(t, TaskStatusSucceeded, s.tasks["tool"].view.Status)
	require.ErrorIs(t, s.storageErr, resultstore.ErrUnavailable)
	saved, err := store.Get(ctx, s.actor, s.id)
	require.NoError(t, err)
	require.Equal(t, TaskStatusRunning, saved.Tasks[0].View.Status)
	_, err = m.GetSession(testAIContext(t, uuid.New()), s.id)
	require.ErrorIs(t, err, ErrSessionNotFound)
	// Other workers must finish before the failed cache may be replaced.
	m.mu.Lock()
	s.processing = true
	m.mu.Unlock()
	require.ErrorIs(t, m.SendUserMessage(ctx, s.id, "again"), resultstore.ErrUnavailable)
	require.ErrorIs(t, m.RenameSession(ctx, s.id, "changed"), resultstore.ErrUnavailable)
	imported := false
	err = m.WithSyncSession(uuid.MustParse(s.actor.ID), s.id, func() error { imported = true; return nil })
	require.ErrorIs(t, err, resultstore.ErrUnavailable)
	require.False(t, imported)
	m.mu.Lock()
	s.processing = false
	old := m.snapshotForPersistenceLocked(s)
	m.mu.Unlock()
	store.setFailure(nil)
	view, err := m.GetSession(ctx, s.id)
	require.NoError(t, err)
	require.Equal(t, TaskStatusUnknown, view.Tasks[0].Status)
	require.NotContains(t, view.Tasks[0].Result, "confirmed remote effect")
	saved, err = store.Get(ctx, s.actor, s.id)
	require.NoError(t, err)
	require.Equal(t, TaskStatusUnknown, saved.Tasks[0].View.Status)
	require.ErrorIs(t, m.saveSnapshot(ctx, old), ErrSessionNotFound, "old worker must not save the reopened runtime")
	require.Equal(t, 1, calls)
}

func TestTransientResultSaveRetriesOnlyDatabaseWrite(t *testing.T) {
	m, store, ctx, s := newPersistenceFixture(t)
	calls := 0
	installPersistenceTool(m, s, func(context.Context, json.RawMessage) (registry.ExecutionResult, error) {
		calls++
		store.control.Lock()
		store.failure = errors.New("temporary database failure")
		store.beforeSave = func(SessionSnapshot) { store.setFailure(nil) }
		store.control.Unlock()
		return registry.ExecutionResult{Content: "confirmed effect"}, nil
	})
	m.executeTask(ctx, s, "tool")
	require.Nil(t, s.storageErr)
	saved, err := store.Get(ctx, s.actor, s.id)
	require.NoError(t, err)
	require.Equal(t, TaskStatusSucceeded, saved.Tasks[0].View.Status)
	require.Equal(t, "confirmed effect", saved.Tasks[0].View.Result)
	require.Equal(t, 1, calls)
}

func TestLateSnapshotCallerCapturesNewestConversation(t *testing.T) {
	m, store, _, s := newPersistenceFixture(t)
	m.mu.Lock()
	old := m.snapshotForPersistenceLocked(s)
	s.title, s.updatedAt = "latest", time.Now()
	m.mu.Unlock()
	require.NoError(t, m.saveSnapshot(context.Background(), old))
	saved, err := store.Get(context.Background(), s.actor, s.id)
	require.NoError(t, err)
	require.Equal(t, "latest", saved.Title)
}

func TestSnapshotHasIndependentNestedToolArgumentsDuringSave(t *testing.T) {
	m, store, _, s := newPersistenceFixture(t)
	installPersistenceTool(m, s, nil)
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	releaseSave := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(releaseSave)
	store.control.Lock()
	store.beforeSave = func(SessionSnapshot) { close(entered); <-release }
	store.control.Unlock()
	m.mu.Lock()
	s.tasks["tool"].toolCall.Arguments = json.RawMessage(`{"value":1}`)
	snapshot := m.snapshotForPersistenceLocked(s)
	m.mu.Unlock()
	done := make(chan error, 1)
	go func() { done <- m.saveSnapshot(context.Background(), snapshot) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("save did not start")
	}
	m.mu.Lock()
	s.tasks["tool"].toolCall.Arguments[9] = '2'
	m.mu.Unlock()
	releaseSave()
	require.NoError(t, <-done)
	store.control.Lock()
	store.beforeSave = nil
	store.control.Unlock()
	saved, err := store.Get(context.Background(), s.actor, s.id)
	require.NoError(t, err)
	require.JSONEq(t, `{"value":1}`, string(saved.Tasks[0].ToolCall.Arguments))
}

func TestSnapshotConflictStopsSavingAndReopensStoredVersion(t *testing.T) {
	m, store, ctx, s := newPersistenceFixture(t)
	store.setFailure(ErrSnapshotConflict)
	require.ErrorIs(t, m.RenameSession(ctx, s.id, "unsaved title"), ErrSnapshotConflict)
	store.control.Lock()
	attempts := store.saves
	store.control.Unlock()
	m.mu.RLock()
	old := m.snapshotForPersistenceLocked(s)
	m.mu.RUnlock()
	store.setFailure(nil)
	require.ErrorIs(t, m.saveSnapshot(ctx, old), ErrSnapshotConflict)
	store.control.Lock()
	afterRetry := store.saves
	store.control.Unlock()
	require.Equal(t, attempts, afterRetry)
	view, err := m.GetSession(ctx, s.id)
	require.NoError(t, err)
	require.NotEqual(t, "unsaved title", view.Title)
	require.ErrorIs(t, m.saveSnapshot(ctx, old), ErrSessionNotFound)
}

func TestFailureBeforeProviderDispatchReleasesExecutionSlot(t *testing.T) {
	m, store, ctx, s := newPersistenceFixture(t)
	store.setFailure(resultstore.Permanent(resultstore.ErrUnavailable))
	require.ErrorIs(t, m.SendUserMessage(ctx, s.id, "hello"), resultstore.ErrUnavailable)
	m.mu.RLock()
	activeRuns, processing, runID := m.activeRuns, s.processing, s.currentRunID
	m.mu.RUnlock()
	require.Zero(t, activeRuns)
	require.False(t, processing)
	require.Empty(t, runID)
	store.setFailure(nil)
	view, err := m.GetSession(ctx, s.id)
	require.NoError(t, err)
	require.Equal(t, SessionStatusIdle, view.Status)
	require.Empty(t, view.Messages, "failed intent is not offered as a pending result")
}

func TestSyncFlushFailureSkipsImportAndDoesNotPinMemory(t *testing.T) {
	m, store, _, s := newPersistenceFixture(t)
	store.setFailure(resultstore.Permanent(resultstore.ErrUnavailable))
	imported := false
	err := m.WithSyncSession(uuid.MustParse(s.actor.ID), s.id, func() error { imported = true; return nil })
	require.Error(t, err)
	require.False(t, imported)
	require.ErrorIs(t, s.storageErr, resultstore.ErrUnavailable)
	m.cleanupExpired(time.Now().Add(24 * time.Hour))
	_, ok := m.getSessionByID(s.id)
	require.False(t, ok, "storage failures must not create an unbounded pending-session cache")
}

func TestSyncCommitInvalidatesCachedConversationEvenWhenCallerSeesError(t *testing.T) {
	m, store, ctx, s := newPersistenceFixture(t)
	m.mu.RLock()
	oldSnapshot := m.snapshotForPersistenceLocked(s)
	m.mu.RUnlock()
	commitErr := errors.New("commit acknowledgment lost")
	err := m.WithSyncSession(uuid.MustParse(s.actor.ID), s.id, func() error {
		imported := oldSnapshot
		imported.Title, imported.UpdatedAt = "imported version", time.Now().Add(time.Second)
		if err := store.Save(ctx, imported); err != nil {
			return err
		}
		return commitErr
	})
	require.ErrorIs(t, err, commitErr)
	require.ErrorIs(t, m.saveSnapshot(ctx, oldSnapshot), ErrSessionNotFound)
	view, err := m.GetSession(ctx, s.id)
	require.NoError(t, err)
	require.Equal(t, "imported version", view.Title)
}

type blockingPersistenceRunner struct{ started, cancelled, release chan struct{} }

func (r *blockingPersistenceRunner) StreamTurn(ctx context.Context, _ provider.Config, _ provider.TurnRequest, emit func(provider.Event) error) (provider.TurnResult, error) {
	_ = emit(provider.Event{Type: provider.EventTextDelta, Delta: "observed partial response"})
	close(r.started)
	<-ctx.Done()
	close(r.cancelled)
	<-r.release
	return provider.TurnResult{}, ctx.Err()
}

func TestShutdownWaitsForWorkerAndPersistsInterruptedResponse(t *testing.T) {
	ctx := testAIContext(t, uuid.New())
	runner := &blockingPersistenceRunner{started: make(chan struct{}), cancelled: make(chan struct{}), release: make(chan struct{})}
	m := NewManager(fakeResolver{config: provider.Config{Model: "fake-model"}}, runner, nil, time.Minute)
	store := newMemorySessionStore()
	m.SetSessionStore(store)
	var releaseOnce sync.Once
	releaseRunner := func() { releaseOnce.Do(func() { close(runner.release) }) }
	t.Cleanup(func() {
		releaseRunner()
		bounded, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = m.Stop(bounded)
	})
	view, err := m.CreateSession(ctx, CreateSessionInput{})
	require.NoError(t, err)
	require.NoError(t, m.SendUserMessage(ctx, view.ID, "hello"))
	select {
	case <-runner.started:
	case <-time.After(time.Second):
		t.Fatal("provider did not start")
	}
	done := make(chan error, 1)
	go func() { done <- m.Stop(context.Background()) }()
	select {
	case <-runner.cancelled:
	case <-time.After(time.Second):
		t.Fatal("provider did not cancel")
	}
	require.ErrorIs(t, m.SendUserMessage(ctx, view.ID, "late"), ErrManagerStopped)
	select {
	case <-done:
		t.Fatal("shutdown did not wait for the worker")
	default:
	}
	releaseRunner()
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(time.Second):
		t.Fatal("shutdown did not finish")
	}
	saved, err := store.Get(ctx, access.Current(ctx).Actor(), view.ID)
	require.NoError(t, err)
	require.Equal(t, SessionStatusIdle, saved.Status)
	require.Equal(t, "observed partial response", saved.Messages[len(saved.Messages)-1].Content)
	require.NotNil(t, saved.MessageViews[len(saved.MessageViews)-1].StoppedAt)
	require.NoError(t, m.Stop(context.Background()))
}

func TestHistoryChangeIsEmittedOnlyAfterSuccessfulCommit(t *testing.T) {
	m, store, ctx, s := newPersistenceFixture(t)
	events, stop, err := m.Subscribe(ctx, s.id)
	require.NoError(t, err)
	defer stop()
	<-events // Initial session envelope.
	store.control.Lock()
	store.beforeSave = func(SessionSnapshot) {
		select {
		case event := <-events:
			t.Fatalf("event sent before commit: %s", event.Type)
		default:
		}
	}
	store.control.Unlock()
	m.mu.Lock()
	snapshot := m.snapshotForPersistenceLocked(s)
	m.mu.Unlock()
	require.NoError(t, m.saveSnapshot(ctx, snapshot))
	select {
	case event := <-events:
		require.Equal(t, EventHistoryChanged, event.Type)
		require.NotNil(t, event.History)
		require.Equal(t, s.id, event.History.SessionID)
	default:
		t.Fatal("missing committed history notification")
	}
	store.setFailure(ErrSnapshotConflict)
	require.ErrorIs(t, m.saveSnapshot(ctx, snapshot), ErrSnapshotConflict)
	for len(events) > 0 {
		require.NotEqual(t, EventHistoryChanged, (<-events).Type, "failed commit advertised durable history")
	}
}
