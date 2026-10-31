package rest

import (
	"errors"
	"net/http"
	"strings"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/chatbridge"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ChatConnectionHandler struct{ service *chatbridge.Service }

func NewChatConnectionHandler(service *chatbridge.Service) *ChatConnectionHandler {
	return &ChatConnectionHandler{service: service}
}

func (h *ChatConnectionHandler) respond(c *gin.Context, value any, err error) {
	if err == nil {
		RespondSuccess(c, value)
		return
	}
	switch {
	case errors.Is(err, access.ErrForbidden), errors.Is(err, access.ErrUnauthenticated), errors.Is(err, access.ErrRevoked):
		RespondError(c, http.StatusForbidden, "forbidden", "无权管理聊天接入")
	case errors.Is(err, gorm.ErrRecordNotFound):
		RespondError(c, http.StatusNotFound, "not_found", "聊天连接或绑定不存在")
	case errors.Is(err, chatbridge.ErrInvalid):
		RespondError(c, http.StatusBadRequest, "validation_error", strings.TrimPrefix(err.Error(), chatbridge.ErrInvalid.Error()+": "))
	default:
		// Telegram transport errors are deliberately sanitized by the client.
		if strings.HasPrefix(err.Error(), "Telegram") || strings.HasPrefix(err.Error(), "无法连接 Telegram") {
			RespondError(c, http.StatusBadGateway, "telegram_error", err.Error())
		} else {
			RespondError(c, http.StatusInternalServerError, "chat_connection_error", "聊天接入操作失败，请检查服务状态")
		}
	}
}
func (h *ChatConnectionHandler) List(c *gin.Context) {
	value, err := h.service.List(c.Request.Context())
	h.respond(c, value, err)
}
func (h *ChatConnectionHandler) Detail(c *gin.Context) {
	value, err := h.service.Detail(c.Request.Context(), c.Param("id"))
	h.respond(c, value, err)
}
func (h *ChatConnectionHandler) Save(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
	var input chatbridge.ConnectionInput
	if err := c.ShouldBindJSON(&input); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", "聊天连接配置格式无效")
		return
	}
	value, err := h.service.Save(c.Request.Context(), c.Param("id"), input)
	h.respond(c, value, err)
}
func (h *ChatConnectionHandler) SetEnabled(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Enabled == nil {
		RespondError(c, http.StatusBadRequest, "validation_error", "enabled 为必填项")
		return
	}
	h.respond(c, nil, h.service.SetEnabled(c.Request.Context(), c.Param("id"), *input.Enabled))
}
func (h *ChatConnectionHandler) Delete(c *gin.Context) {
	h.respond(c, nil, h.service.Delete(c.Request.Context(), c.Param("id")))
}
func (h *ChatConnectionHandler) BindCode(c *gin.Context) {
	value, err := h.service.CreateBindCode(c.Request.Context(), c.Param("id"))
	h.respond(c, value, err)
}
func (h *ChatConnectionHandler) Revoke(c *gin.Context) {
	h.respond(c, nil, h.service.Revoke(c.Request.Context(), c.Param("id"), c.Param("binding_id")))
}
