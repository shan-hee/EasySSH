package app

import (
	"context"
	"database/sql"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"path/filepath"
	"testing"
)

type acceptedDesktopCancel struct{}

func (acceptedDesktopCancel) CancelDesktopTask(string) bool                   { return true }
func (acceptedDesktopCancel) RetryDesktopTask(DesktopTaskRun) (string, error) { return "", nil }

func desktopTaskFixture(t *testing.T) (*DesktopTaskService, string) {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "tasks.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := configureDesktopDatabase(db); err != nil {
		t.Fatal(err)
	}
	s := NewDesktopTaskService(nil)
	s.db = db
	id, err := s.create(desktopTaskCreateInput{Actor: desktopLocalActor(), TaskType: "script", Title: "script", Cancelable: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.start(id, "executing"); err != nil {
		t.Fatal(err)
	}
	return s, id
}

func TestDesktopCancelAcceptanceIsNotExecutionCompletion(t *testing.T) {
	s, id := desktopTaskFixture(t)
	s.registerHandler("script", acceptedDesktopCancel{})
	run, err := s.Cancel(id)
	if err != nil || run.Status != "canceling" || run.FinishedAt != "" || run.CancelRequestedAt == "" {
		t.Fatalf("cancel request claimed completion: %+v %v", run, err)
	}
	if err := s.complete(id, "canceled", "", "", "stopped", 2, 0); err != nil {
		t.Fatal(err)
	}
	details, err := s.Get(id)
	if err != nil || details.Run.Status != "canceled" || details.Run.SuccessCount != 2 {
		t.Fatalf("worker completion missing: %+v %v", details, err)
	}
	var mismatches int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM desktop_task_events WHERE task_run_id=? AND (actor_kind<>? OR actor_id<>? OR actor_session_id<>? OR actor_grant_id<>?)`, id, details.Run.Actor.Kind, details.Run.Actor.ID, details.Run.Actor.SessionID, details.Run.Actor.GrantID).Scan(&mismatches); err != nil || mismatches != 0 {
		t.Fatalf("task event lost initiating actor: %d %v", mismatches, err)
	}

}

func TestDesktopStateRollsBackWhenEventCannotBeSaved(t *testing.T) {
	s, id := desktopTaskFixture(t)
	if _, err := s.db.Exec(`CREATE TRIGGER reject_task_completion BEFORE INSERT ON desktop_task_events WHEN NEW.message='任务执行完成' BEGIN SELECT RAISE(ABORT,'event unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.complete(id, "succeeded", "", "", "", 1, 0); err == nil {
		t.Fatal("event failure hidden")
	}
	run, err := s.getRun(id)
	if err != nil || run.Status != "running" || run.FinishedAt != "" {
		t.Fatalf("state escaped failed transaction: %+v %v", run, err)
	}
	var projected string
	if err := s.db.QueryRow(`SELECT status FROM activity_logs WHERE source_table='desktop_task_runs' AND source_id=?`, id).Scan(&projected); err != nil || projected != "running" {
		t.Fatalf("projection escaped rollback: %s %v", projected, err)
	}
}

func TestDesktopActivityFailureRollsBackTaskAndDoesNotReplayWork(t *testing.T) {
	s, id := desktopTaskFixture(t)
	if _, err := s.db.Exec(`CREATE TRIGGER reject_activity BEFORE UPDATE ON activity_logs BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.complete(id, "succeeded", "", "", "", 1, 0); err == nil {
		t.Fatal("activity projection failure hidden")
	}
	run, err := s.getRun(id)
	if err != nil || run.Status != "running" {
		t.Fatalf("source state escaped transaction: %+v %v", run, err)
	}
}

func TestDesktopProgressAndRetriesCountOneLogicalWork(t *testing.T) {
	s, id := desktopTaskFixture(t)
	for i := 0; i < 3; i++ {
		if err := s.updateProgress(id, i*10, "working", 0, 0, i, 0); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(`UPDATE desktop_task_runs SET retryable=1 WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	if err := s.complete(id, "failed", "", "execution_failed", "", 0, 1); err != nil {
		t.Fatal(err)
	}
	retry, err := s.create(desktopTaskCreateInput{Actor: desktopLocalActor(), TaskType: "script", Title: "retry", RetryOfID: id, Attempt: 2})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.complete(retry, "succeeded", "", "", "", 1, 0); err != nil {
		t.Fatal(err)
	}
	first, _ := s.getRun(id)
	second, _ := s.getRun(retry)
	if first.WorkID != second.WorkID || first.WorkStartedAt != second.WorkStartedAt {
		t.Fatal("retry split logical work")
	}
	activity := &ActivityLogService{db: s.db}
	stats, err := activity.GetOverview(DesktopActivityOverviewRequest{})
	if err != nil || stats.Volume.Works != 1 || stats.Volume.ByStatus["success"] != 1 || stats.Volume.ByStatus["failure"] != 0 {
		t.Fatalf("retry counted twice: %+v %v", stats, err)
	}
	list, err := activity.List(DesktopActivityLogListParams{})
	if err != nil || list.Total != 2 {
		t.Fatalf("progress invented events or attempt lost: %+v %v", list, err)
	}
}

func TestDesktopTargetActivitiesKeepParentRelationship(t *testing.T) {
	s, id := desktopTaskFixture(t)
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE desktop_task_runs SET source_type='desktop_batch_task',source_id=? WHERE id=?`, id, id); err != nil {
		t.Fatal(err)
	}
	result := desktopBatchTaskResult{ID: "target", TaskID: id, ServerID: "server", ServerName: "name at execution", Status: "success", StartedAt: desktopTaskNow(), CompletedAt: desktopTaskNow()}
	if err := projectDesktopTaskTarget(tx, result, nil); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	activity := &ActivityLogService{db: s.db}
	stats, err := activity.GetOverview(DesktopActivityOverviewRequest{})
	if err != nil || stats.Volume.Works != 1 {
		t.Fatalf("parent and target added together: %+v %v", stats, err)
	}
	list, err := activity.List(DesktopActivityLogListParams{})
	if err != nil || list.Total != 2 {
		t.Fatalf("target trace missing: %+v %v", list, err)
	}
	for _, item := range list.Items {
		if item.SourceTable == "desktop_batch_task_results" && (item.ParentWorkID == "" || item.Actor != desktopLocalActor() || item.ServerName != "name at execution") {
			t.Fatal("target attribution missing")
		}
	}
}

func TestDesktopTaskActorMustComeFromLocalHost(t *testing.T) {
	s, _ := desktopTaskFixture(t)
	for _, actor := range []protocol.Actor{{}, {Kind: protocol.Visitor, ID: "session", SessionID: "session", GrantID: "grant"}, {Kind: protocol.Owner, ID: "local_owner", SessionID: "other"}} {
		if _, err := s.create(desktopTaskCreateInput{Actor: actor, TaskType: "script", Title: "invalid"}); err == nil {
			t.Fatal("foreign/missing attribution accepted as local owner")
		}
	}
}

func TestDesktopSFTPCancelWaitsForWorkerAndPreservesCompletedEffects(t *testing.T) {
	s, _ := desktopTaskFixture(t)
	files := NewDesktopSFTPService(nil, s, nil)
	id, err := files.createTransferTask(context.Background(), uuid.NewString(), 10, desktopTransferIntent{Kind: desktopSFTPTaskUpload, FileName: "file", TargetServerID: uuid.NewString(), SourcePaths: []string{"file"}, TargetPath: "/file"})
	if err != nil {
		t.Fatal(err)
	}
	if err := files.startTask(id, "uploading", 10); err != nil {
		t.Fatal(err)
	}
	if err := files.CancelUploadTask(id); err != nil {
		t.Fatal(err)
	}
	run, err := s.getRun(id)
	if err != nil || run.Status != "canceling" || run.FinishedAt != "" {
		t.Fatalf("SFTP cancel prematurely completed: %+v %v", run, err)
	}
	// The remote effect may have completed just before cancellation arrived.
	files.completeTask(id, "upload committed")
	run, err = s.getRun(id)
	if err != nil || run.Status != "succeeded" {
		t.Fatalf("completed upload was relabeled canceled: %+v %v", run, err)
	}

	id, err = files.createTask(desktopSFTPTaskDelete, uuid.NewString(), "files", 3, "server", "/files", "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := files.startTask(id, "running", 3); err != nil {
		t.Fatal(err)
	}
	if err := files.cancelAnyTask(id); err != nil {
		t.Fatal(err)
	}
	files.finishCanceledTask(id, 1, 0)
	run, err = s.getRun(id)
	if err != nil || run.Status != "canceled" || run.SuccessCount != 1 {
		t.Fatalf("partial effects lost: %+v %v", run, err)
	}
}
