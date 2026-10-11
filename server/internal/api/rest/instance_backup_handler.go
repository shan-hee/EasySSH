package rest

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/easyssh/shared/instanceactivation"
	"github.com/easyssh/shared/instancebackup"
	"github.com/gin-gonic/gin"
)

type InstanceBackupHandler struct {
	history          *instancebackup.History
	restoreAvailable bool
	activation       *instanceactivation.Client
}

func (h *InstanceBackupHandler) SetActivation(client *instanceactivation.Client) {
	h.activation = client
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
	activation, err := h.activation.Info(c.Request.Context())
	if err != nil {
		instanceBackupError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": records, "restore_available": h.restoreAvailable, "max_upload_bytes": instancebackup.MaxUploadBytes, "activation": activation})
}

func (h *InstanceBackupHandler) Activate(c *gin.Context) { h.activate(c, false) }
func (h *InstanceBackupHandler) Rollback(c *gin.Context) { h.activate(c, true) }

func (h *InstanceBackupHandler) activate(c *gin.Context, rollback bool) {
	if h.activation == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "automatic activation requires the Windows local SQLite launcher"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		Confirm    bool   `json:"confirm"`
		RestoredTo string `json:"restored_to"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || !input.Confirm {
		c.JSON(400, gin.H{"error": "activation confirmation is required"})
		return
	}
	id := c.Param("id")
	if rollback {
		id = ""
	}
	record, release, err := h.history.ReserveActivation(id)
	if err != nil {
		instanceBackupError(c, err)
		return
	}
	if !rollback && record.RestoredTo != input.RestoredTo {
		release()
		c.JSON(409, gin.H{"error": "restored instance changed; refresh the backup list"})
		return
	}
	operation, err := h.activation.Activate(c.Request.Context(), instanceactivation.Request{RecordID: id, Directory: record.RestoredTo, Rollback: rollback})
	if err != nil {
		// A lost response may follow a durable acceptance. Keep the reservation
		// until shutdown unless the launcher confirms that no switch is pending.
		info, statusErr := h.activation.Info(context.Background())
		if statusErr == nil && (info.Operation == nil || info.Operation.Status != "switching") {
			release()
		}
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusAccepted, operation)
}

// A random operation ID permits only this status read, not access to any data.
// It remains usable after the restored instance invalidates the login session.
func (h *InstanceBackupHandler) ActivationStatus(c *gin.Context) {
	operation, err := h.activation.Status(c.Request.Context(), c.Param("operationId"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "activation operation not found"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, operation)
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
