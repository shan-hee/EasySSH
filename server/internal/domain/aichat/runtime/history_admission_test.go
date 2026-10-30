package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiprovider"
	"github.com/stretchr/testify/require"
)

func TestRejectedAIInputDoesNotAppendHistoryOrReserveRun(t *testing.T) {
	m, store, ctx, s := newPersistenceFixture(t)
	m.mu.Lock()
	s.messages = []provider.Message{{Role: "user", Content: "original"}}
	s.messageViews = []MessageView{{ID: "user", Role: "user", Content: "original"}}
	snapshot := m.snapshotForPersistenceLocked(s)
	m.mu.Unlock()
	require.NoError(t, m.saveSnapshot(ctx, snapshot))
	oversized := strings.Repeat("x", aiprovider.MaxRequestTextBytes+1)
	for _, invoke := range []func() error{
		func() error {
			return m.SendUserMessageWithOptions(ctx, s.id, SendUserMessageInput{Content: oversized, PermissionMode: "auto"})
		},
		func() error {
			_, err := m.UpdateUserMessage(ctx, s.id, "user", UpdateMessageInput{Content: oversized})
			return err
		},
		func() error {
			return m.RegenerateAfterUserMessage(ctx, s.id, "user", SendUserMessageInput{Context: oversized})
		},
	} {
		err := invoke()
		var limit *aiprovider.ProviderError
		require.ErrorAs(t, err, &limit)
		require.Equal(t, "ai_context_limit", limit.Code)
		m.mu.RLock()
		require.Zero(t, m.activeRuns)
		require.False(t, s.processing)
		require.Len(t, s.messages, 1)
		require.Equal(t, "original", s.messages[0].Content)
		require.Equal(t, "original", s.messageViews[0].Content)
		m.mu.RUnlock()
		saved, err := store.Get(ctx, s.actor, s.id)
		require.NoError(t, err)
		require.Len(t, saved.MessageViews, 1)
		require.Equal(t, "original", saved.MessageViews[0].Content)
	}
}

func TestObservedAIHistoryCanBeSavedButCannotGrowThroughNewTurns(t *testing.T) {
	m, store, ctx, s := newPersistenceFixture(t)
	output := strings.Repeat("x", aiprovider.MaxRequestTextBytes+1)
	m.mu.Lock()
	s.messages = []provider.Message{{Role: "assistant", Content: output}}
	s.messageViews = []MessageView{{ID: "observed", Role: "assistant", Content: output}}
	snapshot := m.snapshotForPersistenceLocked(s)
	m.mu.Unlock()
	// Already observed output must remain saveable even when it makes a later
	// model context too large. A limit is admission control, not result loss.
	require.NoError(t, m.saveSnapshot(ctx, snapshot))
	for i := 0; i < 2; i++ {
		err := m.SendUserMessage(ctx, s.id, "continue")
		var limit *aiprovider.ProviderError
		require.ErrorAs(t, err, &limit)
		require.Equal(t, "ai_context_limit", limit.Code)
	}
	saved, err := store.Get(ctx, s.actor, s.id)
	require.NoError(t, err)
	require.Len(t, saved.MessageViews, 1)
	require.Equal(t, output, saved.MessageViews[0].Content)
}

func TestHistoryTaskLimitRejectsNewInputButAllowsEarlierEdit(t *testing.T) {
	m, store, ctx, s := newPersistenceFixture(t)
	m.mu.Lock()
	s.messages = []provider.Message{{Role: "user", Content: "question"}}
	s.messageViews = []MessageView{{ID: "user", Role: "user", Content: "question"}}
	// Imported presentation tasks need not have executable provider calls.
	for i := 0; i <= aichatui.MaxHistoryTasks; i++ {
		id := fmt.Sprint(i)
		s.tasks[id] = &taskState{view: TaskView{ID: id, Status: TaskStatusSucceeded}}
		s.taskOrder = append(s.taskOrder, id)
	}
	snapshot := m.snapshotForPersistenceLocked(s)
	m.mu.Unlock()
	require.NoError(t, m.saveSnapshot(ctx, snapshot))
	err := m.SendUserMessage(ctx, s.id, "continue")
	var limit *aiprovider.ProviderError
	require.ErrorAs(t, err, &limit)
	require.Equal(t, "ai_history_limit", limit.Code)
	require.Zero(t, m.activeRuns)
	require.Len(t, s.messageViews, 1)
	// Editing this earlier user message drops later tasks using the real branch rules.
	_, err = m.UpdateUserMessage(ctx, s.id, "user", UpdateMessageInput{Content: "shortened"})
	require.NoError(t, err)
	saved, err := store.Get(ctx, s.actor, s.id)
	require.NoError(t, err)
	require.Empty(t, saved.Tasks)
	require.Equal(t, "shortened", saved.MessageViews[0].Content)
}

func TestHistoryLimitCancelsUndispatchedToolAndKeepsObservedHistory(t *testing.T) {
	for _, status := range []TaskStatus{TaskStatusQueued, TaskStatusRunning} {
		t.Run(string(status), func(t *testing.T) {
			m, store, ctx, s := newPersistenceFixture(t)
			calls := 0
			installPersistenceTool(m, s, func(context.Context, json.RawMessage) (registry.ExecutionResult, error) {
				calls++
				return registry.ExecutionResult{}, nil
			})
			m.mu.Lock()
			s.tasks["tool"].view.Status = status // Confirmed work is marked running before dispatch.
			s.messageViews = make([]MessageView, aichatui.MaxHistoryMessages+1)
			s.messageViews[0] = MessageView{ID: "observed", Role: "assistant", Reasoning: "preserve this"}
			m.mu.Unlock()
			m.executeTask(ctx, s, "tool")
			require.Zero(t, calls)
			require.Equal(t, TaskStatusCancelled, s.tasks["tool"].view.Status)
			require.True(t, s.halted)
			saved, err := store.Get(ctx, s.actor, s.id)
			require.NoError(t, err)
			require.Len(t, saved.MessageViews, aichatui.MaxHistoryMessages+1)
			require.Equal(t, "preserve this", saved.MessageViews[0].Reasoning)
		})
	}
}
