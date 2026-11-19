package rest

import (
	"net/http"

	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
)

// AIContextHandler exposes server-side context compaction for AI sessions.
type AIContextHandler struct{ config systemconfig.Service }

func NewAIContextHandler(config systemconfig.Service) *AIContextHandler {
	return &AIContextHandler{config: config}
}

func aiContextView(config *systemconfig.SystemConfig) protocol.AIContextConfig {
	return protocol.AIContextConfig{CompactionEnabled: config.AICompactionEnabled, ContextWindow: config.AIContextWindow, ThresholdPercent: config.AICompactionThreshold, KeepTurns: config.AICompactionKeepTurns}
}

func (h *AIContextHandler) Get(c *gin.Context) {
	config, err := h.config.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, aiContextView(config))
}

func (h *AIContextHandler) Patch(c *gin.Context) {
	var dto protocol.AIContextConfig
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<16)
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	config, err := h.config.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	config.AICompactionEnabled, config.AIContextWindow, config.AICompactionThreshold, config.AICompactionKeepTurns = dto.CompactionEnabled, dto.ContextWindow, dto.ThresholdPercent, dto.KeepTurns
	if err := h.config.SaveAIContext(c.Request.Context(), config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, aiContextView(config))
}
