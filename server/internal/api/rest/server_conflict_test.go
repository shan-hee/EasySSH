package rest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/gin-gonic/gin"
)

func TestServerSaveConflictIsDistinctFromSharingApproval(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		code string
	}{
		{"owner edit conflict", fmt.Errorf("save failed: %w", server.ErrServerUpdateConflict), "server_changed"},
		{"visitor resource approval", access.ErrResourceChanged, "resource_paused"},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			serverError(ctx, test.err)
			if recorder.Code != http.StatusConflict {
				t.Fatalf("unexpected HTTP status: %d", recorder.Code)
			}
			var body struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Error != test.code {
				t.Fatalf("unexpected error code: %q", body.Error)
			}
		})
	}
}
