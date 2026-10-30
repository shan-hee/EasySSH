package app

import (
	"context"
	"testing"

	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/protocol"
)

func TestDesktopAIHistoryDoesNotDecodeOtherPagesOrTaskPayloads(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Messages = append(record.Messages,
		DesktopAIMessageView{ID: "reply", Role: "assistant", Content: "answer", CreatedAt: record.CreatedAt},
		DesktopAIMessageView{ID: "later", Role: "user", Content: "later", CreatedAt: record.CreatedAt})
	record.Tasks = []DesktopAITaskView{{ID: "tool", Status: DesktopAITaskSucceeded}}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if _, err := ai.db.Exec(`UPDATE desktop_ai_messages SET payload='invalid-json' WHERE item_id='later'`); err != nil {
		t.Fatal(err)
	}
	if _, err := ai.db.Exec(`UPDATE desktop_ai_session_tasks SET payload='invalid-json'`); err != nil {
		t.Fatal(err)
	}
	input := protocol.AIHistoryInput{Kind: "messages", Limit: 1}
	for _, want := range []string{"user", "reply"} {
		page, err := ai.History(record.ID, input)
		if err != nil {
			t.Fatal("history decoded unrelated payload", err)
		}
		if err := aiwire.ValidateHistoryPage(record.ID, input, page); err != nil {
			t.Fatal(err)
		}
		if page.Total != 3 || page.NextAfterID != want || !page.HasMore {
			t.Fatalf("incorrect page: %+v", page)
		}
		input.AfterID = page.NextAfterID
	}
	if _, err := ai.History(record.ID, input); err == nil {
		t.Fatal("requested corrupt item silently hidden")
	}
}

func TestDesktopAIHistoryCursorAppearsOnlyAfterReplyCommit(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	_, request, err := ai.beginAIRequest(context.Background(), record.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer ai.finishAIRequest(record.ID, request)
	live := DesktopAIMessageView{ID: "live", Role: "assistant", Content: "streaming", CreatedAt: record.CreatedAt}
	input := protocol.AIHistoryInput{Kind: "messages", Limit: 1}
	page, err := ai.History(record.ID, input)
	if err != nil || page.Total != 1 || page.HasMore || page.NextAfterID != "user" {
		t.Fatalf("uncommitted history: %+v %v", page, err)
	}
	input.AfterID = "live"
	if _, err := ai.History(record.ID, input); err != aiwire.ErrHistoryCursor {
		t.Fatal("uncommitted cursor accepted", err)
	}
	live.Content = "saved reply"
	record.Messages = append(record.Messages, live)
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	page, err = ai.History(record.ID, input)
	if err != nil || page.Total != 2 || len(page.Items) != 0 || page.HasMore {
		t.Fatalf("committed cursor invalid: %+v %v", page, err)
	}
	record.Messages = record.Messages[:1]
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	ai.finishAIRequest(record.ID, request)
	if _, err := ai.History(record.ID, input); err != aiwire.ErrHistoryCursor {
		t.Fatalf("deleted cursor silently skipped: %v", err)
	}
}
