package rest

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"net/http"

	"github.com/easyssh/server/internal/domain/aichat"
	"github.com/gin-gonic/gin"
)

type AIRuntimeConfigHandler struct {
	resolver aichat.ConfigResolver
}

func NewAIRuntimeConfigHandler(resolver aichat.ConfigResolver) *AIRuntimeConfigHandler {
	return &AIRuntimeConfigHandler{resolver: resolver}
}

// GetConfig 获取当前用户的有效 AI 配置（不包含敏感信息）
// @Summary 获取 AI 配置状态
// @Tags AI 会话
// @Accept json
// @Produce json
// @Success 200 {object} map[string]interface{}
// @Router /api/v1/ai/config [get]
func (h *AIRuntimeConfigHandler) GetConfig(c *gin.Context) {

	config, err := h.resolver.Resolve(c.Request.Context())
	if err != nil {
		if errors.Is(err, aichat.ErrAINotConfigured) {
			c.JSON(http.StatusOK, protocol.AIRuntimeConfig{Configured: false, Message: "AI service is not configured"})
			return
		}

		accessError(c, err)
		return
	}

	c.JSON(http.StatusOK, protocol.AIRuntimeConfig{Configured: true, Provider: config.Provider, Model: config.Model, Models: config.Models, HasKey: config.APIKey != ""})
}
