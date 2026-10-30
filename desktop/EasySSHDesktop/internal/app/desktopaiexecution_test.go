package app

import (
	"context"
	"github.com/google/uuid"
	"testing"
	"time"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/syncdata"
)

func desktopAIExecutionFixture(t *testing.T) (*DesktopAIService, desktopAISessionRecord) {
	t.Helper()
	ai, record := desktopAISnapshotFixture(t)
	record.ExecutionOrigins = map[string]desktopAIExecutionOrigin{"tool": {Actor: desktopLocalActor(), ServerID: "server", ServerName: "original server"}}
	record.Tasks = []DesktopAITaskView{{ID: "tool", ToolName: "write_file", Status: DesktopAITaskQueued, CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt}}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	return ai, record
}

func TestDesktopAIExecutionAndActivityRollbackTogether(t *testing.T) {
	ai, record := desktopAIExecutionFixture(t)
	if _, err := ai.db.Exec(`CREATE TRIGGER reject_ai_projection BEFORE UPDATE ON activity_logs WHEN NEW.source_table='desktop_ai_tool_executions' AND NEW.status='success' BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	record.Tasks[0].Status = DesktopAITaskSucceeded
	record.UpdatedAt = parseDesktopAITime(record.UpdatedAt).Add(time.Second).Format(desktopAITimeLayout)
	record.Tasks[0].UpdatedAt = record.UpdatedAt
	if err := ai.saveSessionRaw(context.Background(), record); err == nil {
		t.Fatal("failed activity committed")
	}
	saved, err := ai.loadSession(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	fact, err := scanDesktopAIExecution(ai.db.QueryRow(desktopAIExecutionSelect + ` WHERE task_id='tool'`))
	if err != nil {
		t.Fatal(err)
	}
	if saved.Tasks[0].Status != DesktopAITaskQueued || fact.Status != DesktopAITaskQueued {
		t.Fatal("partial transaction committed")
	}
	if _, err := ai.db.Exec(`DROP TRIGGER reject_ai_projection`); err != nil {
		t.Fatal(err)
	}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if _, err := ai.db.Exec(`DELETE FROM activity_logs WHERE source_table='desktop_ai_tool_executions'`); err != nil {
		t.Fatal(err)
	}
	record.Title = "renamed"
	record.UpdatedAt = parseDesktopAITime(record.UpdatedAt).Add(time.Second).Format(desktopAITimeLayout)
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := ai.db.QueryRow(`SELECT COUNT(*) FROM activity_logs WHERE source_table='desktop_ai_tool_executions'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("pruned activity recreated: %d %v", count, err)
	}
}

func TestDesktopAIChildFileWorkDoesNotCountAsAnotherRoot(t *testing.T) {
	ai, record := desktopAIExecutionFixture(t)
	record.Tasks[0].Status = DesktopAITaskRunning
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	tasks := NewDesktopTaskService(nil)
	tasks.db = ai.db
	parentID := desktopAIExecutionID(record.ID, "tool")
	id := uuid.NewString()
	files := &DesktopSFTPService{taskCenter: tasks}
	ctx := context.WithValue(context.Background(), desktopAIExecutionContextKey{}, desktopAIExecutionParent{ID: parentID, Actor: desktopLocalActor()})
	if err := files.syncTaskCenterTask(ctx, desktopSFTPTaskChmod, id, 0, "server", "/file", "", 1, nil, nil); err != nil {
		t.Fatal(err)
	}
	child, err := scanDesktopTaskRun(ai.db.QueryRow(desktopTaskSelectSQL+` WHERE id=?`, id))
	if err != nil {
		t.Fatal(err)
	}
	if child.ParentWorkID != parentID || child.Retryable || child.WorkStartedAt != record.CreatedAt {
		t.Fatalf("child linkage invalid: %+v", child)
	}
	activity := &ActivityLogService{db: ai.db}
	overview, err := activity.getOverview(context.Background(), DesktopActivityOverviewRequest{ServerID: "server"}, time.Now().UTC().Add(time.Second))
	if err != nil || overview.Volume.Works != 1 || overview.Targets.Works != 1 {
		t.Fatalf("file work counted twice: roots=%d targets=%d err=%v", overview.Volume.Works, overview.Targets.Works, err)
	}
	if _, err := tasks.create(desktopTaskCreateInput{Actor: desktopLocalActor(), ParentWorkID: parentID, ServerID: "other", TaskType: "sftp_upload"}); err == nil {
		t.Fatal("child escaped parent target")
	}
}

