package rest

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sftputil"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type fileMutationFixture struct {
	taskcenter.Service
	run                        taskcenter.TaskRun
	createErr                  error
	startCount, saves          int
	savedStatus                taskcenter.Status
	savedSuccess, savedFailure int
	saveContextError           error
}

func (f *fileMutationFixture) Create(_ context.Context, run *taskcenter.TaskRun) error {
	if f.createErr != nil {
		return f.createErr
	}
	run.Actor = protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString()}
	f.run = *run
	return nil
}
func (f *fileMutationFixture) Start(_ context.Context, _ uuid.UUID, _ string) error {
	f.startCount++
	f.run.Status = taskcenter.StatusRunning
	return nil
}
func (f *fileMutationFixture) Get(context.Context, uuid.UUID) (*taskcenter.TaskRun, error) {
	run := f.run
	return &run, nil
}
func (f *fileMutationFixture) CompleteExecution(ctx context.Context, _ taskcenter.TaskRun, status taskcenter.Status, _, _, _ string, success, failure int, _ time.Time) error {
	f.saves++
	f.savedStatus, f.savedSuccess, f.savedFailure = status, success, failure
	f.saveContextError = ctx.Err()
	return nil
}
func fileMutationContext(ctx context.Context) (*gin.Context, *httptest.ResponseRecorder) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/sftp/mkdir", nil).WithContext(ctx)
	return c, recorder
}
func TestFileMutationRequiresDurableIntent(t *testing.T) {
	fixture := &fileMutationFixture{createErr: errors.New("storage unavailable")}
	handler := &SFTPHandler{taskRuns: fixture}
	c, recorder := fileMutationContext(context.Background())
	if _, ok := handler.beginFileMutation(c, uuid.New(), "sftp_mkdir", "/a", 1, protocol.SFTPCreateDirectoryRequest{Path: "/a"}); ok || fixture.startCount != 0 || fixture.saves != 0 {
		t.Fatal("execution admitted without a persisted intent")
	}
	if recorder.Code != http.StatusInternalServerError {
		t.Fatal(recorder.Code)
	}
}
func TestFileMutationSavesObservedSuccessAfterRequestCancellation(t *testing.T) {
	fixture := &fileMutationFixture{}
	handler := &SFTPHandler{taskRuns: fixture}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c, recorder := fileMutationContext(ctx)
	run, ok := handler.beginFileMutation(c, uuid.New(), "sftp_mkdir", "/a", 1, protocol.SFTPCreateDirectoryRequest{Path: "/a"})
	if !ok {
		t.Fatal("intent rejected")
	}
	cancel()
	if !handler.finishSingleFileMutation(c, *run, nil) || fixture.savedStatus != taskcenter.StatusSucceeded || fixture.savedSuccess != 1 || fixture.saveContextError != nil {
		t.Fatalf("confirmed result discarded after cancellation: %+v", fixture)
	}
	if recorder.Header().Get("X-Task-ID") != run.ID.String() {
		t.Fatal("missing persistent source reference")
	}
}
func TestFileMutationUnknownDoesNotCountAsConfirmedFailure(t *testing.T) {
	fixture := &fileMutationFixture{}
	handler := &SFTPHandler{taskRuns: fixture}
	c, recorder := fileMutationContext(context.Background())
	run, ok := handler.beginFileMutation(c, uuid.New(), "sftp_rename", "/b", 1, protocol.SFTPRenameRequest{OldPath: "/a", NewPath: "/b"})
	if !ok {
		t.Fatal("intent rejected")
	}
	if handler.finishSingleFileMutation(c, *run, sftputil.ErrMutationOutcomeUnknown) || fixture.savedStatus != taskcenter.StatusUnknown || fixture.savedSuccess != 0 || fixture.savedFailure != 0 || fixture.saves != 1 {
		t.Fatalf("unknown effect became a definite failure: %+v", fixture)
	}
	if recorder.Code != http.StatusConflict {
		t.Fatal(recorder.Code)
	}
}

func TestFileWriteRequiresExplicitContentButAllowsEmpty(t *testing.T) {
	for _, test := range []struct {
		body  string
		valid bool
	}{
		{`{"path":"/a"}`, false}, {`{"path":"/a","content":null}`, false}, {`{"path":"/a","content":""}`, true},
	} {
		c, _ := fileMutationContext(context.Background())
		c.Request = httptest.NewRequest(http.MethodPost, "/sftp/write", strings.NewReader(test.body))
		c.Request.Header.Set("Content-Type", "application/json")
		var input protocol.SFTPWriteRequest
		if err := c.ShouldBindJSON(&input); (err == nil) != test.valid {
			t.Fatalf("content presence validation: %s %v", test.body, err)
		}
	}
}
