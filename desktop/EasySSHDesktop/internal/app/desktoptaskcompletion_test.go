package app

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"io"
	"strings"
	"testing"
	"time"
)

type neverReplayDesktopTask struct{}

func (neverReplayDesktopTask) CancelDesktopTask(string) bool {
	panic("persistence retry must not cancel an execution")
}
func (neverReplayDesktopTask) RetryDesktopTask(DesktopTaskRun) (string, error) {
	panic("persistence retry must not replay an execution")
}

func TestDesktopCompletionMetricsAndActivityCommitTogether(t *testing.T) {
	s, id := desktopTaskFixture(t)
	s.registerHandler("script", neverReplayDesktopTask{})
	if _, err := s.db.Exec(`CREATE TRIGGER reject_final_activity BEFORE UPDATE ON activity_logs WHEN NEW.status='partial' BEGIN SELECT RAISE(ABORT,'store unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	outcome := desktopTaskCompletion{ResultJSON: `{"bytes_completed":8}`, Status: "partial_success", SuccessCount: 1, FailureCount: 1, Metrics: &desktopTaskFinalMetrics{Processed: 10, Total: 20, Completed: 8}}
	if _, err := s.persistCompletion(context.Background(), id, outcome); err == nil {
		t.Fatal("storage failure hidden")
	}
	run, err := s.getRun(id)
	if err != nil || run.Status != "running" || run.BytesProcessed != 0 || run.BytesCompleted != 0 {
		t.Fatalf("uncommitted outcome misrepresented: %+v %v", run, err)
	}
	if _, err := s.db.Exec(`DROP TRIGGER reject_final_activity`); err != nil {
		t.Fatal(err)
	}
	if err := s.completeOutcome(id, outcome); err != nil {
		t.Fatal(err)
	}
	saved, err := s.getRun(id)
	if err != nil || saved.Status != "partial_success" || saved.BytesProcessed != 10 || saved.BytesTotal != 20 || saved.BytesCompleted != 8 {
		t.Fatalf("receipt-only retry failed: %+v %v", saved, err)
	}
	item, err := scanDesktopActivity(s.db.QueryRow(desktopActivitySelectSQL+` WHERE source_table='desktop_task_runs' AND source_id=?`, id))
	if err != nil || item.BytesProcessed != 10 || item.BytesCompleted != 8 || item.Status != "partial" || item.Detail != outcome.ResultJSON {
		t.Fatalf("activity diverged: %+v %v", item, err)
	}
}

func desktopBatchCompletionFixture(t *testing.T) (*DesktopTaskService, string) {
	t.Helper()
	s, _ := desktopTaskFixture(t)
	id := uuid.NewString()
	now := desktopTaskNow()
	if _, err := s.db.Exec(`INSERT INTO desktop_batch_tasks(id,task_name,task_type,content,server_ids_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, id, "commands", "command", "printf result", `["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"]`, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := s.create(desktopTaskCreateInput{Actor: desktopLocalActor(), ID: id, TaskType: "command", Title: "commands", SourceType: "desktop_batch_task", SourceID: id, TotalCount: 2}); err != nil {
		t.Fatal(err)
	}
	if err := s.start(id, "executing"); err != nil {
		t.Fatal(err)
	}
	return s, id
}

func TestDesktopBatchSourceTargetsAndRootShareFinalTransaction(t *testing.T) {
	s, id := desktopBatchCompletionFixture(t)
	now := desktopTaskNow()
	target := desktopBatchTaskResult{ID: "target", TaskID: id, ServerID: "11111111-1111-4111-8111-111111111111", Status: "success", Output: "effect already happened", StartedAt: now, CompletedAt: now}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_batch_completion BEFORE UPDATE ON desktop_batch_tasks WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'source update unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	outcome := desktopTaskCompletion{Status: "succeeded", SuccessCount: 1, Targets: []desktopBatchTaskResult{target}}
	if _, err := s.persistCompletion(context.Background(), id, outcome); err == nil {
		t.Fatal("source failure hidden")
	}
	var state string
	var count int
	if err := s.db.QueryRow(`SELECT status FROM desktop_batch_tasks WHERE id=?`, id).Scan(&state); err != nil || state != "running" {
		t.Fatalf("batch source escaped rollback: %s %v", state, err)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM desktop_batch_task_results WHERE task_id=?`, id).Scan(&count); err != nil || count != 0 {
		t.Fatal("targets escaped rollback")
	}
	if _, err := s.db.Exec(`DROP TRIGGER reject_batch_completion`); err != nil {
		t.Fatal(err)
	}
	if err := s.completeOutcome(id, outcome); err != nil {
		t.Fatal(err)
	}
	if err := s.completeOutcome(id, outcome); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT status FROM desktop_batch_tasks WHERE id=?`, id).Scan(&state); err != nil || state != "completed" {
		t.Fatal("source did not commit")
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM desktop_batch_task_results WHERE task_id=?`, id).Scan(&count); err != nil || count != 1 {
		t.Fatal("receipt replay duplicated target")
	}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	target.Output = "different effect"
	if err := saveDesktopTaskTarget(tx, target); err == nil {
		t.Fatal("stored target was silently rewritten")
	}
}

func TestDesktopCanceledBatchDoesNotCountUnstartedTargetsAsFailures(t *testing.T) {
	s, id := desktopBatchCompletionFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	scripts := &DesktopScriptService{db: s.db, taskCenter: s, executionSlots: make(chan struct{}, 8)}
	scripts.runBatchTask(ctx, id, id) // no server service exists: an SSH call would fail this fixture
	run, err := s.getRun(id)
	if err != nil || run.Status != "canceled" || run.FailureCount != 0 || run.SuccessCount != 0 {
		t.Fatalf("unstarted target counted as failure: %+v %v", run, err)
	}
	var result map[string]int
	if err := json.Unmarshal([]byte(run.ResultJSON), &result); err != nil || result["canceled_count"] != 2 {
		t.Fatalf("canceled target facts missing: %s %v", run.ResultJSON, err)
	}
}

func TestDesktopPendingResultAfterRestartBecomesUnknownWithoutReplay(t *testing.T) {
	s, id := desktopTaskFixture(t)
	if err := s.updateProgress(id, 25, "working", 50, 200, 1, 0); err != nil {
		t.Fatal(err)
	}
	if err := s.recoverInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	run, err := s.getRun(id)
	if err != nil || run.Status != "unknown" || run.SuccessCount != 1 || run.BytesProcessed != 50 || desktopTaskIsRetryableStatus(run.Status) {
		t.Fatalf("restart invented a definite outcome: %+v %v", run, err)
	}
}

func TestDesktopTargetOutputStorageIsBounded(t *testing.T) {
	scripts := &DesktopScriptService{}
	observed := scripts.finishBatchTaskServerResult(desktopBatchTaskResult{Output: strings.Repeat("界", 100000), ErrorMessage: strings.Repeat("错", 5000)}, time.Now().UTC())
	if len(observed.Result.Output) > 65560 || len(observed.Result.ErrorMessage) > 4096 {
		t.Fatal("unbounded result retained")
	}
}

type shortDesktopTransferWriter struct{}

func (shortDesktopTransferWriter) Write(p []byte) (int, error) { return 2, io.ErrShortWrite }

func TestDesktopTransferProgressCountsAcceptedWrites(t *testing.T) {
	var counted int64
	writer := newDesktopSFTPProgressWriter(shortDesktopTransferWriter{}, 10, func(loaded, total int64) error { counted = loaded; return nil })
	n, err := writer.Write([]byte("1234567890"))
	if n != 2 || counted != 2 || !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("read bytes counted as committed writes: n=%d counted=%d err=%v", n, counted, err)
	}
}

func TestDesktopTransferPartialCompletionKeepsTrafficAndCompletedBytesSeparate(t *testing.T) {
	s, _ := desktopTaskFixture(t)
	files := NewDesktopSFTPService(nil, s, nil)
	id, err := files.createTransferTask(context.Background(), uuid.NewString(), 20, desktopTransferIntent{Kind: desktopSFTPTaskTransfer, FileName: "files", SourceServerID: uuid.NewString(), TargetServerID: uuid.NewString(), SourcePaths: []string{"/files"}, TargetPath: "/destination"})
	if err != nil {
		t.Fatal(err)
	}
	if err := files.startTask(id, "transferring", 20); err != nil {
		t.Fatal(err)
	}
	if err := files.updateTaskProgress(id, 12, 20, "stream"); err != nil {
		t.Fatal(err)
	}
	files.failTaskOutcome(id, errors.New("second file failed"), 1, 1, 10)
	run, err := s.getRun(id)
	if err != nil || run.Status != "partial_success" || run.BytesProcessed != 12 || run.BytesCompleted != 10 || run.SuccessCount != 1 || run.FailureCount != 1 {
		t.Fatalf("partial completion lost: %+v %v", run, err)
	}
}

type desktopCancelDuringWrite struct{ cancel func() error }

func (w desktopCancelDuringWrite) Write(p []byte) (int, error) {
	return len(p), w.cancel()
}

func TestDesktopTransferCancellationKeepsLastAcceptedWrite(t *testing.T) {
	s, _ := desktopTaskFixture(t)
	files := NewDesktopSFTPService(nil, s, nil)
	id, err := files.createTransferTask(context.Background(), uuid.NewString(), 10, desktopTransferIntent{Kind: desktopSFTPTaskUpload, FileName: "file", TargetServerID: uuid.NewString(), SourcePaths: []string{"file"}, TargetPath: "/file"})
	if err != nil {
		t.Fatal(err)
	}
	if err = files.startTask(id, "uploading", 10); err != nil {
		t.Fatal(err)
	}
	writer := newDesktopSFTPProgressWriter(desktopCancelDuringWrite{func() error { return files.CancelUploadTask(id) }}, 10, func(loaded, total int64) error {
		return files.updateTaskProgress(id, loaded, total, "stream")
	})
	if n, err := writer.Write([]byte("data")); n != 4 || !errors.Is(err, errDesktopSFTPTaskCancelled) {
		t.Fatalf("write interruption lost: %d %v", n, err)
	}
	files.failTask(id, errDesktopSFTPTaskCancelled)
	run, err := s.getRun(id)
	if err != nil || run.Status != "canceled" || run.BytesProcessed != 4 || run.BytesCompleted != 0 {
		t.Fatalf("last accepted write disappeared: %+v %v", run, err)
	}
}
