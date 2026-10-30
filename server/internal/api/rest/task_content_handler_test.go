package rest

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

type taskContentServiceFixture struct {
	taskcenter.Service
	detail protocol.TaskRunDetails
}

func (s taskContentServiceFixture) Details(_ context.Context, id uuid.UUID) (protocol.TaskRunDetails, error) {
	if id != s.detail.Run.ID {
		return protocol.TaskRunDetails{}, taskcenter.ErrNotFound
	}
	return s.detail, nil
}

func TestTaskContentHTTPReturnsCommittedDescriptor(t *testing.T) {
	gin.SetMode(gin.TestMode)
	id := uuid.New()
	ref := protocol.ContentReference{ID: uuid.New(), MediaType: "application/json", Size: 100000, Sha256: strings.Repeat("a", 64)}
	expected := protocol.TaskRunDetails{Run: &protocol.TaskOverview{ID: id, Title: strings.Repeat("title", 300)}, Content: protocol.TaskContent{Bytes: int(ref.Size), Hash: ref.Sha256, Content: &ref}}
	handler := NewTaskCenterHandler(taskContentServiceFixture{detail: expected}, nil)
	router := gin.New()
	router.GET("/tasks/:id", handler.Get)
	response := performJSONRequest(t, router, http.MethodGet, "/tasks/"+id.String(), nil)
	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	var actual protocol.TaskRunDetails
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &actual))
	require.Equal(t, expected, actual)
	response = performJSONRequest(t, router, http.MethodGet, "/tasks/"+uuid.NewString(), nil)
	require.Equal(t, http.StatusNotFound, response.Code)
}
