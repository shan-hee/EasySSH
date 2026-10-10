package rest

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/easyssh/shared/instancebackup"
	"github.com/gin-gonic/gin"
)

type InstanceBackupHandler struct {
	history          *instancebackup.History
	restoreAvailable bool
}

func NewInstanceBackupHandler(history *instancebackup.History, restoreAvailable bool) *InstanceBackupHandler {
	return &InstanceBackupHandler{history: history, restoreAvailable: restoreAvailable}
}

func instanceBackupError(c *gin.Context, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, instancebackup.ErrBusy) {
		status = http.StatusConflict
	}
	if errors.Is(err, instancebackup.ErrNotFound) {
		status = http.StatusNotFound
	}
	c.JSON(status, gin.H{"error": err.Error()})
}

func (h *InstanceBackupHandler) List(c *gin.Context) {
	records, err := h.history.List()
	if err != nil {
		instanceBackupError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": records, "restore_available": h.restoreAvailable, "max_upload_bytes": instancebackup.MaxUploadBytes})
}

func (h *InstanceBackupHandler) Create(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"error": "invalid backup request"})
		return
	}
	record, err := h.history.Create(input.Password)
	if err != nil {
		instanceBackupError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, record)
}

func (h *InstanceBackupHandler) Upload(c *gin.Context) {
	_ = http.NewResponseController(c.Writer).SetReadDeadline(time.Now().Add(4 * time.Hour))
	_ = http.NewResponseController(c.Writer).SetWriteDeadline(time.Now().Add(4 * time.Hour))
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, instancebackup.MaxUploadBytes+(1<<20))
	reader, err := c.Request.MultipartReader()
	if err != nil {
		c.JSON(400, gin.H{"error": "multipart backup file is required"})
		return
	}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			c.JSON(400, gin.H{"error": "backup file is required"})
			return
		}
		if err != nil {
			c.JSON(400, gin.H{"error": "unable to read backup upload"})
			return
		}
		if part.FormName() != "file" {
			part.Close()
			continue
		}
		if !strings.HasSuffix(strings.ToLower(part.FileName()), ".easyssh.age") {
			part.Close()
			c.JSON(400, gin.H{"error": "select an .easyssh.age backup archive"})
			return
		}
		record, err := h.history.Upload(part)
		part.Close()
		if err != nil {
			instanceBackupError(c, err)
			return
		}
		c.JSON(http.StatusCreated, record)
		return
	}
}

func (h *InstanceBackupHandler) Download(c *gin.Context) {
	_ = http.NewResponseController(c.Writer).SetWriteDeadline(time.Now().Add(4 * time.Hour))
	file, record, release, err := h.history.Open(c.Param("id"))
	if err != nil {
		instanceBackupError(c, err)
		return
	}
	defer release()
	defer file.Close()
	c.Header("Cache-Control", "no-store")
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", `attachment; filename="`+record.Name+`"`)
	http.ServeContent(c.Writer, c.Request, record.Name, record.CreatedAt, file)
}

func (h *InstanceBackupHandler) Delete(c *gin.Context) {
	if err := h.history.Delete(c.Param("id")); err != nil {
		instanceBackupError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *InstanceBackupHandler) Inspect(c *gin.Context) { h.inspect(c, false) }
func (h *InstanceBackupHandler) Restore(c *gin.Context) { h.inspect(c, true) }
func (h *InstanceBackupHandler) inspect(c *gin.Context, restore bool) {
	if restore && !h.restoreAvailable {
		c.JSON(400, gin.H{"error": "configure EASYSSH_RESTORE_DSN with a new empty target database before restoring"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		Password string `json:"password"`
		Confirm  bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"error": "invalid backup request"})
		return
	}
	if restore && !input.Confirm {
		c.JSON(400, gin.H{"error": "restore confirmation is required"})
		return
	}
	record, err := h.history.Inspect(c.Param("id"), input.Password, restore)
	if err != nil {
		instanceBackupError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, record)
}