func TestDesktopAIImportClearsPrivateExecutionOrigins(t *testing.T) {
	ai, record := desktopAIExecutionFixture(t)
	record.Tasks[0].Status = DesktopAITaskSucceeded
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	tx, err := ai.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	service := &DesktopSyncService{ai: ai}
	payload := syncdata.VaultPayload{Kind: "ai_session", Conversation: &syncdata.Conversation{CreatedAt: time.Now(), Messages: []aichatui.MessageView{{ID: "import", Role: "user", Content: "imported"}}, Tasks: []aichatui.TaskView{{ID: "foreign", ToolName: "execute_command", Status: aichatui.TaskStatusSucceeded}}}}
	if err := service.applyLocalVault(tx, DesktopVaultState{Kind: "ai_session", LocalID: record.ID, SpaceID: "local"}, payload, "sync"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	loaded, err := ai.loadSession(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.ExecutionOrigins) != 0 {
		t.Fatal("import retained local execution provenance")
	}
	if err := ai.saveSessionRaw(context.Background(), loaded); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := ai.db.QueryRow(`SELECT COUNT(*) FROM desktop_ai_tool_executions`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("import forged local work: %d %v", count, err)
	}
}

func TestDesktopAIRecoveryAndDeletionKeepExecutionFacts(t *testing.T) {
	ai, record := desktopAIExecutionFixture(t)
	record.Tasks[0].Status = DesktopAITaskRunning
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if err := ai.recoverAIExecutionFacts(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := ai.recoverInterruptedAITasks(context.Background()); err != nil {
		t.Fatal(err)
	}
	fact, err := scanDesktopAIExecution(ai.db.QueryRow(desktopAIExecutionSelect + ` WHERE task_id='tool'`))
	if err != nil {
		t.Fatal(err)
	}
	if fact.Status != DesktopAITaskUnknown || fact.FinishedAt != record.UpdatedAt || fact.RecoveredAt == "" {
		t.Fatalf("recovery invented outcome or duration: %+v", fact)
	}
	if err := ai.DeleteSession(record.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := scanDesktopAIExecution(ai.db.QueryRow(desktopAIExecutionSelect + ` WHERE task_id='tool'`)); err != nil {
		t.Fatalf("history deletion erased source: %v", err)
	}
}

func TestDesktopAIChildRetainsOriginAcrossOwnerProcessRestart(t *testing.T) {
	ai, record := desktopAIExecutionFixture(t)
	// Waiting work was requested by a previous process of the same native owner.
	origin := record.ExecutionOrigins["tool"]
	origin.Actor.SessionID = "previous-process"
	// Establish a separate source so its immutable original actor is not rewritten.
	record.ID = "older-session"
	record.ExecutionOrigins["tool"] = origin
	record.Tasks[0].Status = DesktopAITaskRunning
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	tasks := NewDesktopTaskService(nil)
	tasks.db = ai.db
	_, err := tasks.create(desktopTaskCreateInput{Actor: origin.Actor, ParentWorkID: desktopAIExecutionID(record.ID, "tool"), ServerID: "server", TaskType: "sftp_chmod"})
	if err != nil {
		t.Fatalf("authorized parent origin could not be retained: %v", err)
	}
	if _, err := tasks.create(desktopTaskCreateInput{Actor: origin.Actor, TaskType: "script"}); err == nil {
		t.Fatal("unrelated old actor bypassed native admission")
	}
}
