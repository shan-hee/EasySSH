package transferjob

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/jobqueue"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type uploadAuthority struct {
	testutil.AccessPolicy
	runtime *access.Runtime
}

func (uploadAuthority) Authorize(ctx context.Context, _ protocol.Actor, _ access.Requirement) error {
	return ctx.Err()
}
func (a uploadAuthority) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, requirements ...access.Requirement) (*access.Lease, error) {
	return a.runtime.Reserve(ctx, scope, kind, 0, requirements...)
}

type uploadServer struct{ serverdomain.Service }

func (uploadServer) GetByID(_ context.Context, _ access.Scope, id uuid.UUID) (*serverdomain.Server, error) {
	return &serverdomain.Server{ID: id}, nil
}

func uploadFixture(t *testing.T) (context.Context, Service, *gorm.DB, *CreateUploadRequest) {
	t.Helper()
	db := transferOutcomeDB(t)
	runtime := access.NewRuntime()
	t.Cleanup(runtime.Close)
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}, time.Now().Add(time.Hour), uploadAuthority{runtime: runtime})
	if err != nil {
		t.Fatal(err)
	}
	s := NewService(NewRepository(db, nil, nil), nil, uploadServer{}, nil, ServiceOptions{DataDir: t.TempDir(), Limiter: sftp.NewTransferLimiter(2)})
	return access.WithScope(context.Background(), scope), s, db, &CreateUploadRequest{ServerID: uuid.NewString(), TargetPath: "/incoming", FileName: " data.txt ", FileSize: 7}
}

func assertUploadQueue(t *testing.T, db *gorm.DB, id uuid.UUID, want int64) {
	t.Helper()
	var count int64
	if err := db.Model(&jobqueue.Job{}).Where("id = ?", id).Count(&count).Error; err != nil || count != want {
		t.Fatalf("queue count=%d want=%d err=%v", count, want, err)
	}
}

func TestFolderUploadIntentValidatesOptions(t *testing.T) {
	ctx, s, _, req := uploadFixture(t)
	for _, invalid := range []CreateUploadRequest{
		{ServerID: req.ServerID, TargetPath: req.TargetPath, FileName: "site", FileSize: 1, Merge: true},
		{ServerID: req.ServerID, TargetPath: req.TargetPath, FileName: "site", FileSize: 1, Folder: true, DeferStart: true},
	} {
		if _, err := s.CreateUploadJob(ctx, &invalid); !errors.Is(err, ErrInvalidJobRequest) {
			t.Fatalf("accepted %+v: %v", invalid, err)
		}
	}
	folder := *req
	folder.FileName, folder.Folder, folder.Merge = "site", true, true
	job, err := s.CreateUploadJob(ctx, &folder)
	if err != nil || job.FilesTotal != 0 || job.TargetPath != "/incoming/site" || !strings.Contains(job.DetailJSON, `"folder":true`) || !strings.Contains(job.DetailJSON, `"merge":true`) {
		t.Fatalf("job=%+v err=%v", job, err)
	}
}

func TestUploadIntentPrecedesInputAndDispatch(t *testing.T) {
	ctx, s, db, req := uploadFixture(t)
	job, err := s.CreateUploadJob(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != JobStatusCreated || job.Stage != JobStageAwaitingInput || job.ArtifactPath != "" || job.TargetPath != "/incoming/ data.txt " {
		t.Fatalf("invalid intent: %+v", job)
	}
	assertUploadQueue(t, db, job.ID, 0)
	job, err = s.UploadJobContent(ctx, job.ID, io.NopCloser(strings.NewReader("payload")))
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != JobStatusQueued || job.TaskRunID == nil || job.ArtifactSize != 7 || job.FinishedAt != nil {
		t.Fatalf("input reception claimed remote completion: %+v", job)
	}
	assertUploadQueue(t, db, job.ID, 1)
	if _, err := s.UploadJobContent(ctx, job.ID, io.NopCloser(strings.NewReader("changed"))); err == nil {
		t.Fatal("duplicate input accepted")
	}
	body, err := os.ReadFile(job.ArtifactPath)
	if err != nil || string(body) != "payload" {
		t.Fatalf("input overwritten: %q %v", body, err)
	}
}

func TestUploadExactSizeRequiredBeforeDispatch(t *testing.T) {
	for _, body := range []string{"short", "too long"} {
		t.Run(body, func(t *testing.T) {
			ctx, s, db, req := uploadFixture(t)
			job, err := s.CreateUploadJob(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			job, err = s.UploadJobContent(ctx, job.ID, io.NopCloser(strings.NewReader(body)))
			if err != nil || job.Status != JobStatusFailed || job.FinishedAt == nil {
				t.Fatalf("bad input was not settled: %+v %v", job, err)
			}
			assertUploadQueue(t, db, job.ID, 0)
		})
	}
}

func TestScheduledInputCannotBeClaimedAgain(t *testing.T) {
	ctx, s, db, req := uploadFixture(t)
	req.DeferStart = true
	job, err := s.CreateUploadJob(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	job, err = s.UploadJobContent(ctx, job.ID, io.NopCloser(strings.NewReader("payload")))
	if err != nil || job.Status != JobStatusCreated || job.Stage != JobStageStaging {
		t.Fatalf("staged input: %+v %v", job, err)
	}
	assertUploadQueue(t, db, job.ID, 0)
	// Exercise the database predicate as well as the service guard.
	claimed, err := NewRepository(db, nil, nil).ClaimUploadInput(ctx, job.ID, time.Now().UTC())
	if err != nil || claimed {
		t.Fatalf("staged input reclaimed: %v %v", claimed, err)
	}
}

func TestCancelledAndExpiredUploadRejectInput(t *testing.T) {
	for _, cancel := range []bool{true, false} {
		ctx, s, db, req := uploadFixture(t)
		job, err := s.CreateUploadJob(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		if cancel {
			err = s.CancelJob(ctx, job.ID)
		} else {
			err = db.Model(&TransferJob{}).Where("id = ?", job.ID).Update("artifact_expires_at", time.Now().Add(-time.Hour)).Error
		}
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.UploadJobContent(ctx, job.ID, io.NopCloser(strings.NewReader("payload"))); err == nil {
			t.Fatal("inactive input accepted")
		}
		assertUploadQueue(t, db, job.ID, 0)
	}
}

func TestUploadRestartPreservesIntentAndFailsIncompleteInput(t *testing.T) {
	ctx, s, db, req := uploadFixture(t)
	waiting, err := s.CreateUploadJob(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	interrupted, err := s.CreateUploadJob(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db, nil, nil)
	if claimed, err := repo.ClaimUploadInput(ctx, interrupted.ID, time.Now().UTC()); err != nil || !claimed {
		t.Fatalf("claim: %v %v", claimed, err)
	}
	if _, err := repo.RecoverInterrupted(ctx); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[uuid.UUID]JobStatus{waiting.ID: JobStatusCreated, interrupted.ID: JobStatusFailed} {
		job, err := repo.GetByID(ctx, id)
		if err != nil || job.Status != want {
			t.Fatalf("recovery: %+v %v", job, err)
		}
		assertUploadQueue(t, db, id, 0)
	}
}
