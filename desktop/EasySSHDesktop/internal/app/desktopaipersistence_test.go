package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/easyssh/shared/resultstore"
)

func desktopAISnapshotFixture(t *testing.T) (*DesktopAIService, desktopAISessionRecord) {
	t.Helper()
	tasks, _ := desktopTaskFixture(t)
	ai := &DesktopAIService{db: tasks.db}
	now := time.Now().UTC().Truncate(time.Second).Format(desktopAITimeLayout)
	record := desktopAISessionRecord{ID: "snapshot", ConfigSpaceID: "local", Status: DesktopAISessionIdle, CreatedAt: now, UpdatedAt: now,
		Messages: []DesktopAIMessageView{{ID: "user", Role: "user", Content: "question", CreatedAt: now}},
	}
	if err := ai.saveSession(record); err != nil {
		t.Fatal(err)
	}
	return ai, record
}

func TestDesktopAISaveOrdersZeroAndNonzeroFractionalSeconds(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	base := time.Now().UTC().Truncate(time.Second)
	record.UpdatedAt = base.Format(time.RFC3339Nano)
	if err := ai.saveSession(record); err != nil {
		t.Fatal(err)
	}
	record.UpdatedAt, record.Title = base.Add(time.Nanosecond).Format(time.RFC3339Nano), "newer"
	if err := ai.saveSession(record); err != nil {
		t.Fatalf("fractional second sorted before whole second: %v", err)
	}
}

