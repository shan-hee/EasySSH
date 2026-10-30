package runtime

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/aichatui"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func executionStoreFixture(t *testing.T) (*gorm.DB, SessionStore, SessionSnapshot) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	raw, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = raw.Close() })
	require.NoError(t, db.AutoMigrate(&AISessionRecord{}, &AIMessageRecord{}, &AIModelMessageRecord{}, &AISessionTaskRecord{}, &ToolExecutionRecord{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}))
	now := time.Now().UTC().Truncate(time.Millisecond)
	actor := testAIActor(uuid.New())
	snapshot := SessionSnapshot{ID: uuid.NewString(), Actor: actor, Status: SessionStatusRunning, CreatedAt: now, UpdatedAt: now, Tasks: []PersistedTask{{Execution: &ExecutionOrigin{Actor: actor, ServerID: uuid.New(), ServerName: "original name"}, View: TaskView{ID: uuid.NewString(), ToolName: "execute_command", Status: TaskStatusQueued, CreatedAt: now, UpdatedAt: now}}}}
	return db, newGormTestSessionStore(t, db), snapshot
}

func TestAIExecutionProjectionIsAtomicAndCannotRecreatePrunedActivity(t *testing.T) {
	db, store, snapshot := executionStoreFixture(t)
	ctx := context.Background()
	require.NoError(t, store.Save(ctx, snapshot))
	require.NoError(t, db.Exec(`CREATE TRIGGER reject_ai_activity BEFORE UPDATE ON operation_records WHEN NEW.status='success' BEGIN SELECT RAISE(ABORT,'projection unavailable'); END`).Error)
	snapshot.Tasks[0].View.Status = TaskStatusSucceeded
	snapshot.UpdatedAt = snapshot.UpdatedAt.Add(time.Second)
	snapshot.Tasks[0].View.UpdatedAt = snapshot.UpdatedAt
	require.Error(t, store.Save(ctx, snapshot))
	var fact ToolExecutionRecord
	require.NoError(t, db.First(&fact).Error)
	require.Equal(t, TaskStatusQueued, fact.Status)
	saved, err := store.Get(ctx, snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, TaskStatusQueued, saved.Tasks[0].View.Status)
	require.NoError(t, db.Exec(`DROP TRIGGER reject_ai_activity`).Error)
	require.NoError(t, store.Save(ctx, snapshot))
	var activity operationrecord.OperationRecord
	require.NoError(t, db.First(&activity).Error)
	require.Equal(t, "ai_execute_command", activity.Action)
	require.Equal(t, "original name", activity.ServerName)
	require.Equal(t, 1, activity.SuccessCount)
	require.NoError(t, db.Where("source_table=?", "ai_tool_executions").Unscoped().Delete(&operationrecord.OperationRecord{}).Error)
	// A title edit and exact receipt replay cannot bring pruned activity back.
	snapshot.Title = "edited"
	snapshot.UpdatedAt = snapshot.UpdatedAt.Add(time.Second)
	require.NoError(t, store.Save(ctx, snapshot))
	require.NoError(t, store.Save(ctx, snapshot))
	var count int64
	require.NoError(t, db.Model(&operationrecord.OperationRecord{}).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, store.Delete(ctx, snapshot.Actor, snapshot.ID))
	require.NoError(t, db.Model(&ToolExecutionRecord{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestImportedAITasksDoNotCreateLocalExecutionFacts(t *testing.T) {
	db, store, snapshot := executionStoreFixture(t)
	snapshot.Tasks[0].Execution = nil
	snapshot.Tasks[0].View.Status = TaskStatusSucceeded
	require.NoError(t, store.Save(context.Background(), snapshot))
	var count int64
	require.NoError(t, db.Model(&ToolExecutionRecord{}).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, db.Model(&operationrecord.OperationRecord{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestAIExecutionRecoveryPreservesUnknownAndDoesNotReplay(t *testing.T) {
	db, store, snapshot := executionStoreFixture(t)
	ctx := context.Background()
	snapshot.Tasks[0].View.Status = TaskStatusRunning
	require.NoError(t, store.Save(ctx, snapshot))
	require.NoError(t, RecoverInterrupted(ctx, db, store.(*gormSessionStore).bodies))
	require.NoError(t, RecoverInterrupted(ctx, db, store.(*gormSessionStore).bodies))
	var row ToolExecutionRecord
	require.NoError(t, db.First(&row).Error)
	require.Equal(t, TaskStatusUnknown, row.Status)
	require.NotNil(t, row.RecoveredAt)
	require.True(t, row.FinishedAt.Equal(snapshot.Tasks[0].View.UpdatedAt))
	var activity operationrecord.OperationRecord
	require.NoError(t, db.First(&activity).Error)
	require.Equal(t, operationrecord.StatusUnknown, activity.Status)
	require.Zero(t, activity.FailureCount)
	stored, err := store.Get(ctx, snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, SessionStatusIdle, stored.Status)
	require.Equal(t, TaskStatusUnknown, stored.Tasks[0].View.Status)
	normalizeRestoredSnapshot(&snapshot)
	require.NoError(t, store.Save(ctx, snapshot))
	snapshot.Tasks[0].View.Status = TaskStatusSucceeded
	require.ErrorIs(t, store.Save(ctx, snapshot), ErrSnapshotConflict)
}

func TestAIExecutionOriginDoesNotTrustClientServerName(t *testing.T) {
	m, _, ctx, _ := newPersistenceFixture(t)
	target := uuid.NewString()
	m.SetServerReferenceResolver(func(_ context.Context, refs []aichatui.ServerReference) ([]aichatui.ServerReference, error) {
		require.Len(t, refs, 1)
		require.Empty(t, refs[0].Name)
		return nil, errors.New("target denied")
	})
	origin, err := m.executionOrigin(ctx, registry.ToolCall{Name: "execute_command", Arguments: []byte(`{"server_id":"` + target + `","server_name":"forged"}`)})
	require.Error(t, err)
	require.NotNil(t, origin)
	require.Equal(t, uuid.Nil, origin.ServerID)
	require.Empty(t, origin.ServerName)
}

func TestRemovingPendingAIWorkCancelsFactsButKeepsCompletedFacts(t *testing.T) {
	for _, deleteSession := range []bool{false, true} {
		db, store, snapshot := executionStoreFixture(t)
		ctx := context.Background()
		snapshot.Tasks[0].View.Status = TaskStatusWaitingConfirm
		require.NoError(t, store.Save(ctx, snapshot))
		if deleteSession {
			require.NoError(t, store.Delete(ctx, snapshot.Actor, snapshot.ID))
		} else {
			snapshot.Tasks = nil
			snapshot.UpdatedAt = snapshot.UpdatedAt.Add(time.Second)
			require.NoError(t, store.Save(ctx, snapshot))
		}
		var fact ToolExecutionRecord
		require.NoError(t, db.First(&fact).Error)
		require.Equal(t, TaskStatusCancelled, fact.Status)
		var activity operationrecord.OperationRecord
		require.NoError(t, db.First(&activity).Error)
		require.Equal(t, operationrecord.StatusCanceled, activity.Status)
		require.Zero(t, activity.FailureCount)
	}
}

func TestDroppingRunningExecutionCannotEraseItsSource(t *testing.T) {
	db, store, snapshot := executionStoreFixture(t)
	snapshot.Tasks[0].View.Status = TaskStatusRunning
	require.NoError(t, store.Save(context.Background(), snapshot))
	snapshot.Tasks = nil
	snapshot.UpdatedAt = snapshot.UpdatedAt.Add(time.Second)
	require.ErrorIs(t, store.Save(context.Background(), snapshot), ErrSessionBusy)
	require.ErrorIs(t, store.Delete(context.Background(), snapshot.Actor, snapshot.ID), ErrSessionBusy)
	var fact ToolExecutionRecord
	require.NoError(t, db.First(&fact).Error)
	require.Equal(t, TaskStatusRunning, fact.Status)
}

func TestAIStartupRecoveryPreservesWaitingOnlyConversation(t *testing.T) {
	db, store, snapshot := executionStoreFixture(t)
	ctx := context.Background()
	snapshot.Status = SessionStatusWaitingConfirmation
	snapshot.Tasks[0].View.Status = TaskStatusWaitingConfirm
	require.NoError(t, store.Save(ctx, snapshot))
	require.NoError(t, RecoverInterrupted(ctx, db, store.(*gormSessionStore).bodies))
	saved, err := store.Get(ctx, snapshot.Actor, snapshot.ID)
	require.NoError(t, err)
	require.Equal(t, SessionStatusWaitingConfirmation, saved.Status)
	require.Equal(t, TaskStatusWaitingConfirm, saved.Tasks[0].View.Status)
	var source ToolExecutionRecord
	require.NoError(t, db.First(&source).Error)
	require.Equal(t, TaskStatusWaitingConfirm, source.Status)
	require.Nil(t, source.RecoveredAt)
}
