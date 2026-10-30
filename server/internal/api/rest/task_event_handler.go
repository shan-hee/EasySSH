package rest

import (
	"errors"
	"net/http"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/taskprotocol"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h *TaskCenterHandler) taskEventError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, taskprotocol.ErrEventQuery):
		RespondError(c, http.StatusBadRequest, "invalid_task_event_query", "Invalid task event query")
	case errors.Is(err, gorm.ErrRecordNotFound), errors.Is(err, taskcenter.ErrNotFound):
		RespondError(c, http.StatusNotFound, "task_event_not_found", "Task or event not found")
	default:
		RespondError(c, http.StatusInternalServerError, "task_events_failed", "Cannot read task events")
	}
}
