package rest

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"net/http"

	"github.com/easyssh/server/internal/domain/batchtask"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/gin-gonic/gin"
)

type BatchTaskHandler struct{ service batchtask.Service }

func NewBatchTaskHandler(service batchtask.Service) *BatchTaskHandler {
	return &BatchTaskHandler{service: service}
}
func batchTaskError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, batchtask.ErrBatchTaskNotFound):
		RespondError(c, 404, "batch_task_not_found", err.Error())
	case errors.Is(err, batchtask.ErrInvalidBatchTaskData):
		RespondError(c, 400, "invalid_batch_task", err.Error())
	case errors.Is(err, script.ErrInvalidScriptData), errors.Is(err, script.ErrScriptNotFound):
		scriptError(c, err)
	default:
		accessError(c, err)
	}
}
func (h *BatchTaskHandler) Create(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var req protocol.CreateBatchTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, 400, "invalid_request", err.Error())
		return
	}
	task, err := h.service.CreateBatchTask(c.Request.Context(), &req)
	if err != nil {
		batchTaskError(c, err)
		return
	}
	RespondSuccess(c, task.Public())
}
func (h *BatchTaskHandler) List(c *gin.Context) {
	var req protocol.ListBatchTasksRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		RespondError(c, 400, "invalid_request", err.Error())
		return
	}
	rows, err := h.service.ListBatchTasks(c.Request.Context(), &req)
	if err != nil {
		batchTaskError(c, err)
		return
	}
	c.JSON(http.StatusOK, rows)
}
func (h *BatchTaskHandler) GetByID(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	task, err := h.service.GetBatchTask(c.Request.Context(), id)
	if err != nil {
		batchTaskError(c, err)
		return
	}
	RespondSuccess(c, task.Public())
}
func (h *BatchTaskHandler) Update(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var req protocol.UpdateBatchTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, 400, "invalid_request", err.Error())
		return
	}
	task, err := h.service.UpdateBatchTask(c.Request.Context(), id, &req)
	if err != nil {
		batchTaskError(c, err)
		return
	}
	RespondSuccess(c, task.Public())
}
func (h *BatchTaskHandler) Delete(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.service.DeleteBatchTask(c.Request.Context(), id); err != nil {
		batchTaskError(c, err)
		return
	}
	RespondSuccess(c, protocol.BatchTaskDeleted{Success: true})
}
func (h *BatchTaskHandler) GetStatistics(c *gin.Context) {
	stats, err := h.service.GetStatistics(c.Request.Context())
	if err != nil {
		batchTaskError(c, err)
		return
	}
	RespondSuccess(c, stats)
}
func (h *BatchTaskHandler) Start(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.service.StartBatchTask(c.Request.Context(), id); err != nil {
		batchTaskError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, protocol.BatchTaskAccepted{TaskID: id, Status: "queued"})
}
