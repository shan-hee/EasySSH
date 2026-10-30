package transferjob

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/google/uuid"
)

func queuedTestJob(ctx context.Context) *TransferJob {
	return &TransferJob{Actor: access.Current(ctx).Actor(), Name: "download", Kind: JobKindSFTPDownload, Status: JobStatusQueued, Stage: JobStageDownloadFromRemote, SourcePath: "/file", FileName: "file"}
}

func TestDispatchFailureRollsBackSourceAndTaskAttachment(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	repo := NewRepository(db, nil, nil)
	if err := db.Migrator().DropTable(&jobqueue.Job{}); err != nil {
		t.Fatal(err)
	}
	job := queuedTestJob(ctx)
	if err := repo.Create(ctx, job); err == nil {
		t.Fatal("source committed without dispatch")
	}
	if job.ID == uuid.Nil || job.TaskRunID != nil {
		t.Fatal("failed transaction lost identity or leaked a tentative task reference")
	}
	var sources, attempts int64
	if err := db.Model(&TransferJob{}).Count(&sources).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&taskcenter.TaskRun{}).Count(&attempts).Error; err != nil {
		t.Fatal(err)
	}
	if sources != 0 || attempts != 0 {
		t.Fatalf("partial handoff committed: sources=%d attempts=%d", sources, attempts)
	}
	if err := db.AutoMigrate(&jobqueue.Job{}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	var queued jobqueue.Job
	if err := db.First(&queued, "id = ?", job.ID).Error; err != nil {
		t.Fatal(err)
	}
	if queued.Actor != job.Actor || queued.SourceID != job.ID.String() || job.TaskRunID == nil {
		t.Fatal("dispatch lost source actor/identity")
	}
	if err := db.Model(&jobqueue.Job{}).Count(&sources).Error; err != nil || sources != 1 {
		t.Fatalf("retry duplicated dispatch: %d %v", sources, err)
	}
}

type uncertainAdmissionRepo struct {
	Repository
	fail, afterCommit bool
}

func (r *uncertainAdmissionRepo) Create(ctx context.Context, job *TransferJob) error {
	fail := r.fail
	r.fail = false
	if fail && !r.afterCommit {
		return errors.New("database unavailable")
	}
	if err := r.Repository.Create(ctx, job); err != nil {
		return err
	}
	if fail {
		return errors.New("commit response lost")
	}
	return nil
}

func TestAdmissionRetryPreservesIdentityAndDoesNotDuplicateQueue(t *testing.T) {
	for _, afterCommit := range []bool{false, true} {
		t.Run(map[bool]string{false: "before_commit", true: "after_commit"}[afterCommit], func(t *testing.T) {
			ctx := transferTestContext(t, protocol.Owner)
			db := transferOutcomeDB(t)
			repo := &uncertainAdmissionRepo{Repository: NewRepository(db, nil, nil), fail: true, afterCommit: afterCommit}
			s := &service{repo: repo}
			pending, err := s.saveAdmission(ctx, queuedTestJob(ctx))
			if err != nil || pending == nil || pending.ID == uuid.Nil {
				t.Fatalf("acceptance identity lost: %+v %v", pending, err)
			}
			var sources, attempts, dispatches int64
			for model, count := range map[interface{}]*int64{&TransferJob{}: &sources, &taskcenter.TaskRun{}: &attempts, &jobqueue.Job{}: &dispatches} {
				if err := db.Model(model).Count(count).Error; err != nil {
					t.Fatal(err)
				}
			}
			if sources != 1 || attempts != 1 || dispatches != 1 {
				t.Fatalf("retry created extra work: %d/%d/%d", sources, attempts, dispatches)
			}
			got, err := repo.GetByID(ctx, pending.ID)
			if err != nil || got.Status != JobStatusQueued {
				t.Fatalf("admission retry executed work: %+v %v", got, err)
			}
		})
	}
}

func TestStagedCommitUncertaintyRetainsFileAndOnlyOneDispatch(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	base := NewRepository(db, nil, nil)
	job := &TransferJob{Actor: access.Current(ctx).Actor(), Name: "upload", Kind: JobKindSFTPUpload, Status: JobStatusStaging, Stage: JobStageStaging, BytesTotal: 7, ArtifactManaged: true, FileName: "payload"}
	if err := base.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	job.ArtifactPath = filepath.Join(t.TempDir(), "payload")
	if err := os.WriteFile(job.ArtifactPath, []byte("payload"), 0600); err != nil {
		t.Fatal(err)
	}
	job.ArtifactSize, job.Status, job.Stage = 7, JobStatusQueued, JobStageTransferToRemote
	repo := &unreliableOutcomeRepo{Repository: base, fail: true, afterCommit: true}
	s := &service{repo: repo}
	pending, err := s.saveStaged(ctx, job)
	if err != nil || pending == nil {
		t.Fatal(err)
	}
	if payload, err := os.ReadFile(job.ArtifactPath); err != nil || string(payload) != "payload" {
		t.Fatal("uncertain handoff deleted its artifact")
	}
	var count int64
	if err := db.Model(&jobqueue.Job{}).Where("source_id = ?", job.ID.String()).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("handoff duplicated dispatch: %d %v", count, err)
	}
}

