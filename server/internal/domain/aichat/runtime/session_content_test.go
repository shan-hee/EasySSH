package runtime

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestLargeAIItemsUseFilesAndUnchangedSaveReusesReferences(t *testing.T) {
	db, store := sessionItemsFixture(t)
	now := time.Now().UTC()
	large := strings.Repeat("large history ", 5000)
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		MessageViews: []MessageView{{ID: "message", Role: "assistant", Content: large}},
		Messages:     []provider.Message{{Role: "assistant", Content: large}},
		Tasks:        []PersistedTask{{View: TaskView{ID: "tool", ToolName: "create_artifact", Status: TaskStatusSucceeded, Artifact: &aiworkspace.FileArtifact{Content: large}}}},
	}
	require.NoError(t, store.Save(context.Background(), snapshot))
	refs := map[string]uuid.UUID{}
	for _, table := range []string{"ai_messages", "ai_model_messages", "ai_session_tasks"} {
		var row sessionItemRecord
		require.NoError(t, db.Table(table).Where("session_id=?", snapshot.ID).Take(&row).Error)
		id := row.ContentID
		if table == "ai_session_tasks" {
			id = row.ArtifactContentID
			require.Nil(t, row.ContentID, "private task retained its artifact body")
			require.NotContains(t, string(row.Payload), large)
		} else {
			require.Equal(t, "null", string(row.Payload), "database retained the large item")
		}
		require.NotNil(t, id)
		refs[table] = *id
	}
	require.NoError(t, store.Save(context.Background(), snapshot))
	var count int64
	require.NoError(t, db.Model(&content.Record{}).Count(&count).Error)
	require.EqualValues(t, 3, count, "identical save created new body files")
	for table, id := range refs {
		var row sessionItemRecord
		require.NoError(t, db.Table(table).Where("session_id=?", snapshot.ID).Take(&row).Error)
		storedID := row.ContentID
		if table == "ai_session_tasks" {
			storedID = row.ArtifactContentID
		}
		require.NotNil(t, storedID)
		require.Equal(t, id, *storedID)
	}
	saved, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, large, saved.MessageViews[0].Content)
	require.Equal(t, large, saved.Messages[0].Content)
	require.Equal(t, large, saved.Tasks[0].View.Artifact.Content)
	page, err := store.History(context.Background(), snapshot.Actor, snapshot.ID, protocol.AIHistoryInput{Kind: "messages"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Empty(t, page.Items[0].Data)

	// Replacing with an inline item clears its old reference. The existing
	// retention pass collects all bodies no longer referenced by any item.
	snapshot.MessageViews[0].Content = "small"
	snapshot.Messages, snapshot.Tasks = nil, nil
	snapshot.UpdatedAt = now.Add(time.Second)
	require.NoError(t, store.Save(context.Background(), snapshot))
	require.NoError(t, store.(*gormSessionStore).bodies.Cleanup(context.Background()))
	require.NoError(t, db.Model(&content.Record{}).Count(&count).Error)
	require.Zero(t, count)
	saved, err = store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, "small", saved.MessageViews[0].Content)
}

func TestLargeAIItemFailureRollsBackReferenceAndMetadata(t *testing.T) {
	db, store := sessionItemsFixture(t)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		MessageViews: []MessageView{{ID: "one", Role: "user", Content: "original"}},
	}
	require.NoError(t, store.Save(context.Background(), snapshot))
	snapshot.MessageViews[0].Content = strings.Repeat("large", 10000)
	snapshot.MessageViews = append(snapshot.MessageViews, snapshot.MessageViews[0])
	snapshot.UpdatedAt = now.Add(time.Second)
	require.Error(t, store.Save(context.Background(), snapshot))
	var count int64
	require.NoError(t, db.Model(&content.Record{}).Count(&count).Error)
	require.Zero(t, count, "file metadata escaped rollback")
	saved, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, now, saved.UpdatedAt)
	require.Equal(t, "original", saved.MessageViews[0].Content)
	require.NoError(t, store.(*gormSessionStore).bodies.Cleanup(context.Background()))
}

func TestSyncedOwnerRevisionReusesItsLargeBodyAcrossLoginSessions(t *testing.T) {
	db, store := sessionItemsFixture(t)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		MessageViews: []MessageView{{ID: "one", Role: "user", ExternalContent: true, Content: strings.Repeat("history", 10000)}},
	}
	require.NoError(t, store.Save(context.Background(), snapshot))
	snapshot.Actor.SessionID = "sync-import"
	snapshot.UpdatedAt = now.Add(time.Second)
	bodies := store.(*gormSessionStore).bodies
	require.NoError(t, bodies.WithStorage(func() error {
		return db.Transaction(func(tx *gorm.DB) error { return ReplaceSyncedSession(tx, snapshot, bodies) })
	}))
	saved, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, snapshot.MessageViews, saved.MessageViews)
	var count int64
	require.NoError(t, db.Model(&content.Record{}).Count(&count).Error)
	require.EqualValues(t, 1, count, "sync duplicated an unchanged body")
}
