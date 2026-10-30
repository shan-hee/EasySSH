package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiprovider"
	"github.com/easyssh/shared/syncdata"
)

func TestDesktopAIListUsesVisibleSummaryWithoutPayloadDecode(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Messages = []DesktopAIMessageView{{ID: "user", Role: "user", Content: "ÄBC 100%_!", CreatedAt: record.CreatedAt}, {ID: "reply", Role: "assistant", Content: "latest answer", CreatedAt: record.CreatedAt}}
	record.Tasks = []DesktopAITaskView{{ID: "task"}}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"desktop_ai_messages", "desktop_ai_session_tasks"} {
		if _, err := ai.db.Exec("UPDATE "+table+" SET payload='invalid-json' WHERE session_id=?", record.ID); err != nil {
			t.Fatal(err)
		}
	}
	for _, query := range []string{"äbc", "%_!"} {
		result, err := ai.ListSessions(DesktopAIListSessionsParams{Q: query})
		if err != nil || result.Total != 1 || len(result.Items) != 1 {
			t.Fatalf("list: %+v %v", result, err)
		}
		item := result.Items[0]
		if item.MessageCount != 2 || item.TaskCount != 1 || !strings.Contains(item.Preview, "ÄBC 100%_!") {
			t.Fatalf("incorrect summary: %+v", item)
		}
	}
	result, err := ai.ListSessions(DesktopAIListSessionsParams{Q: "invalid-json"})
	if err != nil || result.Total != 0 {
		t.Fatalf("JSON entered search: %+v %v", result, err)
	}
	if _, err := ai.ListSessions(DesktopAIListSessionsParams{Q: strings.Repeat("x", aichatui.MaxSessionSearchBytes+1)}); err != aichatui.ErrSessionSearchTooLong {
		t.Fatalf("search not bounded: %v", err)
	}
}
func TestDesktopAIIndexFollowsEditsAndFailedSaveRollsBack(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	if _, err := ai.db.Exec(`CREATE TRIGGER reject_history_index BEFORE UPDATE ON desktop_ai_sessions WHEN NEW.preview='changed' BEGIN SELECT RAISE(ABORT,'index failed'); END`); err != nil {
		t.Fatal(err)
	}
	record.Messages[0].Content = "changed"
	record.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
	if err := ai.saveSessionRaw(context.Background(), record); err == nil {
		t.Fatal("index failure hidden")
	}
	result, err := ai.ListSessions(DesktopAIListSessionsParams{Q: "question"})
	if err != nil || result.Total != 1 {
		t.Fatalf("failed save changed index: %+v %v", result, err)
	}
	if _, err := ai.db.Exec(`DROP TRIGGER reject_history_index`); err != nil {
		t.Fatal(err)
	}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	result, err = ai.ListSessions(DesktopAIListSessionsParams{Q: "question"})
	if err != nil || result.Total != 0 {
		t.Fatalf("old text survived edit: %+v %v", result, err)
	}
	result, err = ai.ListSessions(DesktopAIListSessionsParams{Q: "changed"})
	if err != nil || result.Total != 1 || result.Items[0].Preview != "changed" {
		t.Fatalf("index did not follow edit: %+v %v", result, err)
	}
}

func TestDesktopAIRejectedEditLeavesSourceAndIndexUnchanged(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	_, err := ai.UpdateMessage(DesktopAIUpdateMessageInput{SessionID: record.ID, MessageID: "user", Content: strings.Repeat("x", aiprovider.MaxRequestTextBytes+1)})
	var limit *aiprovider.ProviderError
	if !errors.As(err, &limit) || limit.Code != "ai_context_limit" {
		t.Fatalf("oversized edit: %v", err)
	}
	saved, err := ai.loadSession(record.ID)
	if err != nil || len(saved.Messages) != 1 || saved.Messages[0].Content != "question" {
		t.Fatalf("rejected edit changed source: %+v %v", saved, err)
	}
	result, err := ai.ListSessions(DesktopAIListSessionsParams{Q: "question"})
	if err != nil || result.Total != 1 {
		t.Fatalf("rejected edit changed index: %+v %v", result, err)
	}
}

func TestDesktopAISyncProjectionUpdatesSummaryAndClearsScope(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Scope = &DesktopAISessionScope{Kind: "terminal", ServerID: "old-server", TerminalSessionID: "old-terminal"}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	service := &DesktopSyncService{ai: ai}
	tx, err := ai.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	payload := syncdata.VaultPayload{Kind: "ai_session", Conversation: &syncdata.Conversation{Title: "Synced", CreatedAt: time.Now(), Messages: []aichatui.MessageView{{ID: "user", Role: "user", Content: "synced body"}}, Tasks: []aichatui.TaskView{{ID: "tool", Status: aichatui.TaskStatusSucceeded}}}}
	if err = service.applyLocalVault(tx, DesktopVaultState{Kind: "ai_session", LocalID: record.ID, SpaceID: "local"}, payload, "sync"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	result, err := ai.ListSessions(DesktopAIListSessionsParams{Q: "synced body"})
	if err != nil || result.Total != 1 || result.Items[0].Title != "Synced" || result.Items[0].MessageCount != 1 || result.Items[0].TaskCount != 1 {
		t.Fatalf("sync summary: %+v %v", result, err)
	}
	result, err = ai.ListSessions(DesktopAIListSessionsParams{ScopeKind: "terminal", ServerID: "old-server"})
	if err != nil || result.Total != 0 {
		t.Fatalf("sync retained obsolete scope: %+v %v", result, err)
	}
}

func TestDesktopAIHistoryLimitKeepsObservedResultAndCancelsNextTool(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Messages = make([]DesktopAIMessageView, aichatui.MaxHistoryMessages+1)
	for i := range record.Messages {
		record.Messages[i] = DesktopAIMessageView{ID: fmt.Sprintf("message-%d", i), Role: "assistant", CreatedAt: record.CreatedAt}
	}
	record.Messages[0] = DesktopAIMessageView{ID: "observed", Role: "assistant", Reasoning: "preserved", CreatedAt: record.CreatedAt}
	record.Tasks = []DesktopAITaskView{{ID: "next", ToolName: "create_artifact", Status: DesktopAITaskQueued}}
	// The save layer accepts a receipt even after an admitted call crosses the cap.
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	_, err := ai.executeDesktopAITask(context.Background(), record, "next")
	var limit *aiprovider.ProviderError
	if !errors.As(err, &limit) || limit.Code != "ai_history_limit" {
		t.Fatalf("new work accepted: %v", err)
	}
	saved, err := ai.loadSession(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Messages) != len(record.Messages) || saved.Messages[0].Reasoning != "preserved" {
		t.Fatal("observed history lost")
	}
	if saved.Tasks[0].Status != DesktopAITaskCancelled || saved.Status != DesktopAISessionIdle {
		t.Fatalf("undispatched task remained active: %s / %s", saved.Tasks[0].Status, saved.Status)
	}
}
