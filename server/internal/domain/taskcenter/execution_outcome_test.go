package taskcenter

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"
)

func TestExecutionObservationIsIdempotentAndPreservesEndTime(t *testing.T) {
	db := newTaskCenterTestDB(t)
	repo := NewRepository(db, nil)
	s := NewService(repo, nil)
	ctx, actor := taskTestContext(t)
	started := time.Now().Add(-2 * time.Minute).UTC().Truncate(time.Millisecond)
	finished := started.Add(time.Minute)
	run := TaskRun{Actor: actor, TaskType: "command", Title: "observed", SourceType: "scheduled_task", SourceID: uuid.NewString(), Status: StatusRunning, StartedAt: &started}
	if err := s.Create(ctx, &run); err != nil {
		t.Fatal(err)
	}
	// Persistence is internal bookkeeping and must still work after a lease ends.
	for i := 0; i < 2; i++ {
		if err := s.CompleteExecution(context.Background(), run, StatusSucceeded, "[]", "", "", 1, 0, finished); err != nil {
			t.Fatal(err)
		}
	}
	got, err := repo.GetAny(ctx, run.ID)
	if err != nil || got.Status != StatusSucceeded || got.FinishedAt == nil || !got.FinishedAt.Equal(finished) {
		t.Fatalf("observation: %+v %v", got, err)
	}
	var activity operationrecord.OperationRecord
	if err := db.Where("source_table = ? AND source_id = ?", "task_runs", run.ID.String()).First(&activity).Error; err != nil {
		t.Fatal(err)
	}
	if activity.DurationMs != 60000 || activity.FinishedAt == nil || !activity.FinishedAt.Equal(finished) {
		t.Fatalf("storage retry changed activity time: %+v", activity)
	}
	var count int64
	if err := db.Model(&TaskEvent{}).Where("task_run_id = ?", run.ID).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("duplicated terminal event: %d %v", count, err)
	}
	if err := s.CompleteExecution(ctx, run, StatusFailed, "[]", "", "late rejection", 0, 1, finished); !errors.Is(err, ErrObservedOutcomeConflict) {
		t.Fatalf("conflicting outcome: %v", err)
	}
	if err := s.CompleteExecution(ctx, run, StatusSucceeded, "[]", "", "", 1, 0, finished.Add(time.Second)); !errors.Is(err, ErrObservedOutcomeConflict) {
		t.Fatalf("completion time rewritten: %v", err)
	}
}

func TestExecutionObservationRejectsForeignOwnershipBeforeWriting(t *testing.T) {
	db := newTaskCenterTestDB(t)
	s := NewService(NewRepository(db, nil), nil)
	ctx, actor := taskTestContext(t)
	run := TaskRun{Actor: actor, TaskType: "command", Title: "original", SourceType: "scheduled_task", SourceID: uuid.NewString(), Status: StatusRunning}
	if err := s.Create(ctx, &run); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*TaskRun){
		func(r *TaskRun) { r.Actor.SessionID = uuid.NewString(); r.Actor.ID = r.Actor.SessionID },
		func(r *TaskRun) { r.SourceID = uuid.NewString() },
		func(r *TaskRun) { r.SourceType = "batch_task" },
		func(r *TaskRun) { r.TaskType = "script" },
	} {
		other := run
		mutate(&other)
		if err := s.CompleteExecution(context.Background(), other, StatusSucceeded, "[]", "", "", 1, 0, time.Now()); !errors.Is(err, ErrObservedOutcomeConflict) {
			t.Fatalf("foreign outcome: %v", err)
		}
	}
	got, err := s.Get(ctx, run.ID)
	if err != nil || got.Status != StatusRunning || got.FinishedAt != nil {
		t.Fatalf("foreign completion modified original: %+v %v", got, err)
	}
}

type startDuringCancelRead struct {
	Repository
	start func() error
}

func (r *startDuringCancelRead) Get(ctx context.Context, id uuid.UUID) (*TaskRun, error) {
	run, err := r.Repository.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if r.start != nil {
		start := r.start
		r.start = nil
		if err := start(); err != nil {
			return nil, err
		}
	}
	return run, nil
}

