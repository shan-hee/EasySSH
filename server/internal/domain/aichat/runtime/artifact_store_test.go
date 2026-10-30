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
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestTaskArtifactUsesOneBodyAndGenericOffsetReads(t *testing.T) {
	db, store := sessionItemsFixture(t)
	ctx := testAIContext(t, uuid.New())
	actor, err := access.RequireAIActor(ctx)
	require.NoError(t, err)
	before, after := strings.Repeat("<>&\n", 10000), strings.Repeat("汉字", 20000)
	file, err := aiworkspace.PrepareWrite("server", "/tmp/report.txt", before, after, true)
	require.NoError(t, err)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: actor, Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		Tasks: []PersistedTask{{View: TaskView{ID: "file", ToolName: "write_file", Status: TaskStatusWaitingConfirm, File: &file.FileSummary, Artifact: file}}},
	}
	require.NoError(t, store.Save(ctx, snapshot))
	var row AISessionTaskRecord
	require.NoError(t, db.Where("session_id=?", snapshot.ID).Take(&row).Error)
	require.NotNil(t, row.ArtifactContentID)
	require.Nil(t, row.ContentID)
	require.NotContains(t, string(row.Payload), `"artifact"`)
	ref, err := store.TaskFile(ctx, actor, snapshot.ID, "file")
	require.NoError(t, err)
	bodies := store.(*gormSessionStore).bodies
	var raw []byte
	for int64(len(raw)) < ref.Size {
		input := protocol.ContentReadInput{Sha256: ref.Sha256, Offset: int64(len(raw)), Limit: 65537}
		chunk, err := bodies.Read(ctx, ref.ID, input)
		require.NoError(t, err)
		require.NoError(t, contentstore.ValidateChunk(ref, input, chunk))
		data, err := base64.StdEncoding.DecodeString(chunk.Data)
		require.NoError(t, err)
		raw = append(raw, data...)
	}
	require.Equal(t, ref.Sha256, aiworkspace.Hash(string(raw)))
	var restored aiworkspace.FileArtifact
	require.NoError(t, json.Unmarshal(raw, &restored))
	require.Equal(t, *file, restored)
	saved, err := store.Get(ctx, actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, file, saved.Tasks[0].View.Artifact)

	// Updating tool state must not duplicate its unchanged file snapshot.
	snapshot.Tasks[0].View.Status = TaskStatusSucceeded
	snapshot.UpdatedAt = now.Add(time.Second)
	require.NoError(t, store.Save(ctx, snapshot))
	same, err := store.TaskFile(ctx, actor, snapshot.ID, "file")
	require.NoError(t, err)
	require.Equal(t, ref, same)
	var count int64
	require.NoError(t, db.Model(&content.Record{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	_, err = store.TaskFile(ctx, testAIActor(uuid.New()), snapshot.ID, "file")
	require.ErrorIs(t, err, ErrSessionNotFound)

	snapshot.Tasks[0].View.Artifact = nil
	snapshot.UpdatedAt = now.Add(2 * time.Second)
	require.NoError(t, store.Save(ctx, snapshot))
	_, err = store.TaskFile(ctx, actor, snapshot.ID, "file")
	require.ErrorIs(t, err, ErrTaskNotFound)
	_, err = bodies.Reference(ctx, ref.ID)
	require.ErrorIs(t, err, content.ErrNotFound)
	require.NoError(t, bodies.Cleanup(context.Background()))
	require.NoError(t, db.Model(&content.Record{}).Count(&count).Error)
	require.Zero(t, count)
}
