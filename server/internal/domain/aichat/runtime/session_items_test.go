package runtime

import (
	"context"
	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func sessionItemsFixture(t *testing.T) (*gorm.DB, SessionStore) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&AISessionRecord{}, &AIMessageRecord{}, &AIModelMessageRecord{}, &AISessionTaskRecord{}, &ToolExecutionRecord{}))
	raw, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = raw.Close() })
	return db, newGormTestSessionStore(t, db)
}

func TestAIMessageAppendDoesNotRewritePreviousMessages(t *testing.T) {
	db, store := sessionItemsFixture(t)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		MessageViews: []MessageView{{ID: "first", Role: "user", Content: "original"}}, Messages: []provider.Message{{Role: "user", Content: "original"}},
	}
	require.NoError(t, store.Save(context.Background(), snapshot))
	require.NoError(t, db.Exec(`CREATE TRIGGER reject_old_message_update BEFORE UPDATE ON ai_messages WHEN OLD.item_id='first' BEGIN SELECT RAISE(ABORT,'old message rewritten'); END`).Error)
	require.NoError(t, db.Exec(`CREATE TRIGGER reject_old_model_update BEFORE UPDATE ON ai_model_messages WHEN OLD.item_id='0' BEGIN SELECT RAISE(ABORT,'old model message rewritten'); END`).Error)
	snapshot.MessageViews = append(snapshot.MessageViews, MessageView{ID: "second", Role: "assistant", Content: "new reply"})
	snapshot.Messages = append(snapshot.Messages, provider.Message{Role: "assistant", Content: "new reply"})
	snapshot.UpdatedAt = now.Add(time.Second)
	require.NoError(t, store.Save(context.Background(), snapshot))
	require.NoError(t, store.Save(context.Background(), snapshot), "identical replay must not rewrite message rows")
	saved, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, snapshot.MessageViews, saved.MessageViews)
	require.Equal(t, snapshot.Messages, saved.Messages)
}

func TestAIMessageWriteFailureRollsBackMetadataAndBody(t *testing.T) {
	db, store := sessionItemsFixture(t)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now, MessageViews: []MessageView{{ID: "one", Role: "user", Content: "original"}}}
	require.NoError(t, store.Save(context.Background(), snapshot))
	require.NoError(t, db.Exec(`CREATE TRIGGER reject_second_message BEFORE INSERT ON ai_messages WHEN NEW.item_id='two' BEGIN SELECT RAISE(ABORT,'message unavailable'); END`).Error)
	snapshot.MessageViews = append(snapshot.MessageViews, MessageView{ID: "two", Role: "assistant", Content: "uncommitted"})
	snapshot.Title = "uncommitted title"
	snapshot.UpdatedAt = now.Add(time.Second)
	require.Error(t, store.Save(context.Background(), snapshot))
	var metadata AISessionRecord
	require.NoError(t, db.First(&metadata, "id=?", snapshot.ID).Error)
	require.Empty(t, metadata.Title)
	require.Equal(t, 1, metadata.MessageCount)
	saved, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Len(t, saved.MessageViews, 1)
}

func TestAIMessageEditAndTruncationDeleteOnlyAffectedRows(t *testing.T) {
	db, store := sessionItemsFixture(t)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now,
		MessageViews: []MessageView{{ID: "one", Role: "user", Content: "one"}, {ID: "two", Role: "assistant", Content: "two"}},
		Tasks:        []PersistedTask{{View: TaskView{ID: "task", Status: TaskStatusSucceeded}}}, TaskOrder: []string{"task"},
	}
	require.NoError(t, store.Save(context.Background(), snapshot))
	snapshot.MessageViews = snapshot.MessageViews[:1]
	snapshot.MessageViews[0].Content = "edited"
	snapshot.Tasks = nil
	snapshot.TaskOrder = nil
	snapshot.UpdatedAt = now.Add(time.Second)
	require.NoError(t, store.Save(context.Background(), snapshot))
	saved, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Len(t, saved.MessageViews, 1)
	require.Equal(t, "edited", saved.MessageViews[0].Content)
	require.Empty(t, saved.Tasks)
	var count int64
	require.NoError(t, db.Model(&AISessionTaskRecord{}).Where("session_id=?", snapshot.ID).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, store.Delete(context.Background(), snapshot.Actor, snapshot.ID))
	require.NoError(t, db.Model(&AIMessageRecord{}).Where("session_id=?", snapshot.ID).Count(&count).Error)
	require.Zero(t, count)
	_, err = store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.ErrorIs(t, err, ErrSessionNotFound)
}

func TestAISyncReplaceUsesMessageRowsAndRejectsNativeProvenance(t *testing.T) {
	db, store := sessionItemsFixture(t)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), CreatedAt: now, UpdatedAt: now, MessageViews: []MessageView{{ID: "imported", Role: "user", Content: "history"}}}
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ReplaceSyncedSession(tx, snapshot, store.(*gormSessionStore).bodies) }))
	saved, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, "readonly", saved.PermissionMode)
	require.Len(t, saved.MessageViews, 1)
	snapshot.Tasks = []PersistedTask{{Execution: &ExecutionOrigin{Actor: snapshot.Actor}, View: TaskView{ID: "forged", Status: TaskStatusSucceeded}}}
	require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error { return ReplaceSyncedSession(tx, snapshot, store.(*gormSessionStore).bodies) }), ErrSnapshotConflict)
}

func newGormTestSessionStore(t *testing.T, db *gorm.DB) SessionStore {
	t.Helper()
	require.NoError(t, db.AutoMigrate(&content.Record{}, &taskcenter.NotificationDelivery{}, &taskcenter.TaskRun{}, &taskcenter.TaskEvent{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}))
	bodies, err := content.New(db, t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() { _ = bodies.Close() })
	return NewGormSessionStore(db, bodies)
}
