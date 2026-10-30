package rest

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/scriptutil"
	"net/http"

	"github.com/easyssh/server/internal/domain/batchtask"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/gin-gonic/gin"
)

type ScriptHandler struct {
	scripts script.Service
	tasks   batchtask.Service
}

func NewScriptHandler(scripts script.Service, tasks batchtask.Service) *ScriptHandler {
	return &ScriptHandler{scripts: scripts, tasks: tasks}
}
func scriptError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, script.ErrScriptNotFound):
		RespondError(c, 404, "script_not_found", err.Error())
	case errors.Is(err, script.ErrInvalidScriptData), errors.Is(err, scriptutil.ErrInvalidCatalogQuery):
		RespondError(c, 400, "invalid_script", err.Error())
	default:
		accessError(c, err)
	}
}
func (h *ScriptHandler) Create(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var req script.CreateScriptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, 400, "invalid_request", err.Error())
		return
	}
	row, err := h.scripts.CreateScript(c.Request.Context(), c.GetString("username"), &req)
	if err != nil {
		scriptError(c, err)
		return
	}
	RespondSuccess(c, row.Public())
}
func (h *ScriptHandler) Update(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var req script.UpdateScriptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, 400, "invalid_request", err.Error())
		return
	}
	row, err := h.scripts.UpdateScript(c.Request.Context(), id, &req)
	if err != nil {
		scriptError(c, err)
		return
	}
	RespondSuccess(c, row.Public())
}
func (h *ScriptHandler) Delete(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.scripts.DeleteScript(c.Request.Context(), id); err != nil {
		scriptError(c, err)
		return
	}
	RespondSuccess(c, gin.H{"success": true})
}
func (h *ScriptHandler) GetByID(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	row, err := h.scripts.GetScript(c.Request.Context(), id)
	if err != nil {
		scriptError(c, err)
		return
	}
	RespondSuccess(c, row.Public())
}
func (h *ScriptHandler) List(c *gin.Context) {
	var req script.ListScriptsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		RespondError(c, 400, "invalid_request", err.Error())
		return
	}
	rows, err := h.scripts.ListScripts(c.Request.Context(), &req)
	if err != nil {
		scriptError(c, err)
		return
	}
	c.JSON(http.StatusOK, rows)
}
func (h *ScriptHandler) Available(c *gin.Context) {
	var input protocol.ScriptCatalogInput
	if err := c.ShouldBindQuery(&input); err != nil {
		RespondError(c, 400, "invalid_script", "invalid script catalogue query")
		return
	}
	rows, err := h.scripts.Available(c.Request.Context(), c.Query("server_id"), input)
	if err != nil {
		scriptError(c, err)
		return
	}
	RespondSuccess(c, rows)
}

// Execute creates actual queued work. The caller cannot replace stored source.
func (h *ScriptHandler) Execute(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, scriptutil.MaxExecuteBytes)
	var req protocol.ScriptExecuteInput
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, 400, "invalid_request", err.Error())
		return
	}
	execution, err := h.scripts.Resolve(c.Request.Context(), id, req.ServerIDs, req.Parameters, req.Version)
	if err != nil {
		scriptError(c, err)
		return
	}
	scriptID := id.String()
	task, err := h.tasks.CreateBatchTask(c.Request.Context(), &protocol.CreateBatchTaskRequest{TaskName: execution.Name, TaskType: "script", ScriptID: &scriptID, ServerIDs: req.ServerIDs, ScriptVersion: execution.Version, Parameters: req.Parameters, ExecutionMode: protocol.BatchTaskExecutionMode(req.ExecutionMode)})
	if err != nil {
		batchTaskError(c, err)
		return
	}
	if err := h.tasks.StartBatchTask(c.Request.Context(), task.ID); err != nil {
		batchTaskError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, protocol.ScriptAccepted{TaskID: task.ID, BatchTaskID: task.ID, Status: "queued"})
}
