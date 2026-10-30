package batchtask

import (
	"context"
	"errors"
	"fmt"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/operationrecord"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type dispatchTestAuthority struct {
	testutil.AccessPolicy
}

func (dispatchTestAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func dispatchContext(t *testing.T, actor protocol.Actor) context.Context {
	t.Helper()
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), dispatchTestAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}
func dispatchActor() protocol.Actor {
	id := uuid.NewString()
	return protocol.Actor{Kind: protocol.Visitor, ID: id, SessionID: id, GrantID: uuid.NewString()}
}
func dispatchDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&BatchTask{}, &taskcenter.NotificationDelivery{}, &taskcenter.TaskRun{}, &taskcenter.TaskEvent{}, &jobqueue.Job{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}, &serverdomain.Server{}); err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	return db
}
func dispatchDraft(t *testing.T, db *gorm.DB, actor protocol.Actor) *BatchTask {
	t.Helper()
	draft := &BatchTask{Actor: actor, TaskName: "status", TaskType: "command", Content: "uptime", ServerIDs: []string{uuid.NewString()}, ExecutionMode: "parallel", Status: "pending"}
	if err := db.Create(draft).Error; err != nil {
		t.Fatal(err)
	}
	return draft
}
func countDispatchRows(t *testing.T, db *gorm.DB, model any) int64 {
	t.Helper()
	var n int64
	if err := db.Model(model).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}
