package runtime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestPersistedHistoryContentUsesPublicProjectionAndInvalidatesOldReference(t *testing.T) {
	db, store := sessionItemsFixture(t)
	ctx := testAIContext(t, uuid.New())
	actor, err := access.RequireAIActor(ctx)
	require.NoError(t, err)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: actor, Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		MessageViews: []MessageView{{ID: "message", Role: "assistant", Content: strings.Repeat("reply", 10000)}},
		Tasks: []PersistedTask{{View: TaskView{ID: "tool", ToolName: "create_artifact", Status: TaskStatusSucceeded,
			Result: strings.Repeat("public result", 5000), Artifact: &aiworkspace.FileArtifact{Content: "private artifact"},
			Arguments: map[string]any{"content": "private artifact"},
		}}},
	}
	require.NoError(t, store.Save(ctx, snapshot))
	bodies := store.(*gormSessionStore).bodies
	input := protocol.AIHistoryInput{Kind: "tasks"}
	page, err := store.History(ctx, actor, snapshot.ID, input)
	require.NoError(t, err)
	require.NoError(t, aiwire.ValidateHistoryPage(snapshot.ID, input, page))
	require.Len(t, page.Items, 1)
	require.NotNil(t, page.Items[0].Content)
	ref := *page.Items[0].Content
	got, err := bodies.Reference(ctx, ref.ID)
	require.NoError(t, err)
	require.Equal(t, ref, got)
	chunkInput := protocol.ContentReadInput{Sha256: ref.Sha256, Limit: contentstore.MaxReadBytes}
	chunk, err := bodies.Read(ctx, ref.ID, chunkInput)
	require.NoError(t, err)
	require.NoError(t, contentstore.ValidateChunk(ref, chunkInput, chunk))
	raw, err := base64.StdEncoding.DecodeString(chunk.Data)
	require.NoError(t, err)
	var task TaskView
	require.NoError(t, json.Unmarshal(raw, &task))
	require.Equal(t, snapshot.Tasks[0].View.Result, task.Result)
	require.Nil(t, task.Artifact)
	require.NotContains(t, string(raw), "private artifact")
	var private AISessionTaskRecord
	require.NoError(t, db.Where("session_id=?", snapshot.ID).Take(&private).Error)
	require.NotNil(t, private.ContentID)
	_, err = bodies.Reference(ctx, *private.ContentID)
	require.ErrorIs(t, err, content.ErrNotFound)
	_, err = bodies.Reference(testAIContext(t, uuid.New()), ref.ID)
	require.ErrorIs(t, err, content.ErrNotFound)

	// A new public version detaches the old reference immediately; cleanup may
	// run later. Turning the item small clears the public file reference too.
	snapshot.Tasks[0].View.Result = "small"
	snapshot.UpdatedAt = now.Add(time.Second)
	require.NoError(t, store.Save(ctx, snapshot))
	_, err = bodies.Reference(ctx, ref.ID)
	require.ErrorIs(t, err, content.ErrNotFound)
	page, err = store.History(ctx, actor, snapshot.ID, input)
	require.NoError(t, err)
	require.Nil(t, page.Items[0].Content)
	require.NotEmpty(t, page.Items[0].Data)
	require.NoError(t, bodies.Cleanup(context.Background()))
	var remaining int64
	require.NoError(t, db.Model(&content.Record{}).Where("id=?", ref.ID).Count(&remaining).Error)
	require.Zero(t, remaining)
}

func TestPersistedHistoryDescriptorsDoNotReadLargeFilesOrPrivateTaskPayload(t *testing.T) {
	db, store := sessionItemsFixture(t)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		MessageViews: []MessageView{{ID: "message", Role: "assistant", Content: strings.Repeat("reply", 10000)}},
		Tasks:        []PersistedTask{{View: TaskView{ID: "tool", Status: TaskStatusSucceeded, Result: strings.Repeat("result", 10000)}}},
	}
	require.NoError(t, store.Save(context.Background(), snapshot))
	require.NoError(t, db.Exec(`UPDATE ai_session_tasks SET payload='invalid-private-json',content_id=NULL WHERE session_id=?`, snapshot.ID).Error)
	// A closed file store makes any attempted body restore fail. Metadata-only
	// history remains available for both messages and public tool projections.
	require.NoError(t, store.(*gormSessionStore).bodies.Close())
	for _, kind := range []string{"messages", "tasks"} {
		input := protocol.AIHistoryInput{Kind: kind}
		page, err := store.History(context.Background(), snapshot.Actor, snapshot.ID, input)
		require.NoError(t, err)
		require.NoError(t, aiwire.ValidateHistoryPage(snapshot.ID, input, page))
		require.Len(t, page.Items, 1)
		require.NotNil(t, page.Items[0].Content)
	}
}