func TestStagedCancellationNeverDispatchesAndRetainsStagingBytes(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	repo := NewRepository(db, nil, nil)
	job := &TransferJob{Actor: access.Current(ctx).Actor(), Name: "upload", Kind: JobKindSFTPUpload, Status: JobStatusStaging, Stage: JobStageStaging, BytesTotal: 7, ArtifactManaged: true}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	s := &service{repo: repo}
	if err := s.CancelJob(ctx, job.ID); err != nil {
		t.Fatal(err)
	}
	job.Status, job.Stage, job.ArtifactSize, job.ArtifactPath = JobStatusQueued, JobStageTransferToRemote, 7, "/private/staged"
	got, err := s.saveStaged(ctx, job)
	if err != nil || got.Status != JobStatusCancelled || got.BytesProcessed != 7 || got.FinishedAt == nil {
		t.Fatalf("staging cancellation lost facts: %+v %v", got, err)
	}
	var count int64
	if err := db.Model(&jobqueue.Job{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("cancelled staging dispatched: %d %v", count, err)
	}
}

func TestDispatchExhaustionReconcilesSourceAndTaskWithoutRestart(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	repo := NewRepository(db, nil, nil)
	job := queuedTestJob(ctx)
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&jobqueue.Job{}).Where("id = ?", job.ID).Updates(map[string]interface{}{"status": jobqueue.StatusFailed, "last_error": "dispatch attempts exhausted"}).Error; err != nil {
		t.Fatal(err)
	}
	changed, err := repo.ReconcileDispatch(ctx)
	if err != nil || len(changed) != 1 || changed[0].Status != JobStatusFailed {
		t.Fatalf("source left queued forever: %+v %v", changed, err)
	}
	// A crash between source and TaskRun saves still leaves a repair candidate.
	changed, err = repo.ReconcileDispatch(ctx)
	if err != nil || len(changed) != 1 {
		t.Fatalf("projection repair disappeared: %+v %v", changed, err)
	}
	tasks := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
	s := &service{repo: repo, taskRuns: tasks}
	if err := s.syncTaskRun(ctx, job.ID); err != nil {
		t.Fatal(err)
	}
	run, err := tasks.Get(ctx, *job.TaskRunID)
	if err != nil || run.Status != taskcenter.StatusFailed || run.BytesProcessed != 0 {
		t.Fatalf("dispatch failure invented execution: %+v %v", run, err)
	}
}

func TestPreparationFailureRetainsPartialBytesAndCannotReplaceRunning(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	repo := NewRepository(transferOutcomeDB(t), nil, nil)
	job := &TransferJob{Actor: access.Current(ctx).Actor(), Name: "staging", Kind: JobKindSFTPUpload, Status: JobStatusStaging, Stage: JobStageStaging, BytesTotal: 100, BytesProcessed: 73, Progress: 73, ArtifactManaged: true}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	job.ArtifactPath, job.ArtifactSize = "/private/partial", 73
	s := &service{repo: repo}
	got, err := s.savePreparationFailure(ctx, job, errors.New("request body ended early"))
	if err != nil || got.Status != JobStatusFailed || got.BytesProcessed != 73 || got.ArtifactSize != 73 {
		t.Fatalf("preparation failure lost bytes: %+v %v", got, err)
	}
	running := createOutcomeJob(t, ctx, repo)
	got, err = s.savePreparationFailure(ctx, running, errors.New("late access rejection"))
	if err != nil || got.Status != JobStatusRunning {
		t.Fatalf("preparation overwrote running transfer: %+v %v", got, err)
	}
}

func TestHandlerExecutesOnceAfterAdmissionRetry(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	repo := &uncertainAdmissionRepo{Repository: NewRepository(db, nil, nil), fail: true, afterCommit: true}
	s := &service{repo: repo, limiter: sftp.NewTransferLimiter(1)}
	pending, err := s.saveAdmission(ctx, queuedTestJob(ctx))
	if err != nil {
		t.Fatal(err)
	}
	repo.fail = false
	payload, _ := json.Marshal(map[string]string{"job_id": pending.ID.String()})
	if err := s.HandleQueueJob(ctx, &jobqueue.Job{Actor: pending.Actor, PayloadJSON: string(payload)}); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetByID(ctx, pending.ID)
	// This input intentionally has no source server. Entering the executor
	// must produce a failed result, instead of completing only the queue row
	// and leaving the source queued forever after repairing admission.
	if err != nil || got.Status != JobStatusFailed || got.ErrorMessage != "source server is required" {
		t.Fatalf("delivery was consumed before source execution: %+v %v", got, err)
	}
}

