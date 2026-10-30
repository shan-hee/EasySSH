package rest

import (
	"errors"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"net/http"

	"github.com/easyssh/server/internal/domain/ssh"
	"github.com/gin-gonic/gin"
)

// SSHHandler SSH 会话处理器
type SSHHandler struct {
	sessionManager *ssh.SessionManager
}

// NewSSHHandler 创建 SSH 处理器
func NewSSHHandler(sessionManager *ssh.SessionManager) *SSHHandler {
	return &SSHHandler{
		sessionManager: sessionManager,
	}
}

// ListSessions 获取会话列表
// GET /api/v1/ssh/sessions
func (h *SSHHandler) ListSessions(c *gin.Context) {
	// 从上下文获取用户 ID
	scope, err := access.FromContext(c.Request.Context())
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	// 获取用户的所有会话
	sessions := h.sessionManager.GetByActor(scope.Actor())

	// 转换为公开信息
	publicSessions := make([]protocol.SSHSession, len(sessions))
	for i, session := range sessions {
		publicSessions[i] = session.ToPublic()
	}

	RespondSuccess(c, protocol.SSHSessionList{Sessions: publicSessions, Total: len(publicSessions)})
}

// GetSession 获取会话详情
// GET /api/v1/ssh/sessions/:id
func (h *SSHHandler) GetSession(c *gin.Context) {
	// 从上下文获取用户 ID
	scope, err := access.FromContext(c.Request.Context())
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	// 获取会话 ID
	sessionID := c.Param("id")
	if !protocol.ValidConnectionID(sessionID) {
		RespondError(c, http.StatusBadRequest, "invalid_session_id", "Invalid connection ID")
		return
	}

	// 查找会话
	session, err := h.sessionManager.Get(sessionID)
	if err != nil {
		if errors.Is(err, ssh.ErrSessionNotFound) {
			RespondError(c, http.StatusNotFound, "session_not_found", "Session not found")
			return
		}
		RespondError(c, http.StatusInternalServerError, "get_session_failed", err.Error())
		return
	}

	// 验证权限
	if session.Actor != scope.Actor() {
		RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
		return
	}

	if err := scope.Check(c.Request.Context(), access.Requirement{Action: protocol.TerminalConnect, ServerID: session.ServerID}); err != nil {
		accessError(c, err)
		return
	}
	RespondSuccess(c, session.ToPublic())
}

// CloseSession 关闭会话
// DELETE /api/v1/ssh/sessions/:id
func (h *SSHHandler) CloseSession(c *gin.Context) {
	// 从上下文获取用户 ID
	scope, err := access.FromContext(c.Request.Context())
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	// 获取会话 ID
	sessionID := c.Param("id")
	if !protocol.ValidConnectionID(sessionID) {
		RespondError(c, http.StatusBadRequest, "invalid_session_id", "Invalid connection ID")
		return
	}

	// 查找会话
	session, err := h.sessionManager.Get(sessionID)
	if err != nil {
		if errors.Is(err, ssh.ErrSessionNotFound) {
			RespondError(c, http.StatusNotFound, "session_not_found", "Session not found")
			return
		}
		RespondError(c, http.StatusInternalServerError, "get_session_failed", err.Error())
		return
	}

	// 验证权限
	if session.Actor != scope.Actor() {
		RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
		return
	}

	// 关闭会话
	if err := h.sessionManager.Remove(sessionID); err != nil {
		RespondError(c, http.StatusInternalServerError, "close_session_failed", err.Error())
		return
	}

	RespondSuccess(c, protocol.MessageResponse{Message: "Session closed successfully"})
}

// GetStatistics 获取会话统计
// GET /api/v1/ssh/statistics
func (h *SSHHandler) GetStatistics(c *gin.Context) {
	// 从上下文获取用户 ID
	scope, err := access.FromContext(c.Request.Context())
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	// 获取统计信息
	userSessions := h.sessionManager.GetByActor(scope.Actor())
	totalSessions := len(userSessions)

	activeSessions := 0
	for _, session := range userSessions {
		if session.IsActive() {
			activeSessions++
		}
	}

	RespondSuccess(c, protocol.SSHSessionStatistics{ActiveSessions: activeSessions, TotalSessions: totalSessions})
}
