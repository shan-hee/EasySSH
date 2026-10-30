package runtime

import (
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/contentstore"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestHistoryPagesKeepOwnershipAndExcludePrivateArtifacts(t *testing.T) {
	_, durable := sessionItemsFixture(t)
	m, _, ctx, s := newPersistenceFixture(t)
	m.SetSessionStore(durable)
	m.mu.Lock()
	s.messageViews = []MessageView{{ID: "message", Role: "assistant", Content: strings.Repeat("full reply", 10000), CreatedAt: time.Now()}}
	s.taskOrder = []string{"task"}
	s.tasks["task"] = &taskState{view: TaskView{ID: "task", Status: TaskStatusSucceeded, Artifact: &aiworkspace.FileArtifact{Content: "private file body"}, CreatedAt: time.Now(), UpdatedAt: time.Now()}}
	snapshot := m.snapshotForPersistenceLocked(s)
	m.mu.Unlock()
	require.NoError(t, m.saveSnapshot(ctx, snapshot))
	view, err := m.GetOverview(ctx, s.id)
	require.NoError(t, err)
	require.Equal(t, 1, view.MessageCount)
	require.Equal(t, 1, view.TaskCount)
	raw, err := json.Marshal(view)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "full reply")
	require.NotContains(t, string(raw), "private file body")
	page, err := m.History(ctx, s.id, protocol.AIHistoryInput{Kind: "tasks"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.NotContains(t, string(page.Items[0].Data), "artifact")
	messages, err := m.History(ctx, s.id, protocol.AIHistoryInput{Kind: "messages"})
	require.NoError(t, err)
	require.Empty(t, messages.Items[0].Data)
	require.NotNil(t, messages.Items[0].Content)
	ref := *messages.Items[0].Content
	input := protocol.ContentReadInput{Sha256: ref.Sha256, Limit: 128}
	chunk, err := durable.(*gormSessionStore).bodies.Read(ctx, ref.ID, input)
	require.NoError(t, err)
	require.NoError(t, contentstore.ValidateChunk(ref, input, chunk))
	other := testAIContext(t, uuid.New())
	_, err = m.GetOverview(other, s.id)
	require.ErrorIs(t, err, ErrSessionNotFound)
	_, err = m.History(other, s.id, protocol.AIHistoryInput{Kind: "messages"})
	require.ErrorIs(t, err, ErrSessionNotFound)
	m.mu.Lock()
	s.processing = true
	s.messageViews[0].Content += "uncommitted change"
	m.mu.Unlock()
	unchanged, err := m.History(ctx, s.id, protocol.AIHistoryInput{Kind: "messages"})
	require.NoError(t, err)
	require.Equal(t, messages.Items[0], unchanged.Items[0], "live runtime leaked into committed history")
	m.mu.Lock()
	s.processing = false
	m.mu.Unlock()
}
