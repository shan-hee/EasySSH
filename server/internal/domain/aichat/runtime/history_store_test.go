package runtime

import (
	"context"
	"encoding/json"
	"github.com/easyssh/server/internal/access"
	"testing"
	"time"

	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestPersistedHistoryDoesNotRestoreModelOrDecodeOtherPages(t *testing.T) {
	db, store := sessionItemsFixture(t)
	ownerID := uuid.New()
	ctx := testAIContext(t, ownerID)
	actor, err := access.RequireAIActor(ctx)
	require.NoError(t, err)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: actor, Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		MessageViews: []MessageView{{ID: "one", Role: "user", Content: "first"}, {ID: "two", Role: "assistant", Content: "second"}, {ID: "three", Role: "user", Content: "third"}},
		Tasks:        []PersistedTask{{View: TaskView{ID: "tool", Status: TaskStatusSucceeded}}},
	}
	require.NoError(t, store.Save(ctx, snapshot))
	require.NoError(t, db.Exec(`UPDATE ai_messages SET payload='invalid-json' WHERE session_id=? AND item_id='three'`, snapshot.ID).Error)
	require.NoError(t, db.Exec(`UPDATE ai_session_tasks SET payload='invalid-json' WHERE session_id=?`, snapshot.ID).Error)
	// An invalid private model row must not matter to a public history page.
	require.NoError(t, db.Exec(`INSERT INTO ai_model_messages(session_id,item_id,position,payload,content_hash) VALUES(?, '0', 0, 'invalid-json', 'unused')`, snapshot.ID).Error)
	m := NewManager(fakeResolver{}, nil, nil, time.Minute)
	m.SetSessionStore(store)
	t.Cleanup(func() { _ = m.Stop(context.Background()) })
	input := protocol.AIHistoryInput{Kind: "messages", Limit: 1}
	page, err := m.History(ctx, snapshot.ID, input)
	require.NoError(t, err)
	require.NoError(t, aiwire.ValidateHistoryPage(snapshot.ID, input, page))
	require.Equal(t, 3, page.Total)
	require.Equal(t, "one", page.NextAfterID)
	require.True(t, page.HasMore)
	m.mu.RLock()
	_, restored := m.sessions[snapshot.ID]
	m.mu.RUnlock()
	require.False(t, restored, "history restored a full runtime")
	input.AfterID = "one"
	page, err = m.History(ctx, snapshot.ID, input)
	require.NoError(t, err, "lookahead row must not be decoded")
	require.Equal(t, "two", page.NextAfterID)
	input.AfterID = "two"
	_, err = m.History(ctx, snapshot.ID, input)
	require.Error(t, err, "corruption in the requested item must not be hidden")
}

func TestPersistedHistoryCursorAndConversationOwnership(t *testing.T) {
	_, store := sessionItemsFixture(t)
	now := time.Now().UTC()
	actor := testAIActor(uuid.New())
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: actor, Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		MessageViews: []MessageView{{ID: "one", Role: "user"}, {ID: "two", Role: "assistant"}},
	}
	require.NoError(t, store.Save(context.Background(), snapshot))
	input := protocol.AIHistoryInput{Kind: "messages", AfterID: "one", Limit: 1}
	otherLogin := actor
	otherLogin.SessionID = uuid.NewString()
	page, err := store.History(context.Background(), otherLogin, snapshot.ID, input)
	require.NoError(t, err)
	require.Equal(t, "two", page.NextAfterID)
	require.False(t, page.HasMore)
	_, err = store.History(context.Background(), testAIActor(uuid.New()), snapshot.ID, input)
	require.ErrorIs(t, err, ErrSessionNotFound)
	snapshot.MessageViews = snapshot.MessageViews[1:]
	snapshot.UpdatedAt = now.Add(time.Second)
	require.NoError(t, store.Save(context.Background(), snapshot))
	_, err = store.History(context.Background(), actor, snapshot.ID, input)
	require.ErrorIs(t, err, aiwire.ErrHistoryCursor)
	snapshot.Status = SessionStatusClosed
	require.NoError(t, store.Save(context.Background(), snapshot))
	_, err = store.History(context.Background(), actor, snapshot.ID, protocol.AIHistoryInput{Kind: "messages"})
	require.ErrorIs(t, err, ErrSessionNotFound)
}

func TestPersistedTaskHistoryRemovesPrivateContent(t *testing.T) {
	_, store := sessionItemsFixture(t)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		Tasks: []PersistedTask{{View: TaskView{ID: "file", ToolName: "create_artifact", Status: TaskStatusSucceeded,
			Artifact: &aiworkspace.FileArtifact{Content: "private body"}, Arguments: map[string]any{"content": "private body"},
		}}},
	}
	require.NoError(t, store.Save(context.Background(), snapshot))
	page, err := store.History(context.Background(), snapshot.Actor, snapshot.ID, protocol.AIHistoryInput{Kind: "tasks"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	var task map[string]any
	require.NoError(t, json.Unmarshal(page.Items[0].Data, &task))
	require.NotContains(t, task, "execution")
	require.NotContains(t, task, "artifact")
	require.NotContains(t, string(page.Items[0].Data), "private body")
}
