package rest

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/google/uuid"
)

type deleteCompletionFixture struct {
	taskcenter.Service
	failures   int
	calls      int
	startCalls int
	result     string
	finished   time.Time
}

func (f *deleteCompletionFixture) CompleteExecution(_ context.Context, _ taskcenter.TaskRun, _ taskcenter.Status, result, _, _ string, _, _ int, finished time.Time) error {
	f.calls++
	if f.result != "" && (f.result != result || !f.finished.Equal(finished)) {
		return errors.New("receipt changed during storage retry")
	}
	f.result, f.finished = result, finished
	if f.calls <= f.failures {
		return errors.New("storage offline")
	}
	return nil
}
func (f *deleteCompletionFixture) Start(context.Context, uuid.UUID, string) error {
	f.startCalls++
	return errors.New("cannot start task while storage is offline")
}

func TestDeleteAdmissionAndShutdownOwnWorkerLifetime(t *testing.T) {
	h := &SFTPHandler{}
	request, cancelRequest := context.WithCancel(context.Background())
	work, done, err := h.beginDelete(request, uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	cancelRequest()
	if work.Err() != nil {
		t.Fatal("browser disconnect canceled persistent task")
	}
	closed := make(chan struct{})
	go func() { h.stopDeletes(); close(closed) }()
	select {
	case <-work.Done():
	case <-time.After(time.Second):
		t.Fatal("shutdown did not cancel worker")
	}
	select {
	case <-closed:
		t.Fatal("shutdown did not wait for worker")
	default:
	}
	done()
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("shutdown failed to wait")
	}
	if _, _, err := h.beginDelete(context.Background(), uuid.New()); err == nil {
		t.Fatal("accepted work after shutdown")
	}
}

func TestDeletePersistenceRetryDoesNotRestartRemoteWork(t *testing.T) {
	service := &deleteCompletionFixture{failures: 1}
	h := &SFTPHandler{taskRuns: service}
	id := uuid.New()
	work, done, err := h.beginDelete(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	run := taskcenter.TaskRun{ID: id, Actor: protocol.Actor{Kind: "owner", ID: uuid.NewString(), SessionID: uuid.NewString()}, SourceType: "sftp_delete", SourceID: uuid.NewString(), TaskType: "sftp_recursive_delete"}
	h.executeRecursiveDeleteTask(work, run, uuid.New(), []string{"/tmp/a"})
	done()
	if service.calls != 2 || service.startCalls != 1 || service.result == "" || service.finished.IsZero() {
		t.Fatal("result was lost or remote work restarted")
	}
	_, nextDone, err := h.beginDelete(context.Background(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	nextDone()
}

func TestDeleteCancellationTargetsActualTask(t *testing.T) {
	h := &SFTPHandler{}
	id, other := uuid.New(), uuid.New()
	work, done, err := h.beginDelete(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	otherWork, otherDone, err := h.beginDelete(context.Background(), other)
	if err != nil {
		t.Fatal(err)
	}
	defer otherDone()
	if err := h.CancelDeleteTask(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if work.Err() == nil || otherWork.Err() != nil {
		t.Fatal("cancel did not address the actual task")
	}
	if err := h.CancelDeleteTask(context.Background(), other); err != nil || otherWork.Err() == nil {
		t.Fatalf("second task was not canceled: %v", err)
	}
}