func TestDispatchCommitsSourceRunEventsActivityAndQueueOnce(t *testing.T) {
	db := dispatchDB(t)
	actor := dispatchActor()
	ctx := dispatchContext(t, actor)
	draft := dispatchDraft(t, db, actor)
	repo := NewRepository(db, nil)
	run, err := repo.Dispatch(ctx, draft)
	if err != nil {
		t.Fatal(err)
	}
	if run.ID != draft.ID || run.WorkID != draft.ID || run.Actor != actor || run.Status != taskcenter.StatusQueued {
		t.Fatalf("run: %+v", run)
	}
	if draft.Status != "pending" {
		t.Fatal("dispatch mutated caller's observed draft")
	}
	stored, err := repo.GetByID(ctx, draft.ID)
	if err != nil || stored.Status != "queued" {
		t.Fatalf("source: %+v %v", stored, err)
	}
	var queued jobqueue.Job
	if err := db.First(&queued, "id = ?", draft.ID).Error; err != nil {
		t.Fatal(err)
	}
	if queued.Actor != actor || queued.SourceType != "task_run" || queued.SourceID != draft.ID.String() || queued.Kind != "batch.execute" || queued.MaxAttempts != 1 || queued.DedupeKey == nil || *queued.DedupeKey != "batch.execute:"+draft.ID.String() {
		t.Fatalf("dispatch lost origin or permits replay: %+v", queued)
	}
	for model, expected := range map[any]int64{&taskcenter.TaskRun{}: 1, &taskcenter.TaskEvent{}: 1, &jobqueue.Job{}: 1, &operationrecord.OperationRecord{}: 2} {
		if n := countDispatchRows(t, db, model); n != expected {
			t.Fatalf("%T rows = %d expected %d", model, n, expected)
		}
	}
	if _, err := repo.Dispatch(ctx, draft); err == nil {
		t.Fatal("duplicate execution accepted")
	}
	if countDispatchRows(t, db, &jobqueue.Job{}) != 1 || countDispatchRows(t, db, &taskcenter.TaskRun{}) != 1 {
		t.Fatal("duplicate dispatch created another run")
	}
}
func TestDispatchFailureRollsBackEveryPersistedLayer(t *testing.T) {
	for _, table := range []string{"task_events", "operation_records", "operation_resources", "job_queue"} {
		t.Run(table, func(t *testing.T) {
			db := dispatchDB(t)
			actor := dispatchActor()
			ctx := dispatchContext(t, actor)
			draft := dispatchDraft(t, db, actor)
			if err := db.Migrator().DropTable(table); err != nil {
				t.Fatal(err)
			}
			run, err := NewRepository(db, nil).Dispatch(ctx, draft)
			if err == nil || run != nil {
				t.Fatal("partial transaction reported success")
			}
			stored, err := NewRepository(db, nil).GetByID(ctx, draft.ID)
			if err != nil || stored.Status != "pending" || stored.Actor != actor {
				t.Fatalf("failed dispatch changed draft: %+v %v", stored, err)
			}
			if countDispatchRows(t, db, &taskcenter.TaskRun{}) != 0 {
				t.Fatal("task run survived failed outbox transaction")
			}
			for _, remaining := range []string{"task_events", "operation_records", "operation_resources", "job_queue"} {
				if remaining == table {
					continue
				}
				var count int64
				if err := db.Table(remaining).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("partial %s rows=%d err=%v", remaining, count, err)
				}
			}
		})
	}
}
func TestDispatchRejectsEditsAfterAuthorizationAndOtherActors(t *testing.T) {
	db := dispatchDB(t)
	actor := dispatchActor()
	ctx := dispatchContext(t, actor)
	draft := dispatchDraft(t, db, actor)
	repo := NewRepository(db, nil)
	if _, err := repo.Dispatch(dispatchContext(t, dispatchActor()), draft); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("foreign actor claimed draft: %v", err)
	}
	if err := db.Model(&BatchTask{}).Where("id = ?", draft.ID).Update("content", "rm -rf changed-target").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := repo.Dispatch(ctx, draft); !errors.Is(err, access.ErrResourceChanged) {
		t.Fatalf("stale authorization dispatched edited code: %v", err)
	}
	if countDispatchRows(t, db, &jobqueue.Job{}) != 0 {
		t.Fatal("rejected work enqueued")
	}
}
func TestDispatchRejectsConflictingOutboxIdentity(t *testing.T) {
	db := dispatchDB(t)
	actor := dispatchActor()
	ctx := dispatchContext(t, actor)
	draft := dispatchDraft(t, db, actor)
	if err := db.Create(&jobqueue.Job{ID: draft.ID, Actor: dispatchActor(), Kind: "foreign", SourceType: "other", SourceID: "other", PayloadJSON: "{}"}).Error; err != nil {
		t.Fatal(err)
	}
	if run, err := NewRepository(db, nil).Dispatch(ctx, draft); err == nil || run != nil {
		t.Fatal("conflicting queue identity adopted")
	}
	stored, err := NewRepository(db, nil).GetByID(ctx, draft.ID)
	if err != nil || stored.Status != "pending" || countDispatchRows(t, db, &taskcenter.TaskRun{}) != 0 {
		t.Fatalf("conflict left partial work: %+v %v", stored, err)
	}
}

type dispatchQueue struct {
	jobqueue.Queue
	notified int
	notify   func()
}

func (q *dispatchQueue) NotifyEnqueued() {
	q.notified++
	if q.notify != nil {
		q.notify()
	}
}

type dispatchTasks struct {
	taskcenter.Service
	published int
	publish   func(*taskcenter.TaskRun)
}

func (s *dispatchTasks) PublishCreated(run *taskcenter.TaskRun) {
	s.published++
	if s.publish != nil {
		s.publish(run)
	}
}
func TestStartNotifiesOnlyAfterDurableCommit(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			db := dispatchDB(t)
			actor := dispatchActor()
			ctx := dispatchContext(t, actor)
			draft := dispatchDraft(t, db, actor)
			q := &dispatchQueue{notify: func() {
				if countDispatchRows(t, db, &jobqueue.Job{}) != 1 {
					t.Fatal("worker woke before durable dispatch")
				}
			}}
			runs := &dispatchTasks{publish: func(run *taskcenter.TaskRun) {
				if countDispatchRows(t, db, &jobqueue.Job{}) != 1 || run.Actor != actor {
					t.Fatal("uncommitted or misattributed event")
				}
			}}
			s := NewService(NewRepository(db, nil), nil)
			s.SetQueue(q)
			s.SetTaskCenter(runs)
			if fail {
				if err := db.Migrator().DropTable(&jobqueue.Job{}); err != nil {
					t.Fatal(err)
				}
			}
			err := s.StartBatchTask(ctx, draft.ID)
			if fail {
				if err == nil || q.notified != 0 || runs.published != 0 {
					t.Fatalf("failed dispatch published: %v %d %d", err, q.notified, runs.published)
				}
			} else if err != nil || q.notified != 1 || runs.published != 1 {
				t.Fatalf("committed dispatch unpublished: %v %d %d", err, q.notified, runs.published)
			}
		})
	}
}

