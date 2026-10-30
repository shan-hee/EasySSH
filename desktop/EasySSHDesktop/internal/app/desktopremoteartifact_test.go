package app

import (
	"context"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"net/http"
	"testing"
)

func TestRemoteArtifactReferencePinsSourceAndRejectsMalformedMetadata(t *testing.T) {
	sessionID, taskID := uuid.NewString(), uuid.NewString()
	response := protocol.ContentReference{ID: uuid.New(), MediaType: "application/json", Size: 42, Sha256: aiworkspace.Hash("artifact snapshot")}
	calls := 0
	session, _ := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodGet || r.URL.Host != "source.example" || r.URL.Path != "/api/v1/ai/sessions/"+sessionID+"/tasks/"+taskID+"/file" || r.Header.Get("Authorization") != "Access source-access-secret" {
			t.Fatal("artifact request escaped source boundary")
		}
		return remoteTaskResponse(t, r, response), nil
	})
	result, err := session.remoteAITaskFile(context.Background(), sessionID, taskID)
	if err != nil || result != response {
		t.Fatal("valid reference rejected", result, err)
	}
	response.Sha256 = "invalid"
	if _, err := session.remoteAITaskFile(context.Background(), sessionID, taskID); err == nil {
		t.Fatal("invalid hash accepted")
	}
	if _, err := session.remoteAITaskFile(context.Background(), sessionID, "../owner"); err == nil || calls != 2 {
		t.Fatal("invalid task ID dispatched")
	}
	if _, err := session.remoteAITaskFile(context.Background(), "https://other.example/", taskID); err == nil || calls != 2 {
		t.Fatal("invalid source dispatched")
	}
}