func TestScheduledAdmissionUsesStableAttemptIdentity(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	tasks := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
	run := &taskcenter.TaskRun{Actor: access.Current(ctx).Actor(), TaskType: string(JobKindSFTPDownload), Title: "download", SourceType: "scheduled_task", SourceID: uuid.NewString(), Status: taskcenter.StatusRunning}
	if err := tasks.Create(ctx, run); err != nil {
		t.Fatal(err)
	}
	repo := &uncertainAdmissionRepo{Repository: NewRepository(db, nil, nil), fail: true}
	s := &service{repo: repo}
	first := queuedTestJob(ctx)
	first.TaskRunID = &run.ID
	pending, err := s.saveAdmission(ctx, first)
	if err != nil || pending.ID != run.ID {
		t.Fatalf("attempt identity was not stable: %+v %v", pending, err)
	}
	second := queuedTestJob(ctx)
	second.TaskRunID = &run.ID
	repo.fail = false
	got, err := s.saveAdmission(ctx, second)
	if err != nil || got.ID != pending.ID {
		t.Fatalf("preparation retry created new work: %+v %v", got, err)
	}
	var count int64
	if err := db.Model(&TransferJob{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("attempt duplicated source: %d %v", count, err)
	}
}

func TestUnfinishedStagingCannotBeBoundOrDetached(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	repo := NewRepository(transferOutcomeDB(t), nil, nil)
	job := &TransferJob{Actor: access.Current(ctx).Actor(), Name: "input", Kind: JobKindSFTPUpload, Status: JobStatusStaging, Stage: JobStageStaging, BytesTotal: 7, ArtifactManaged: true}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	s := &service{repo: repo}
	if err := s.AttachScheduledTask(ctx, job.ID, uuid.New()); !errors.Is(err, ErrInvalidJobRequest) {
		t.Fatalf("unfinished input could be attached: %v", err)
	}
	if err := s.DetachScheduledTask(ctx, job.ID); !errors.Is(err, ErrInvalidJobRequest) {
		t.Fatalf("unfinished input could be detached: %v", err)
	}
}

type staleExpiryRepo struct {
	Repository
	expired []*TransferJob
}

func (r *staleExpiryRepo) FindExpired(context.Context, time.Time, int) ([]*TransferJob, error) {
	return r.expired, nil
}

func TestBindingProtectsAgainstStaleExpiryAndDeletionSnapshots(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	base := NewRepository(transferOutcomeDB(t), nil, nil)
	expired := time.Now().Add(-time.Hour)
	job := &TransferJob{Actor: access.Current(ctx).Actor(), Name: "input", Kind: JobKindSFTPUpload, Status: JobStatusCreated, Stage: JobStageStaging, BytesTotal: 7, ArtifactSize: 7, ArtifactManaged: true, ArtifactExpiresAt: &expired}
	job.ArtifactPath = filepath.Join(t.TempDir(), "input")
	if err := os.WriteFile(job.ArtifactPath, []byte("payload"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := base.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	stale := cloneJob(job)
	repo := &staleExpiryRepo{Repository: base, expired: []*TransferJob{stale}}
	s := &service{repo: repo, dataDir: t.TempDir()}
	if err := s.AttachScheduledTask(ctx, job.ID, uuid.New()); err != nil {
		t.Fatal(err)
	}
	s.cleanupExpired(ctx)
	got, err := base.GetByID(ctx, job.ID)
	if err != nil || got.Status != JobStatusCreated || got.ArtifactCleanedAt != nil || got.ArtifactExpiresAt != nil {
		t.Fatalf("stale cleanup removed a bound input: %+v %v", got, err)
	}
	if err := s.deleteLoadedJob(ctx, stale, nil); !errors.Is(err, ErrInvalidJobRequest) {
		t.Fatalf("stale delete bypassed schedule binding: %v", err)
	}
}

type lostRunningReplyRepo struct{ Repository }

func (r *lostRunningReplyRepo) UpdateIfStatus(ctx context.Context, id uuid.UUID, statuses []JobStatus, updates map[string]interface{}) (bool, error) {
	updated, err := r.Repository.UpdateIfStatus(ctx, id, statuses, updates)
	if err == nil && updated && updates["status"] == JobStatusRunning {
		return updated, errors.New("running commit reply lost")
	}
	return updated, err
}

func TestLostRunningReplyPreservesKnownUnstartedOutcome(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	repo := &lostRunningReplyRepo{Repository: NewRepository(db, nil, nil)}
	job := queuedTestJob(ctx)
	serverID := uuid.New()
	job.SourceServerID = &serverID
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	s := &service{repo: repo, limiter: sftp.NewTransferLimiter(1)}
	payload, _ := json.Marshal(map[string]string{"job_id": job.ID.String()})
	if err := s.HandleQueueJob(ctx, &jobqueue.Job{Actor: job.Actor, PayloadJSON: string(payload)}); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetByID(ctx, job.ID)
	if err != nil || got.Status != JobStatusFailed || got.BytesProcessed != 0 || !strings.Contains(got.ErrorMessage, "before remote I/O") {
		t.Fatalf("known unstarted action became unknown/replayed: %+v %v", got, err)
	}
}
