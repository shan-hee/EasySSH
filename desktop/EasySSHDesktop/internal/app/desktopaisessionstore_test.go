package app

import (
	"context"
	"testing"
	"time"

	"github.com/easyssh/shared/syncdata"
)

func TestDesktopAIAppendAndRetryDoNotRewriteStoredItems(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	for _, statement := range []string{
		`CREATE TRIGGER reject_old_message_update BEFORE UPDATE ON desktop_ai_messages WHEN OLD.item_id='user' BEGIN SELECT RAISE(ABORT,'old message rewritten'); END`,
		`CREATE TRIGGER reject_old_message_delete BEFORE DELETE ON desktop_ai_messages WHEN OLD.item_id='user' BEGIN SELECT RAISE(ABORT,'old message deleted'); END`,
	} {
		if _, err := ai.db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	record.Messages = append(record.Messages, DesktopAIMessageView{ID: "reply", Role: "assistant", Content: "answer", CreatedAt: record.CreatedAt})
	record.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
	for i := 0; i < 2; i++ {
		if err := ai.saveSessionRaw(context.Background(), record); err != nil {
			t.Fatal("append/retry rewrote prior message", err)
		}
	}
	loaded, err := ai.loadSession(record.ID)
	if err != nil || len(loaded.Messages) != 2 || loaded.Messages[0].Content != "question" || loaded.Messages[1].Content != "answer" {
		t.Fatalf("append lost history: %+v %v", loaded, err)
	}
}

func TestDesktopAIItemFailureRollsBackMetadataAndMessages(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	if _, err := ai.db.Exec(`CREATE TRIGGER reject_new_task BEFORE INSERT ON desktop_ai_session_tasks BEGIN SELECT RAISE(ABORT,'task write failed'); END`); err != nil {
		t.Fatal(err)
	}
	before := record.UpdatedAt
	record.Title, record.CustomTitle = "not committed", true
	record.Messages[0].Content = "not committed"
	record.Tasks = []DesktopAITaskView{{ID: "tool", Status: DesktopAITaskQueued}}
	record.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
	if err := ai.saveSessionRaw(context.Background(), record); err == nil {
		t.Fatal("task failure hidden")
	}
	loaded, err := ai.loadSession(record.ID)
	if err != nil || loaded.UpdatedAt != before || loaded.CustomTitle || len(loaded.Tasks) != 0 || len(loaded.Messages) != 1 || loaded.Messages[0].Content != "question" {
		t.Fatalf("partial save survived rollback: %+v %v", loaded, err)
	}
	list, err := ai.ListSessions(DesktopAIListSessionsParams{Q: "not committed"})
	if err != nil || list.Total != 0 {
		t.Fatalf("partial list index survived rollback: %+v %v", list, err)
	}
}

func TestDesktopAIItemReorderTruncationAndSessionDeletion(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Messages = append(record.Messages, DesktopAIMessageView{ID: "reply", Role: "assistant", Content: "answer", CreatedAt: record.CreatedAt})
	record.Tasks = []DesktopAITaskView{{ID: "tool", Status: DesktopAITaskSucceeded}}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	record.Messages[0], record.Messages[1] = record.Messages[1], record.Messages[0]
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	loaded, err := ai.loadSession(record.ID)
	if err != nil || len(loaded.Messages) != 2 || loaded.Messages[0].ID != "reply" || loaded.Messages[1].ID != "user" {
		t.Fatalf("item order lost: %+v %v", loaded, err)
	}
	record.Messages, record.Tasks = record.Messages[:1], nil
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	loaded, err = ai.loadSession(record.ID)
	if err != nil || len(loaded.Messages) != 1 || loaded.Messages[0].ID != "reply" || len(loaded.Tasks) != 0 {
		t.Fatalf("removed items survived: %+v %v", loaded, err)
	}
	if err := ai.DeleteSession(record.ID); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"desktop_ai_messages", "desktop_ai_session_tasks"} {
		var count int
		if err := ai.db.QueryRow("SELECT COUNT(*) FROM "+table+" WHERE session_id=?", record.ID).Scan(&count); err != nil || count != 0 {
			t.Fatal("session deletion left items", table, count, err)
		}
	}
}

