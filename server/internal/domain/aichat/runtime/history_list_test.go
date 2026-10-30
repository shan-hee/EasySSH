package runtime

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/shared/aichatui"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestHistoryListSearchesVisibleIndexWithoutLoadingPayloads(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&AISessionRecord{}, &AIMessageRecord{}, &AIModelMessageRecord{}, &AISessionTaskRecord{}, &ToolExecutionRecord{}))
	raw, err := db.DB()
	require.NoError(t, err)
	defer raw.Close()
	store := newGormTestSessionStore(t, db)
	actor := testAIActor(uuid.New())
	now := time.Now().UTC()
	first := SessionSnapshot{ID: uuid.NewString(), Actor: actor, Status: SessionStatusIdle, CreatedAt: now, UpdatedAt: now, MessageViews: []MessageView{{ID: "user", Role: "user", Content: "ÄBC 100%_!", Attachments: []aichatui.AttachmentView{{Name: "attachment-only", Data: "attachment-private"}}}, {ID: "reply", Role: "assistant", Content: "latest answer"}}, Tasks: []PersistedTask{{View: TaskView{ID: "tool"}}}}
	require.NoError(t, store.Save(context.Background(), first))
	other := first
	other.ID = uuid.NewString()
	other.MessageViews = []MessageView{{ID: "other", Role: "user", Content: "not matching"}}
	other.Tasks = nil
	require.NoError(t, store.Save(context.Background(), other))
	// A list projection must not deserialize the provider/task/attachment payload.
	require.NoError(t, db.Model(&AIMessageRecord{}).Where("session_id=?", first.ID).Update("payload", "not-json").Error)
	for _, query := range []string{"äbc", "%_!"} {
		items, total, err := store.List(context.Background(), actor, query, 10, 0, SessionScope{})
		require.NoError(t, err)
		require.EqualValues(t, 1, total)
		require.Len(t, items, 1)
		require.Equal(t, first.ID, items[0].ID)
		require.Equal(t, actor, items[0].Actor)
		require.Equal(t, 2, items[0].MessageCount)
		require.Equal(t, 1, items[0].TaskCount)
		require.Contains(t, items[0].Preview, "ÄBC 100%_!")
	}
	for _, query := range []string{"attachment-only", "attachment-private", "content", "messages", "not-json"} {
		_, total, err := store.List(context.Background(), actor, query, 10, 0, SessionScope{})
		require.NoError(t, err)
		require.Zero(t, total)
	}
	_, _, err = store.List(context.Background(), actor, strings.Repeat("x", aichatui.MaxSessionSearchBytes+1), 10, 0, SessionScope{})
	require.ErrorIs(t, err, aichatui.ErrSessionSearchTooLong)
}

func TestHistorySourceAndIndexRollbackTogether(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&AISessionRecord{}, &AIMessageRecord{}, &AIModelMessageRecord{}, &AISessionTaskRecord{}, &ToolExecutionRecord{}))
	raw, err := db.DB()
	require.NoError(t, err)
	defer raw.Close()
	store := newGormTestSessionStore(t, db)
	now := time.Now().UTC()
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: testAIActor(uuid.New()), CreatedAt: now, UpdatedAt: now, MessageViews: []MessageView{{ID: "user", Role: "user", Content: "original"}}}
	require.NoError(t, store.Save(context.Background(), snapshot))
	require.NoError(t, db.Exec(`CREATE TRIGGER reject_ai_index BEFORE UPDATE ON ai_sessions WHEN NEW.preview='changed' BEGIN SELECT RAISE(ABORT,'index failed'); END`).Error)
	snapshot.MessageViews[0].Content = "changed"
	snapshot.UpdatedAt = now.Add(time.Second)
	require.Error(t, store.Save(context.Background(), snapshot))
	source, err := store.Get(context.Background(), snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, "original", source.MessageViews[0].Content)
	rows, total, err := store.List(context.Background(), snapshot.Actor, "original", 10, 0, SessionScope{})
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Equal(t, "original", rows[0].Preview)
	_, total, err = store.List(context.Background(), snapshot.Actor, "changed", 10, 0, SessionScope{})
	require.NoError(t, err)
	require.Zero(t, total)
}
