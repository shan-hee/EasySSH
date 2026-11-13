package rest

import (
	"net/http"

	"github.com/easyssh/server/internal/domain/retention"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
)

// RetentionHandler exposes how long finished records are kept. Cleanup itself
// runs daily in the retention service; Run only triggers it early.
type RetentionHandler struct {
	config    systemconfig.Service
	retention *retention.Service
}

func NewRetentionHandler(config systemconfig.Service, retention *retention.Service) *RetentionHandler {
	return &RetentionHandler{config: config, retention: retention}
}

func (h *RetentionHandler) Get(c *gin.Context) {
	config, err := h.config.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, protocol.RetentionConfig{
		TaskRetentionDays: protocol.RetentionConfigTaskRetentionDays(config.TaskRetentionDays),
		LogRetentionDays:  protocol.RetentionConfigLogRetentionDays(config.LogRetentionDays),
	})
}

func (h *RetentionHandler) Patch(c *gin.Context) {
	var dto protocol.RetentionConfig
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	config, err := h.config.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	config.TaskRetentionDays, config.LogRetentionDays = int(dto.TaskRetentionDays), int(dto.LogRetentionDays)
	if err := h.config.SaveRetention(c.Request.Context(), config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, dto)
}

func (h *RetentionHandler) Run(c *gin.Context) {
	result, err := h.retention.Run(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, protocol.RetentionRunResult{DeletedTasks: result.Tasks, DeletedLogs: result.Logs})
}