func TestDispatchRebindsOnlySameOwnerToCurrentSession(t *testing.T) {
	db := dispatchDB(t)
	owner := protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}
	draft := dispatchDraft(t, db, owner)
	current := owner
	current.SessionID = uuid.NewString()
	run, err := NewRepository(db, nil).Dispatch(dispatchContext(t, current), draft)
	if err != nil || run.Actor != current {
		t.Fatalf("owner session attribution: %+v %v", run, err)
	}
	var queued jobqueue.Job
	if err := db.First(&queued, "id = ?", draft.ID).Error; err != nil || queued.Actor != current {
		t.Fatalf("queue actor: %+v %v", queued, err)
	}
}

func TestQueueRejectionCannotSettleForeignOrMisboundBatch(t *testing.T) {
	db := dispatchDB(t)
	actor := dispatchActor()
	ctx := dispatchContext(t, actor)
	draft := dispatchDraft(t, db, actor)
	repo := NewRepository(db, nil)
	if _, err := repo.Dispatch(ctx, draft); err != nil {
		t.Fatal(err)
	}
	var queued jobqueue.Job
	if err := db.First(&queued, "id = ?", draft.ID).Error; err != nil {
		t.Fatal(err)
	}
	s := NewService(repo, nil)
	s.SetTaskCenter(taskcenter.NewService(taskcenter.NewRepository(db, nil), nil))
	for _, mutate := range []func(*jobqueue.Job){
		func(j *jobqueue.Job) { j.PayloadJSON = `{"task_id":"` + uuid.NewString() + `"}` },
		func(j *jobqueue.Job) { j.SourceID = uuid.NewString() },
		func(j *jobqueue.Job) { j.ID = uuid.New() },
		func(j *jobqueue.Job) { j.MaxAttempts = 3 },
		func(j *jobqueue.Job) { j.Actor = dispatchActor() },
	} {
		bad := queued
		mutate(&bad)
		if err := s.HandleQueueJob(ctx, &bad); err == nil {
			t.Fatal("misbound dispatch entered executor")
		}
		stored, err := repo.GetByID(ctx, draft.ID)
		if err != nil || stored.Status != "queued" {
			t.Fatalf("foreign rejection changed source: %+v %v", stored, err)
		}
	}
	queue := jobqueue.NewRepository(db, nil, nil)
	if _, err := queue.Claim(ctx, "worker", time.Minute); err != nil {
		t.Fatal(err)
	}
	if _, err := queue.MarkRunning(ctx, queued.ID, "worker"); err != nil {
		t.Fatal(err)
	}
	if _, err := queue.Reject(context.Background(), queued.ID, "worker", "access revoked"); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.GetByID(ctx, draft.ID)
	if err != nil || stored.Status != "failed" {
		t.Fatalf("authorized rejection not projected: %+v %v", stored, err)
	}
}

