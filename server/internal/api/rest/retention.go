package rest

import (
	"errors"
	"net/http"

	"github.com/easyssh/server/internal/domain/recyclebin"
	"github.com/easyssh/server/internal/domain/retention"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// RetentionHandler exposes how long finished records are kept. Cleanup itself
// runs daily in the retention service; Run only triggers it early.
type RetentionHandler struct {
	config    systemconfig.Service
	retention *retention.Service
	bin       *recyclebin.Service
}

func NewRetentionHandler(config systemconfig.Service, retention *retention.Service, bin *recyclebin.Service) *RetentionHandler {
	return &RetentionHandler{config: config, retention: retention, bin: bin}
}

func (h *RetentionHandler) Get(c *gin.Context) {
	config, err := h.config.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, protocol.RetentionConfig{
		TaskRetentionDays:    protocol.RetentionConfigTaskRetentionDays(config.TaskRetentionDays),
		LogRetentionDays:     protocol.RetentionConfigLogRetentionDays(config.LogRetentionDays),
		DeletedRetentionDays: protocol.RetentionConfigDeletedRetentionDays(config.DeletedRetentionDays),
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
	config.TaskRetentionDays, config.LogRetentionDays, config.DeletedRetentionDays = int(dto.TaskRetentionDays), int(dto.LogRetentionDays), int(dto.DeletedRetentionDays)
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
	c.JSON(http.StatusOK, protocol.RetentionRunResult{DeletedTasks: result.Tasks, DeletedLogs: result.Logs, DeletedEntries: result.Deleted})
}

func wireRecycleEntry(entry recyclebin.Entry) protocol.RecycleBinEntry {
	return protocol.RecycleBinEntry{ID: entry.ID, Kind: protocol.RecycleBinEntryKind(entry.Kind), ResourceID: entry.ResourceID, Name: entry.Name, RemovedAt: entry.RemovedAt}
}

func (h *RetentionHandler) ListRecycleBin(c *gin.Context) {
	entries, err := h.bin.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	result := make([]protocol.RecycleBinEntry, len(entries))
	for i, entry := range entries {
		result[i] = wireRecycleEntry(entry)
	}
	c.JSON(http.StatusOK, result)
}

func recycleBinError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, recyclebin.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, recyclebin.ErrExists):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

func (h *RetentionHandler) RestoreRecycleBinEntry(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid recycle bin entry ID"})
		return
	}
	entry, err := h.bin.Restore(c.Request.Context(), id)
	if err != nil {
		recycleBinError(c, err)
		return
	}
	c.JSON(http.StatusOK, wireRecycleEntry(entry))
}

func (h *RetentionHandler) DeleteRecycleBinEntry(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid recycle bin entry ID"})
		return
	}
	if err = h.bin.Delete(c.Request.Context(), id); err != nil {
		recycleBinError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "Recycle bin entry deleted"})
}