func TestDesktopAISnapshotConflictStopsOnlyItsActiveRequest(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	ctx, request, err := ai.beginAIRequest(context.Background(), record.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer ai.finishAIRequest(record.ID, request)
	newer := parseDesktopAITime(record.UpdatedAt).Add(time.Hour).Format(desktopAITimeLayout)
	if _, err := ai.db.Exec(`UPDATE desktop_ai_sessions SET title='imported',custom_title=1,updated_at=? WHERE id=?`, newer, record.ID); err != nil {
		t.Fatal(err)
	}
	record.Title, record.CustomTitle = "unsaved", true
	if err := ai.saveSession(record); !errors.Is(err, errDesktopAISnapshotConflict) || ctx.Err() == nil {
		t.Fatalf("stale save did not stop its turn: %v", err)
	}
	otherCtx, other, err := ai.beginAIRequest(context.Background(), "other")
	if err != nil {
		t.Fatal("failed conversation blocked unrelated admission", err)
	}
	if otherCtx.Err() != nil {
		t.Fatal("other request canceled")
	}
	ai.finishAIRequest("other", other)
	if _, err := ai.GetSession(record.ID); !errors.Is(err, errDesktopAISnapshotConflict) {
		t.Fatalf("failed active turn exposed unsaved state: %v", err)
	}
	ai.finishAIRequest(record.ID, request)
	view, err := ai.GetSession(record.ID)
	if err != nil || view.Session.Title != "imported" {
		t.Fatalf("reopen did not use stored version: %+v %v", view, err)
	}
}

func TestDesktopAIExhaustedWriterRecoversOnlyDurableIntent(t *testing.T) {
	ai, record := desktopAIExecutionFixture(t)
	record.Status, record.Tasks[0].Status = DesktopAISessionRunning, DesktopAITaskRunning
	if err := ai.saveSession(record); err != nil {
		t.Fatal(err)
	}
	_, request, err := ai.beginAIRequest(context.Background(), record.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Model an exhausted shared writer; retry timing is independent of recovery.
	ai.mu.Lock()
	request.StorageErr = resultstore.ErrUnavailable
	request.Cancel()
	ai.mu.Unlock()
	record.Tasks[0].Status, record.Tasks[0].Result = DesktopAITaskSucceeded, "uncommitted effect"
	if err := ai.saveSession(record); !errors.Is(err, resultstore.ErrUnavailable) {
		t.Fatalf("failed turn accepted a later write: %v", err)
	}
	ai.finishAIRequest(record.ID, request)
	if _, err := ai.GetSession(record.ID); err != nil {
		t.Fatal(err)
	}
	persisted, err := ai.loadSession(record.ID)
	if err != nil || persisted.Status != DesktopAISessionIdle || persisted.Tasks[0].Status != DesktopAITaskUnknown || persisted.Tasks[0].Result != "" {
		t.Fatalf("uncommitted result was promoted to a saved fact: %+v %v", persisted, err)
	}
	fact, err := scanDesktopAIExecution(ai.db.QueryRow(desktopAIExecutionSelect + ` WHERE task_id='tool'`))
	if err != nil || fact.Status != DesktopAITaskUnknown {
		t.Fatalf("source not reconciled: %+v %v", fact, err)
	}
}

func TestDesktopAIResultSaveRetriesTransientDatabaseFailure(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	if _, err := ai.db.Exec(`CREATE TRIGGER reject_ai_snapshot BEFORE UPDATE ON desktop_ai_sessions BEGIN SELECT RAISE(ABORT,'temporary storage failure'); END`); err != nil {
		t.Fatal(err)
	}
	record.Messages = append(record.Messages, DesktopAIMessageView{ID: "reply", Role: "assistant", Content: "observed answer"})
	record.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
	restored := make(chan error, 1)
	go func() {
		time.Sleep(150 * time.Millisecond)
		_, err := ai.db.Exec(`DROP TRIGGER reject_ai_snapshot`)
		restored <- err
	}()
	if err := ai.saveSession(record); err != nil {
		t.Fatal(err)
	}
	if err := <-restored; err != nil {
		t.Fatal(err)
	}
	record.Messages[1].Content = "caller changed"
	persisted, err := ai.loadSession(record.ID)
	if err != nil || len(persisted.Messages) != 2 || persisted.Messages[1].Content != "observed answer" {
		t.Fatalf("wrong saved result: %+v %v", persisted, err)
	}
}

func TestDesktopAIConfirmedResultsMergeFromCommittedRecord(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Tasks = []DesktopAITaskView{{ID: "first", Status: DesktopAITaskRunning}, {ID: "second", Status: DesktopAITaskRunning}}
	record.Status, record.UpdatedAt = DesktopAISessionRunning, time.Now().UTC().Format(desktopAITimeLayout)
	if err := ai.saveSession(record); err != nil {
		t.Fatal(err)
	}
	_, request, err := ai.beginAIRequest(context.Background(), record.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer ai.finishAIRequest(record.ID, request)
	for i, result := range []string{"first result", "second result"} {
		ai.sessionMu.Lock()
		current, err := ai.loadSession(record.ID)
		if err == nil {
			current.Tasks[i].Status, current.Tasks[i].Result = DesktopAITaskSucceeded, result
			current.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
			err = ai.saveSession(current)
		}
		ai.sessionMu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
	}
	saved, err := ai.loadSession(record.ID)
	if err != nil || saved.Tasks[0].Result != "first result" || saved.Tasks[1].Result != "second result" {
		t.Fatalf("sibling result lost: %+v %v", saved, err)
	}
}

func TestDesktopAIShutdownWaitsForFinalWriteBeforeClosingDatabase(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	var seq int
	var name, path string
	if err := ai.db.QueryRow(`PRAGMA database_list`).Scan(&seq, &name, &path); err != nil {
		t.Fatal(err)
	}
	observer, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer observer.Close()
	ctx, request, err := ai.beginAIRequest(context.Background(), record.ID)
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() { finished <- ai.ServiceShutdown() }()
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("shutdown did not cancel execution")
	}
	select {
	case err := <-finished:
		t.Fatalf("shutdown closed before worker completion: %v", err)
	default:
	}
	record.Messages = append(record.Messages, DesktopAIMessageView{ID: "reply", Role: "assistant", Content: "partial result", StoppedAt: desktopTaskNow()})
	record.Status, record.UpdatedAt = DesktopAISessionIdle, time.Now().UTC().Format(desktopAITimeLayout)
	if err := ai.saveSession(record); err != nil {
		ai.finishAIRequest(record.ID, request)
		t.Fatal(err)
	}
	ai.finishAIRequest(record.ID, request)
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown did not finish")
	}
	var data string
	if err := observer.QueryRow(`SELECT payload FROM desktop_ai_messages WHERE session_id=? AND item_id='reply'`, record.ID).Scan(&data); err != nil {
		t.Fatal(err)
	}
	var message DesktopAIMessageView
	if err := json.Unmarshal([]byte(data), &message); err != nil || message.Content != "partial result" {
		t.Fatalf("final write missing: %s %v", data, err)
	}
	if _, err := ai.database(); err == nil {
		t.Fatal("closed service reopened database")
	}
	if err := ai.ServiceShutdown(); err != nil {
		t.Fatal(err)
	}
}