func TestRunningBatchRejectionDefersToExecutionOutcome(t *testing.T) {
	db := dispatchDB(t)
	actor := dispatchActor()
	ctx := dispatchContext(t, actor)
	draft := dispatchDraft(t, db, actor)
	repo := NewRepository(db, nil)
	if _, err := repo.Dispatch(ctx, draft); err != nil {
		t.Fatal(err)
	}
	runs := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
	if err := runs.Start(ctx, draft.ID, "executing"); err != nil {
		t.Fatal(err)
	}
	var queued jobqueue.Job
	if err := db.First(&queued, "id = ?", draft.ID).Error; err != nil {
		t.Fatal(err)
	}
	queue := jobqueue.NewRepository(db, nil, nil)
	if _, err := queue.Claim(ctx, "worker", time.Minute); err != nil {
		t.Fatal(err)
	}
	if _, err := queue.MarkRunning(ctx, queued.ID, "worker"); err != nil {
		t.Fatal(err)
	}
	if _, err := queue.Reject(context.Background(), queued.ID, "worker", "access revoked"); err != nil {
		t.Fatal(err)
	}
	run, err := runs.Get(ctx, draft.ID)
	if err != nil || run.Status != taskcenter.StatusRunning || run.FinishedAt != nil {
		t.Fatalf("queue rejection overwrote admitted execution: %+v %v", run, err)
	}
	if err := runs.Complete(ctx, draft.ID, taskcenter.StatusUnknown, "", "execution_interrupted", "remote outcome unknown", 0, 0); err != nil {
		t.Fatal(err)
	}
	stats, err := repo.GetStatistics(ctx)
	if err != nil || stats.TotalTasks != 1 || stats.UnknownTasks != 1 || stats.FailedTasks != 0 {
		t.Fatalf("unknown batch missing from statistics: %+v %v", stats, err)
	}
}

func TestQueueTerminalStateSettlesOnlyUnstartedBatchInSameTransaction(t *testing.T) {
	for _, action := range []string{"fail", "reject", "lease_expired", "cancel", "complete_without_execution"} {
		t.Run(action, func(t *testing.T) {
			db := dispatchDB(t)
			actor := dispatchActor()
			ctx := dispatchContext(t, actor)
			draft := dispatchDraft(t, db, actor)
			if _, err := NewRepository(db, nil).Dispatch(ctx, draft); err != nil {
				t.Fatal(err)
			}
			queue := jobqueue.NewRepository(db, nil, nil)
			if action != "cancel" {
				job, err := queue.Claim(ctx, "worker", time.Minute)
				if err != nil || job.ID != draft.ID {
					t.Fatalf("claim: %+v %v", job, err)
				}
				if ok, err := queue.MarkRunning(ctx, draft.ID, "worker"); err != nil || !ok {
					t.Fatalf("mark running: %v %v", ok, err)
				}
			}
			switch action {
			case "fail":
				if ok, err := queue.Fail(ctx, draft.ID, "worker", "executor unavailable", time.Now()); err != nil || !ok {
					t.Fatalf("fail: %v %v", ok, err)
				}
			case "reject":
				if ok, err := queue.Reject(ctx, draft.ID, "worker", "access expired"); err != nil || !ok {
					t.Fatalf("reject: %v %v", ok, err)
				}
			case "lease_expired":
				if err := db.Model(&jobqueue.Job{}).Where("id = ?", draft.ID).Update("lease_expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
					t.Fatal(err)
				}
				if n, err := queue.RecoverExpiredLeases(ctx, time.Now()); err != nil || n != 1 {
					t.Fatalf("recovery: %d %v", n, err)
				}
			case "cancel":
				if ids, err := queue.CancelBySource(ctx, "task_run", draft.ID.String()); err != nil || len(ids) != 1 {
					t.Fatalf("cancel: %v %v", ids, err)
				}
			case "complete_without_execution":
				if ok, err := queue.Complete(ctx, draft.ID, "worker"); err != nil || !ok {
					t.Fatalf("complete: %v %v", ok, err)
				}
			}
			run, err := taskcenter.NewRepository(db, nil).GetAny(ctx, draft.ID)
			if err != nil {
				t.Fatal(err)
			}
			expected := taskcenter.StatusFailed
			if action == "cancel" {
				expected = taskcenter.StatusCanceled
			}
			if run.Status != expected || run.FinishedAt == nil || run.StartedAt != nil || run.Retryable || run.Actor != actor {
				t.Fatalf("unstarted outcome: %+v", run)
			}
			source, err := NewRepository(db, nil).GetByID(ctx, draft.ID)
			if err != nil || source.Status == "queued" {
				t.Fatalf("source left queued: %+v %v", source, err)
			}
		})
	}
}

