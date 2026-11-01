package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
)

func TestFileMutationUsesExistingCompletionPersistence(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	files := NewDesktopSFTPService(nil, tasks, nil)
	ctx, id, cancel, err := files.beginFileMutation(context.Background(), desktopSFTPTaskRename, "server", "/old", 0)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	dir := t.TempDir()
	old, newPath := filepath.Join(dir, "old"), filepath.Join(dir, "new")
	if err = os.WriteFile(old, []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(old, newPath); err != nil {
		t.Fatal(err)
	}
	receipt, saveErr := files.finishFileMutation(ctx, id, nil, 1, 0, 0, 0, map[string]any{"source_path": "/old", "dest_path": "/new"})
	if receipt.TaskID != id || receipt.Status != "succeeded" || saveErr != nil {
		t.Fatalf("observed success hidden by persistence failure: %+v", receipt)
	}
	run, err := tasks.getRun(id)
	if err != nil || run.Status != "succeeded" || run.FinishedAt == "" {
		t.Fatalf("mutation result not committed: %+v %v", run, err)
	}
	if _, err = os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("saving recreated the source: %v", err)
	}
	if bytes, err := os.ReadFile(newPath); err != nil || string(bytes) != "content" {
		t.Fatalf("saving changed the remote effect: %q %v", bytes, err)
	}
	var count int
	if err = tasks.db.QueryRow(`SELECT COUNT(*) FROM activity_logs WHERE source_id=? AND kind='execution' AND status='success'`, id).Scan(&count); err != nil || count != 1 {
		t.Fatalf("mutation duplicated or misclassified: %d %v", count, err)
	}
}

func TestFileMutationResultKeepsUnknownAndAcceptedBytes(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	files := NewDesktopSFTPService(nil, tasks, nil)
	ctx, id, cancel, err := files.beginFileMutation(context.Background(), desktopSFTPTaskWrite, "server", "/file", 12)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	receipt, saveErr := files.finishFileMutation(ctx, id, desktopSFTPMutationError(io.EOF), 0, 1, 12, 12, map[string]any{"dest_path": "/file"})
	run, err := tasks.getRun(id)
	if err != nil || saveErr != nil || receipt.Status != "unknown" || run.Status != "unknown" || run.BytesProcessed != 12 || run.BytesCompleted != 0 || run.FailureCount != 0 || run.Retryable {
		t.Fatalf("lost response reclassified or replayable: %+v %+v %v", receipt, run, err)
	}
}

func TestTextFileSaveHasExecutionIntentAndDoesNotCreateTransfer(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	files := NewDesktopSFTPService(nil, tasks, nil)
	client := desktopAtomicSFTPFixture(t)
	target := desktopSFTPTestPath(filepath.Join(t.TempDir(), "edited.txt"))
	const content = "edited file body"
	ctx, id, cancel, err := files.beginFileMutation(context.Background(), desktopSFTPTaskWrite, "server", target, int64(len(content)))
	if err != nil {
		t.Fatal("file editing rejected as an upload without transfer intent", err)
	}
	defer cancel()
	if tasks.handler("sftp_write") != files {
		t.Fatal("file write cancellation handler missing")
	}
	if _, err := writeDesktopSFTPAtomic(ctx, client, target, 0600, func(file *sftp.File) error {
		_, err := file.Write([]byte(content))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := files.finishFileMutation(ctx, id, nil, 1, 0, int64(len(content)), int64(len(content)), map[string]any{"dest_path": target}); err != nil {
		t.Fatal(err)
	}
	run, err := tasks.getRun(id)
	if err != nil || run.TaskType != "sftp_write" || run.SourceType != "desktop_sftp" || run.Status != "succeeded" || run.SuccessCount != 1 || run.Retryable || strings.Contains(run.ResultJSON, content) || strings.Contains(run.PayloadJSON, content) {
		t.Fatalf("incorrect editing source/result: %+v %v", run, err)
	}
	var count int
	if err := tasks.db.QueryRow(`SELECT COUNT(*) FROM transfer_jobs WHERE id=?`, id).Scan(&count); err != nil || count != 0 {
		t.Fatalf("file edit counted as transfer: %d %v", count, err)
	}
	var kind string
	if err := tasks.db.QueryRow(`SELECT kind FROM activity_logs WHERE source_table='desktop_task_runs' AND source_id=?`, id).Scan(&kind); err != nil || kind != "execution" {
		t.Fatalf("editing activity misclassified: %s %v", kind, err)
	}
}

func TestFileMutationTimeoutDoesNotInventConfirmedFailure(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	files := NewDesktopSFTPService(nil, tasks, nil)
	ctx, id, cancel, err := files.beginFileMutation(context.Background(), desktopSFTPTaskWrite, "server", "/file", 0)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	result, err := files.finishFileMutation(ctx, id, context.DeadlineExceeded, 0, 1, 0, 0, map[string]any{"dest_path": "/file"})
	run, readErr := tasks.getRun(id)
	if err != nil || readErr != nil || result.Status != "timeout" || run.Status != "timeout" || run.FailureCount != 0 || run.SuccessCount != 0 {
		t.Fatalf("timeout invented file result: %+v %v %v", run, err, readErr)
	}
}

func TestMutationProtocolStatusAndDeadlineClassification(t *testing.T) {
	for _, code := range []uint32{6, 7} {
		if !errors.Is(desktopSFTPMutationError(&sftp.StatusError{Code: code}), errDesktopSFTPCommitUnknown) {
			t.Fatalf("transport status %d treated as a definite refusal", code)
		}
	}
	if errors.Is(desktopSFTPMutationError(os.ErrPermission), errDesktopSFTPCommitUnknown) {
		t.Fatal("confirmed refusal became unknown")
	}
	canceled, stop := context.WithCancel(context.Background())
	stop()
	refusal := &sftp.StatusError{Code: 3}
	if got := desktopSFTPOperationError(canceled, refusal); got != refusal {
		t.Fatalf("late cancellation replaced confirmed refusal: %v", got)
	}
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if err := desktopSFTPOperationError(ctx, io.EOF); !errors.Is(err, context.DeadlineExceeded) || errors.Is(err, errDesktopSFTPTaskCancelled) {
		t.Fatalf("deadline flattened to cancellation: %v", err)
	}
	for _, value := range []string{"", "relative", "/file\x00name"} {
		if _, err := desktopSFTPMutationPath(value); err == nil {
			t.Fatalf("invalid mutation path accepted: %q", value)
		}
	}
	if got, err := desktopSFTPMutationPath("/dir/ file "); err != nil || got != "/dir/ file " {
		t.Fatalf("legal path whitespace changed: %q %v", got, err)
	}
}