func TestDesktopAICorruptMessageIsNotSilentlyReplacedWithEmptyHistory(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	for _, payload := range []string{`invalid-json`, `{"id":"wrong","role":"user"}`} {
		if _, err := ai.db.Exec(`UPDATE desktop_ai_messages SET payload=? WHERE session_id=?`, payload, record.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := ai.loadSession(record.ID); err == nil {
			t.Fatal("invalid persisted item accepted", payload)
		}
	}
}

func TestDesktopAIDuplicateItemIDsCannotPartiallyReplaceHistory(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Messages[0].Content = "not committed"
	record.Messages = append(record.Messages, record.Messages[0])
	if err := ai.saveSessionRaw(context.Background(), record); err == nil {
		t.Fatal("duplicate item identity accepted")
	}
	loaded, err := ai.loadSession(record.ID)
	if err != nil || len(loaded.Messages) != 1 || loaded.Messages[0].Content != "question" {
		t.Fatalf("duplicate item corrupted history: %+v %v", loaded, err)
	}
}

func TestDesktopAISyncExportReadsItemsAndDoesNotCarryNativeExecution(t *testing.T) {
	ai, record := desktopAIExecutionFixture(t)
	record.Tasks[0].Status = DesktopAITaskSucceeded
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	service := &DesktopSyncService{ai: ai}
	tx, err := ai.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	payload, err := service.captureLocalVault(tx, DesktopVaultState{Kind: "ai_session", SpaceID: "local", LocalID: record.ID})
	if err != nil || payload == nil || payload.Conversation == nil || len(payload.Conversation.Tasks) != 1 {
		t.Fatalf("item export failed: %+v %v", payload, err)
	}
	if err := service.applyLocalVault(tx, DesktopVaultState{Kind: "ai_session", SpaceID: "local", LocalID: "imported"}, syncdata.VaultPayload{Kind: "ai_session", Conversation: payload.Conversation}, "sync"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	loaded, err := ai.loadSession("imported")
	if err != nil || len(loaded.Tasks) != 1 || len(loaded.ExecutionOrigins) != 0 || loaded.PermissionMode != DesktopAIPermissionReadonly {
		t.Fatalf("sync imported native authority: %+v %v", loaded, err)
	}
	var facts int
	if err := ai.db.QueryRow(`SELECT COUNT(*) FROM desktop_ai_tool_executions`).Scan(&facts); err != nil || facts != 1 {
		t.Fatal("sync duplicated native work", facts, err)
	}
}

func TestDesktopAISyncDeletionClearsItemsAndFinalizesOnlyUnstartedWork(t *testing.T) {
	for _, status := range []DesktopAITaskStatus{DesktopAITaskQueued, DesktopAITaskRunning} {
		t.Run(string(status), func(t *testing.T) {
			ai, record := desktopAIExecutionFixture(t)
			record.Tasks[0].Status = status
			if err := ai.saveSessionRaw(context.Background(), record); err != nil {
				t.Fatal(err)
			}
			service := &DesktopSyncService{ai: ai}
			tx, err := ai.db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			err = service.applyLocalVault(tx, DesktopVaultState{Kind: "ai_session", SpaceID: "local", LocalID: record.ID}, syncdata.VaultPayload{Kind: "ai_session", Deleted: true}, "sync")
			if status == DesktopAITaskRunning {
				if err == nil {
					t.Fatal("sync deleted running execution")
				}
				if err := tx.Rollback(); err != nil {
					t.Fatal(err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if err := tx.Commit(); err != nil {
					t.Fatal(err)
				}
			}
			fact, err := scanDesktopAIExecution(ai.db.QueryRow(desktopAIExecutionSelect+` WHERE session_id=?`, record.ID))
			wantStatus, wantCount := DesktopAITaskCancelled, 0
			if status == DesktopAITaskRunning {
				wantStatus, wantCount = DesktopAITaskRunning, 1
			}
			if err != nil || fact.Status != wantStatus {
				t.Fatalf("sync deletion changed native fact incorrectly: %+v %v", fact, err)
			}
			for _, table := range []string{"desktop_ai_messages", "desktop_ai_session_tasks"} {
				var count int
				if err := ai.db.QueryRow("SELECT COUNT(*) FROM "+table+" WHERE session_id=?", record.ID).Scan(&count); err != nil || count != wantCount {
					t.Fatal("sync deletion changed wrong history", table, count, err)
				}
			}
		})
	}
}