func TestQueueFailureProjectionRollbackKeepsLeaseRecoverable(t *testing.T) {
	db := dispatchDB(t)
	actor := dispatchActor()
	ctx := dispatchContext(t, actor)
	draft := dispatchDraft(t, db, actor)
	if _, err := NewRepository(db, nil).Dispatch(ctx, draft); err != nil {
		t.Fatal(err)
	}
	queue := jobqueue.NewRepository(db, nil, nil)
	if _, err := queue.Claim(ctx, "worker", time.Minute); err != nil {
		t.Fatal(err)
	}
	if ok, err := queue.MarkRunning(ctx, draft.ID, "worker"); err != nil || !ok {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	if ok, err := queue.Fail(ctx, draft.ID, "worker", "dispatch failed", time.Now()); err == nil || ok {
		t.Fatal("queue committed without its source projection")
	}
	var job jobqueue.Job
	if err := db.First(&job, "id = ?", draft.ID).Error; err != nil {
		t.Fatal(err)
	}
	if job.Status != jobqueue.StatusRunning || job.ClaimedBy != "worker" || job.LeaseExpiresAt == nil {
		t.Fatalf("rollback destroyed lease: %+v", job)
	}
	run, err := taskcenter.NewRepository(db, nil).GetAny(ctx, draft.ID)
	if err != nil || run.Status != taskcenter.StatusQueued {
		t.Fatalf("task projection partially committed: %+v %v", run, err)
	}
	if err := db.AutoMigrate(&operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	if ok, err := queue.Fail(ctx, draft.ID, "worker", "dispatch failed", time.Now()); err != nil || !ok {
		t.Fatalf("storage retry: %v %v", ok, err)
	}
}

func TestQueueFailureDoesNotInventAnOutcomeForRunningCommands(t *testing.T) {
	db := dispatchDB(t)
	actor := dispatchActor()
	ctx := dispatchContext(t, actor)
	draft := dispatchDraft(t, db, actor)
	if _, err := NewRepository(db, nil).Dispatch(ctx, draft); err != nil {
		t.Fatal(err)
	}
	queue := jobqueue.NewRepository(db, nil, nil)
	if _, err := queue.Claim(ctx, "worker", time.Minute); err != nil {
		t.Fatal(err)
	}
	runs := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
	if err := runs.Start(ctx, draft.ID, "executing"); err != nil {
		t.Fatal(err)
	}
	if ok, err := queue.Fail(ctx, draft.ID, "worker", "observed result has not been stored", time.Now()); err != nil || !ok {
		t.Fatalf("queue failure: %v %v", ok, err)
	}
	run, err := runs.Get(ctx, draft.ID)
	if err != nil || run.Status != taskcenter.StatusRunning || run.FinishedAt != nil {
		t.Fatalf("queue overwrote executor-owned outcome: %+v %v", run, err)
	}
}

func TestRestartKeepsDurableUnstartedBatchAndMarksRunningUnknown(t *testing.T) {
	db := dispatchDB(t)
	ctx := dispatchContext(t, dispatchActor())
	repo := NewRepository(db, nil)
	runs := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
	queued := dispatchDraft(t, db, access.Current(ctx).Actor())
	running := dispatchDraft(t, db, access.Current(ctx).Actor())
	for _, draft := range []*BatchTask{queued, running} {
		if _, err := repo.Dispatch(ctx, draft); err != nil {
			t.Fatal(err)
		}
	}
	if err := runs.Start(ctx, running.ID, "executing"); err != nil {
		t.Fatal(err)
	}
	if err := runs.RecoverInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[uuid.UUID]string{queued.ID: "queued", running.ID: "unknown"} {
		got, err := repo.GetByID(ctx, id)
		if err != nil || got.Status != want {
			t.Fatalf("recovery: %+v %v", got, err)
		}
	}
}
