package rest

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/transferjob"
	"github.com/easyssh/shared/resultstore"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestTransferCreationReportsStorageFailureWithoutAcceptingRequest(t *testing.T) {
	for _, job := range []*transferjob.TransferJob{nil, {ID: uuid.New(), Status: transferjob.JobStatusQueued}} {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		respondTransferCreation(ctx, job, fmt.Errorf("%w: private database details", resultstore.ErrUnavailable))
		if recorder.Code != http.StatusServiceUnavailable {
			t.Fatalf("unsaved request was accepted: %d", recorder.Code)
		}
		if !strings.Contains(recorder.Body.String(), "storage_unavailable") || strings.Contains(recorder.Body.String(), "private database details") {
			t.Fatalf("invalid storage error: %s", recorder.Body.String())
		}
	}
}
