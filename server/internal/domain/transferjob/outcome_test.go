package transferjob

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/sftputil"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type transferTestAuthority struct {
	testutil.AccessPolicy
}

func (transferTestAuthority) Authorize(ctx context.Context, _ protocol.Actor, _ access.Requirement) error {
	return ctx.Err()
}

func transferTestContext(t *testing.T, kind protocol.Kind) context.Context {
	t.Helper()
	actor := protocol.Actor{Kind: kind, ID: uuid.NewString(), SessionID: uuid.NewString()}
	if kind == protocol.Visitor {
		actor.GrantID = uuid.NewString()
		actor.ID = actor.SessionID
	}
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), transferTestAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}

func transferOutcomeDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&TransferJob{}, &jobqueue.Job{}, &taskcenter.NotificationDelivery{}, &taskcenter.TaskRun{}, &taskcenter.TaskEvent{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}, &serverdomain.Server{}, &serverdomain.ServerAuth{}, &serverdomain.ServerTag{}, &serverdomain.ServerGroup{}, &scheduledtask.ScheduledTask{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

func createOutcomeJob(t *testing.T, ctx context.Context, repo Repository) *TransferJob {
	t.Helper()
	started := time.Now().UTC().Truncate(time.Millisecond)
	job := &TransferJob{Actor: access.Current(ctx).Actor(), Name: "upload", Kind: JobKindSFTPUpload, Status: JobStatusRunning,
		Stage: JobStageTransferToRemote, BytesTotal: 100, BytesProcessed: 73, Progress: 73, StartedAt: &started}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	return job
}

func TestEmptyDirectoryTransferDoesNotInventSuccessfulFiles(t *testing.T) {
	for _, kind := range []JobKind{JobKindSFTPDownload, JobKindSFTPTransfer} {
		t.Run(string(kind), func(t *testing.T) {
			ctx := transferTestContext(t, protocol.Owner)
			db := transferOutcomeDB(t)
			repo := NewRepository(db, nil, nil)
			tasks := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
			s := &service{repo: repo, taskRuns: tasks}
			started := time.Now().UTC().Truncate(time.Millisecond)
			job := &TransferJob{Actor: access.Current(ctx).Actor(), Name: "empty directory", Kind: kind, Status: JobStatusRunning, Stage: JobStageDownloadFromRemote, StartedAt: &started}
			if err := repo.Create(ctx, job); err != nil {
				t.Fatal(err)
			}
			if err := s.ensureTaskRun(ctx, job); err != nil {
				t.Fatal(err)
			}
			if err := s.finishExecution(ctx, job, nil, job.Stage); err != nil {
				t.Fatal(err)
			}
			var activity operationrecord.OperationRecord
			if err := db.Where("source_table=? AND source_id=?", "transfer_jobs", job.ID.String()).First(&activity).Error; err != nil {
				t.Fatal(err)
			}
			if activity.Status != operationrecord.StatusSuccess || activity.SuccessCount != 0 || activity.BytesCompleted != 0 {
				t.Fatalf("empty directory manufactured completed files/bytes: %+v", activity)
			}
			var run taskcenter.TaskRun
			if err := db.First(&run, "id=?", *job.TaskRunID).Error; err != nil {
				t.Fatal(err)
			}
			if run.Status != taskcenter.StatusSucceeded || run.SuccessCount != 0 {
				t.Fatalf("task disagrees with source file count: %+v", run)
			}
			if err := s.syncTaskRun(ctx, job.ID); err != nil {
				t.Fatal("reconciliation changed the outcome", err)
			}
		})
	}
}

type unreliableOutcomeRepo struct {
	Repository
	fail, afterCommit bool
	writes            int
}

func (r *unreliableOutcomeRepo) UpdateIfStatus(ctx context.Context, id uuid.UUID, states []JobStatus, updates map[string]interface{}) (bool, error) {
	r.writes++
	fail := r.fail
	r.fail = false
	if fail && !r.afterCommit {
		return false, errors.New("database unavailable")
	}
	updated, err := r.Repository.UpdateIfStatus(ctx, id, states, updates)
	if err == nil && fail {
		return updated, errors.New("commit response lost")
	}
	return updated, err
}

func TestCancellationWaitsForObservedCommit(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	repo := NewRepository(transferOutcomeDB(t), nil, nil)
	job := createOutcomeJob(t, ctx, repo)
	s := &service{repo: repo}
	if err := s.CancelJob(ctx, job.ID); err != nil {
		t.Fatal(err)
	}
	requested, err := repo.GetByID(ctx, job.ID)
	if err != nil || requested.Status != JobStatusCanceling || requested.FinishedAt != nil {
		t.Fatalf("cancellation invented a terminal outcome: %+v %v", requested, err)
	}
	lateCtx, cancel := context.WithCancel(ctx)
	cancel()
	job.BytesProcessed = 100
	if err := s.finishExecution(lateCtx, job, nil, job.Stage); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetByID(ctx, job.ID)
	if err != nil || got.Status != JobStatusCompleted || got.BytesProcessed != 100 {
		t.Fatalf("late cancellation discarded observed success: %+v %v", got, err)
	}
}

func TestUnknownCommitKeepsObservedBytesAndIsNotReplayed(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	repo := NewRepository(db, nil, nil)
	job := createOutcomeJob(t, ctx, repo)
	s := &service{repo: repo}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := s.finishExecution(cancelled, job, sftputil.MutationError(errors.New("commit reply lost")), job.Stage); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetByID(ctx, job.ID)
	if err != nil || got.Status != JobStatusUnknown || got.BytesProcessed != 73 {
		t.Fatalf("unknown outcome was replaced: %+v %v", got, err)
	}
	var activity operationrecord.OperationRecord
	if err := db.Where("source_table = ? AND source_id = ?", "transfer_jobs", job.ID.String()).First(&activity).Error; err != nil {
		t.Fatal(err)
	}
	if activity.Status != operationrecord.StatusUnknown || activity.FailureCount != 0 || activity.BytesProcessed != 73 {
		t.Fatalf("incorrect activity: %+v", activity)
	}
	payload, _ := json.Marshal(map[string]string{"job_id": job.ID.String()})
	// No SFTP pool/limiter: an accidental replay cannot silently pass this test.
	if err := s.HandleQueueJob(ctx, &jobqueue.Job{Actor: job.Actor, PayloadJSON: string(payload)}); err != nil {
		t.Fatal(err)
	}
}

func TestOutcomeRetryOnlySavesAndHandlesLostCommitReply(t *testing.T) {
	for _, afterCommit := range []bool{false, true} {
		t.Run(map[bool]string{false: "before_commit", true: "after_commit"}[afterCommit], func(t *testing.T) {
			ctx := transferTestContext(t, protocol.Visitor)
			repo := &unreliableOutcomeRepo{Repository: NewRepository(transferOutcomeDB(t), nil, nil), fail: true, afterCommit: afterCommit}
			job := createOutcomeJob(t, ctx, repo)
			s := &service{repo: repo}
			observed := observedOutcome(ctx, job, nil, job.Stage)
			if _, err := s.saveTerminal(ctx, observed, []JobStatus{JobStatusRunning}, false); err != nil {
				t.Fatal(err)
			}
			got, err := s.GetJob(ctx, job.ID)
			if err != nil || got.Status != JobStatusCompleted || got.BytesProcessed != 73 || !got.FinishedAt.Equal(*observed.FinishedAt) || repo.writes != 2 {
				t.Fatalf("save retry changed observed facts: %+v %v writes=%d", got, err, repo.writes)
			}
			other := transferTestContext(t, protocol.Visitor)
			if _, err := s.GetJob(other, job.ID); !errors.Is(err, ErrJobNotFound) {
				t.Fatalf("result crossed visitor scope: %v", err)
			}
			payload, _ := json.Marshal(map[string]string{"job_id": job.ID.String()})
			if err := s.HandleQueueJob(ctx, &jobqueue.Job{Actor: job.Actor, PayloadJSON: string(payload)}); err != nil {
				t.Fatal(err)
			}
			if repo.writes != 2 {
				t.Fatal("queue redelivery rewrote terminal result")
			}
		})
	}
}

func TestConflictingOutcomeStopsStorageRetries(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	repo := &unreliableOutcomeRepo{Repository: NewRepository(transferOutcomeDB(t), nil, nil)}
	job := createOutcomeJob(t, ctx, repo)
	s := &service{repo: repo}
	now := time.Now().UTC()
	if err := repo.Repository.Update(ctx, job.ID, map[string]interface{}{"status": JobStatusUnknown, "finished_at": &now}); err != nil {
		t.Fatal(err)
	}
	if err := s.finishExecution(ctx, job, nil, job.Stage); !errors.Is(err, ErrOutcomeConflict) {
		t.Fatalf("conflict was overwritten: %v", err)
	}
	if repo.writes != 1 {
		t.Fatal("immutable conflict retried")
	}
}

func TestRestartRecoveryPreservesQueuedAndFreezesRunning(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	repo := NewRepository(db, nil, nil)
	running := createOutcomeJob(t, ctx, repo)
	queued := createOutcomeJob(t, ctx, repo)
	if err := repo.Update(ctx, queued.ID, map[string]interface{}{"status": JobStatusQueued, "started_at": nil}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.RecoverInterrupted(ctx); err != nil {
		t.Fatal(err)
	}
	a, err := repo.GetByID(ctx, running.ID)
	if err != nil || a.Status != JobStatusUnknown || a.BytesProcessed != 73 {
		t.Fatalf("running transfer became replayable: %+v %v", a, err)
	}
	b, err := repo.GetByID(ctx, queued.ID)
	if err != nil || b.Status != JobStatusQueued || b.FinishedAt != nil {
		t.Fatalf("unstarted queue work was lost: %+v %v", b, err)
	}
}

func TestScheduledAttemptHandsOffExactlyOneTransfer(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	tasks := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
	run := &taskcenter.TaskRun{Actor: access.Current(ctx).Actor(), TaskType: string(JobKindSFTPUpload), Title: "scheduled upload", SourceType: "scheduled_task", SourceID: uuid.NewString(), Status: taskcenter.StatusRunning}
	if err := tasks.Create(ctx, run); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db, nil, nil)
	job := &TransferJob{Actor: run.Actor, TaskRunID: &run.ID, Name: run.Title, Kind: JobKindSFTPUpload, Status: JobStatusQueued, Stage: JobStageTransferToRemote}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	got, err := tasks.Get(ctx, run.ID)
	if err != nil || got.SourceType != "transfer_job" || got.SourceID != job.ID.String() {
		t.Fatalf("attempt was not handed off: %+v %v", got, err)
	}
	duplicate := cloneJob(job)
	duplicate.ID = uuid.New()
	if err := repo.Create(ctx, duplicate); err == nil {
		t.Fatal("two transfer jobs claimed the same attempt")
	}
	if err := tasks.RecoverInterrupted(ctx); err != nil {
		t.Fatal(err)
	}
	got, err = tasks.Get(ctx, run.ID)
	if err != nil || got.Status != taskcenter.StatusRunning {
		t.Fatalf("generic recovery settled transfer-owned attempt: %+v %v", got, err)
	}
}

func TestStopWaitsForActiveResultSaveWithoutAdmittingNewWork(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	repo := &unreliableOutcomeRepo{Repository: NewRepository(transferOutcomeDB(t), nil, nil), fail: true}
	job := createOutcomeJob(t, ctx, repo)
	s := &service{repo: repo}
	workCtx, done, err := s.beginOperation(ctx)
	if err != nil {
		t.Fatal(err)
	}
	deadline, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.Stop(deadline); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if workCtx.Err() == nil {
		t.Fatal("shutdown did not cancel active work")
	}
	if _, _, err := s.beginOperation(ctx); err == nil {
		t.Fatal("shutdown admitted new work")
	}
	if err := s.finishExecution(workCtx, job, nil, job.Stage); err != nil {
		t.Fatal(err)
	}
	done()
	wait, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := s.Stop(wait); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetByID(ctx, job.ID)
	if err != nil || got.Status != JobStatusCompleted {
		t.Fatalf("cancellation discarded observed result: %+v %v", got, err)
	}
}

func TestTaskProjectionConflictIsReported(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	repo := NewRepository(db, nil, nil)
	job := createOutcomeJob(t, ctx, repo)
	tasks := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
	s := &service{repo: repo, taskRuns: tasks}
	if err := s.ensureTaskRun(ctx, job); err != nil {
		t.Fatal(err)
	}
	// The task already has a conflicting terminal state; successful source
	// persistence must not disguise that disagreement as a complete save.
	if err := tasks.CompleteTransfer(ctx, *job.TaskRunID, taskcenter.StatusUnknown, "", "transfer_outcome_unknown", "lost", 0, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.finishExecution(ctx, job, nil, job.Stage); !errors.Is(err, ErrOutcomeConflict) {
		t.Fatalf("projection conflict was ignored: %v", err)
	}
	stored, err := s.GetJob(ctx, job.ID)
	if err != nil || stored.Status != JobStatusCompleted {
		t.Fatalf("lost observed source: %+v %v", stored, err)
	}
}

func TestScheduledOutcomeCountsOnceAndCannotBeSettledByPreparation(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	definition := &scheduledtask.ScheduledTask{OwnerID: uuid.MustParse(access.Current(ctx).Actor().ID), TaskName: "upload", TaskType: string(JobKindSFTPUpload), CronExpression: "0 * * * *"}
	if err := db.Create(definition).Error; err != nil {
		t.Fatal(err)
	}
	tasks := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
	run := &taskcenter.TaskRun{Actor: access.Current(ctx).Actor(), DefinitionID: &definition.ID, TaskType: string(JobKindSFTPUpload), Title: "upload", SourceType: "scheduled_task", SourceID: definition.ID.String(), Status: taskcenter.StatusRunning}
	if err := tasks.Create(ctx, run); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db, nil, nil)
	job := &TransferJob{Actor: run.Actor, TaskRunID: &run.ID, ScheduledTaskID: &definition.ID, Name: "upload", Kind: JobKindSFTPUpload, Status: JobStatusRunning, Stage: JobStageTransferToRemote, BytesProcessed: 73, BytesTotal: 100, Progress: 73}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	changed, err := taskcenter.NewRepository(db, nil).Complete(ctx, run.ID, "scheduled_task", map[string]interface{}{"status": taskcenter.StatusFailed})
	if err != nil || changed {
		t.Fatalf("stale preparation CAS crossed handoff: changed=%v err=%v", changed, err)
	}
	if err := tasks.Complete(ctx, run.ID, taskcenter.StatusFailed, "", "access_ended", "preparation lease ended", 0, 1); err != nil {
		t.Fatal(err)
	}
	current, err := tasks.Get(ctx, run.ID)
	if err != nil || current.Status != taskcenter.StatusRunning {
		t.Fatalf("preparation overwrote transfer: %+v %v", current, err)
	}
	s := &service{repo: repo, taskRuns: tasks}
	if err := s.finishExecution(ctx, job, sftputil.MutationError(errors.New("reply lost")), job.Stage); err != nil {
		t.Fatal(err)
	}
	if err := s.syncTaskRun(ctx, job.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.First(definition, "id = ?", definition.ID).Error; err != nil {
		t.Fatal(err)
	}
	if definition.RunCount != 1 || definition.FailureCount != 0 || definition.LastStatus != "unknown" {
		t.Fatalf("scheduled counts differ from observed outcome: %+v", definition)
	}
	current, err = tasks.Get(ctx, run.ID)
	if err != nil || current.Status != taskcenter.StatusUnknown || current.BytesProcessed != 73 || current.Retryable {
		t.Fatalf("task summary lost final bytes/unknown: %+v %v", current, err)
	}
}

func TestManualTaskAttachmentIsAtomicAndIdempotent(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	repo := NewRepository(db, nil, nil)
	job := createOutcomeJob(t, ctx, repo)
	first, err := repo.EnsureTaskRun(ctx, job.ID)
	if err != nil {
		t.Fatal(err)
	}
	again, err := repo.EnsureTaskRun(ctx, job.ID)
	if err != nil || first.TaskRunID == nil || again.TaskRunID == nil || *first.TaskRunID != *again.TaskRunID {
		t.Fatalf("attachment retry changed identity: %+v %v", again, err)
	}
	var count int64
	if err := db.Model(&taskcenter.TaskRun{}).Where("work_id = ?", job.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("attachment created duplicate attempts: %d %v", count, err)
	}
}
