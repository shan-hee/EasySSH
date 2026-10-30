package app

import (
	"context"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"testing"
	"time"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiwire"
	"github.com/google/uuid"
)

func TestRemoteAIHistoryPinsOriginAndValidatesPageIdentity(t *testing.T) {
	id := uuid.NewString()
	input := protocol.AIHistoryInput{Kind: "messages", Limit: 2}
	message := aichatui.MessageView{ID: "message", Role: "assistant", Content: "reply", CreatedAt: time.Now()}
	page, err := aiwire.BuildHistoryPage(id, time.Now(), input, []string{message.ID}, func(int) (any, error) { return message, nil })
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	session, _ := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/ai/sessions/"+id+"/history" || r.URL.Query().Get("kind") != "messages" || r.URL.Query().Get("limit") != "2" || r.Header.Get("Authorization") != "Access source-access-secret" {
			t.Fatal("history escaped source boundary")
		}
		return remoteTaskResponse(t, r, page), nil
	})
	if _, err := session.remoteAIHistory(context.Background(), id, input); err != nil {
		t.Fatal(err)
	}
	page.SessionID = uuid.NewString()
	if _, err := session.remoteAIHistory(context.Background(), id, input); err == nil {
		t.Fatal("accepted other session")
	}
	page.SessionID, page.NextAfterID = id, "unseen"
	if _, err := session.remoteAIHistory(context.Background(), id, input); err == nil {
		t.Fatal("accepted skipped cursor")
	}
	if _, err := session.remoteAIHistory(context.Background(), "../owner", input); err == nil || calls != 3 {
		t.Fatal("invalid path dispatched")
	}
}

func TestRemoteAIProgressRemainsBoundToSourceSession(t *testing.T) {
	stream := &desktopRemoteStream{aiSessionID: "session"}
	check := func(kind string, data any, wantError bool) {
		t.Helper()
		raw, err := json.Marshal(map[string]any{"type": kind, "data": data})
		if err != nil {
			t.Fatal(err)
		}
		if err := stream.validateAIChunk(raw); (err != nil) != wantError {
			t.Fatalf("%s validation: %v", kind, err)
		}
	}
	change := protocol.AIHistoryChange{SessionID: "session", UpdatedAt: time.Now()}
	check("data-history-changed", change, false)
	change.SessionID = "another-session"
	check("data-history-changed", change, true)
	delta := protocol.AITaskOutputDelta{SessionID: "session", TaskID: "task", Text: "界", NextOffset: 3, Reset: true}
	check("data-task-output-delta", delta, false)
	delta.NextOffset = 1
	check("data-task-output-delta", delta, true)
	delta.NextOffset = 3
	delta.SessionID = "another-session"
	check("data-task-output-delta", delta, true)
}