func TestCancelRacingStartDoesNotInventUnstartedCancellation(t *testing.T) {
	db := newTaskCenterTestDB(t)
	repo := &startDuringCancelRead{Repository: NewRepository(db, nil)}
	s := NewService(repo, nil)
	ctx, actor := taskTestContext(t)
	run := TaskRun{Actor: actor, TaskType: "command", Title: "starting", Status: StatusQueued, Cancelable: true}
	if err := s.Create(ctx, &run); err != nil {
		t.Fatal(err)
	}
	repo.start = func() error { return s.Start(ctx, run.ID, "executing") }
	s.SetCanceler(&successfulCanceler{})
	if err := s.RequestCancel(ctx, run.ID); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetAny(ctx, run.ID)
	if err != nil || got.Status != StatusCanceling || got.StartedAt == nil || got.FinishedAt != nil {
		t.Fatalf("a stale queued read settled an active command: %+v %v", got, err)
	}
}

func TestDeletionObservationPreservesChildrenAndRejectsReclassification(t *testing.T) {
	db := newTaskCenterTestDB(t)
	s := NewService(NewRepository(db, nil), nil)
	ctx, actor := taskTestContext(t)
	run := TaskRun{Actor: actor, TaskType: "sftp_recursive_delete", Title: "delete", SourceType: "sftp_delete", SourceID: uuid.NewString(), Status: StatusRunning}
	if err := s.Create(ctx, &run); err != nil {
		t.Fatal(err)
	}
	finished := time.Now().UTC().Truncate(time.Microsecond)
	result := `{"effects":{"files_removed":1,"uncertain_path":"/tmp/b","receipts":[{"path":"/tmp/a","outcome":"removed"},{"path":"/tmp/b","outcome":"unknown"}]}}`
	for i := 0; i < 2; i++ {
		if err := s.CompleteExecution(context.Background(), run, StatusUnknown, result, "delete_outcome_unknown", "lost response", 0, 0, finished); err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.Get(ctx, run.ID)
	if err != nil || got.ResultJSON != result || got.Status != StatusUnknown || got.Retryable {
		t.Fatalf("lost observed child outcomes: %+v %v", got, err)
	}
	if err := s.CompleteExecution(ctx, run, StatusCanceled, "", "", "", 0, 0, finished); !errors.Is(err, ErrObservedOutcomeConflict) {
		t.Fatalf("unknown rewritten as cancellation: %v", err)
	}
}

func TestQueuedDeletionCancellationIsSettledByItsExecutor(t *testing.T) {
	db := newTaskCenterTestDB(t)
	repo := NewRepository(db, nil)
	s := NewService(repo, nil)
	ctx, actor := taskTestContext(t)
	run := TaskRun{Actor: actor, TaskType: "sftp_recursive_delete", Title: "delete", SourceType: "sftp_delete", SourceID: uuid.NewString(), Status: StatusQueued, Cancelable: true}
	if err := s.Create(ctx, &run); err != nil {
		t.Fatal(err)
	}
	calls := 0
	s.SetCanceler(CancelHandlerFunc(func(_ context.Context, id uuid.UUID) error {
		calls++
		if id != run.ID {
			t.Fatal("wrong executor identity")
		}
		return nil
	}))
	if err := s.RequestCancel(ctx, run.ID); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetAny(ctx, run.ID)
	if err != nil || calls != 1 || got.Status != StatusCanceling || got.FinishedAt != nil {
		t.Fatalf("task center replaced source observation: %+v %v", got, err)
	}
	result := `{"unprocessed":2,"effects":{"receipts":[]}}`
	if err := s.CompleteExecution(context.Background(), run, StatusCanceled, result, "delete_canceled", "canceled before start", 0, 0, time.Now().UTC().Truncate(time.Microsecond)); err != nil {
		t.Fatal(err)
	}
	got, err = repo.GetAny(ctx, run.ID)
	if err != nil || got.ResultJSON != result || got.Status != StatusCanceled {
		t.Fatalf("executor observation lost: %+v %v", got, err)
	}
}
