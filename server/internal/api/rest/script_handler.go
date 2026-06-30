package rest

import (
	"net/http"

	"github.com/easyssh/server/internal/domain/script"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ScriptHandler 脚本处理器
type ScriptHandler struct {
	scriptService script.Service
}

// NewScriptHandler 创建脚本处理器实例
func NewScriptHandler(scriptService script.Service) *ScriptHandler {
	return &ScriptHandler{
		scriptService: scriptService,
	}
}

// Create 创建脚本
func (h *ScriptHandler) Create(c *gin.Context) {
	var req script.CreateScriptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	username := c.GetString("username")
	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	createdScript, err := h.scriptService.CreateScript(uid, username, &req)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}

	RespondSuccess(c, createdScript)
}

// Update 更新脚本
func (h *ScriptHandler) Update(c *gin.Context) {
	scriptID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_script_id", err.Error())
		return
	}

	var req script.UpdateScriptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	updatedScript, err := h.scriptService.UpdateScript(uid, scriptID, &req)
	if err != nil {
		if err == script.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", err.Error())
			return
		}
		if err == script.ErrScriptNotFound {
			RespondError(c, http.StatusNotFound, "not_found", err.Error())
			return
		}
		RespondError(c, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}

	RespondSuccess(c, updatedScript)
}

// Delete 删除脚本
func (h *ScriptHandler) Delete(c *gin.Context) {
	scriptID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_script_id", err.Error())
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	if err := h.scriptService.DeleteScript(uid, scriptID); err != nil {
		if err == script.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", err.Error())
			return
		}
		if err == script.ErrScriptNotFound {
			RespondError(c, http.StatusNotFound, "not_found", err.Error())
			return
		}
		RespondError(c, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}

	RespondSuccessWithMessage(c, nil, "script deleted successfully")
}

// GetByID 获取脚本详情
func (h *ScriptHandler) GetByID(c *gin.Context) {
	scriptID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_script_id", err.Error())
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	scriptData, err := h.scriptService.GetScript(uid, scriptID)
	if err != nil {
		if err == script.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", err.Error())
			return
		}
		if err == script.ErrScriptNotFound {
			RespondError(c, http.StatusNotFound, "not_found", err.Error())
			return
		}
		RespondError(c, http.StatusInternalServerError, "get_failed", err.Error())
		return
	}

	RespondSuccess(c, scriptData)
}

// List 获取脚本列表
func (h *ScriptHandler) List(c *gin.Context) {
	var req script.ListScriptsRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	response, err := h.scriptService.ListScripts(uid, &req)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}

	c.JSON(http.StatusOK, response)
}

// Execute 执行脚本（增加执行计数）
func (h *ScriptHandler) Execute(c *gin.Context) {
	scriptID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_script_id", err.Error())
		return
	}

	uid, ok := requireCurrentUserID(c)
	if !ok {
		return
	}

	if err := h.scriptService.ExecuteScript(uid, scriptID); err != nil {
		if err == script.ErrUnauthorized {
			RespondError(c, http.StatusForbidden, "forbidden", err.Error())
			return
		}
		if err == script.ErrScriptNotFound {
			RespondError(c, http.StatusNotFound, "not_found", err.Error())
			return
		}
		RespondError(c, http.StatusInternalServerError, "execute_failed", err.Error())
		return
	}

	RespondSuccessWithMessage(c, nil, "script execution recorded")
}
