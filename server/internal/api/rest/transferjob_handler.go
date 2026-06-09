package rest

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/transferjob"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type TransferJobHandler struct {
	service transferjob.Service
}

func NewTransferJobHandler(service transferjob.Service) *TransferJobHandler {
	return &TransferJobHandler{service: service}
}

func (h *TransferJobHandler) CreateUpload(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	reader, err := c.Request.MultipartReader()
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_multipart", "Request must be multipart/form-data")
		return
	}

	req := &transferjob.CreateUploadRequest{
		Name:          strings.TrimSpace(c.Query("name")),
		ServerID:      strings.TrimSpace(c.Query("server_id")),
		TargetPath:    strings.TrimSpace(c.Query("target_path")),
		FileName:      strings.TrimSpace(c.Query("file_name")),
		FileSize:      parseTransferJobInt64Value(c.Query("file_size"), 0),
		RetentionDays: parseTransferJobIntValue(c.Query("retention_days"), 0),
		Description:   strings.TrimSpace(c.Query("description")),
		DeferStart:    parseTransferJobBoolValue(c.Query("defer_start")),
	}

	for {
		part, err := reader.NextPart()
		if err != nil {
			if errors.Is(err, io.EOF) {
				RespondError(c, http.StatusBadRequest, "missing_file", "file part is required")
			} else {
				RespondError(c, http.StatusBadRequest, "invalid_multipart", err.Error())
			}
			return
		}
		if part.FormName() != "file" {
			applyUploadFormField(req, part.FormName(), readMultipartField(part))
			_ = part.Close()
			continue
		}
		defer part.Close()

		if req.FileName == "" {
			req.FileName = part.FileName()
		}
		job, err := h.service.CreateUploadJob(c.Request.Context(), userID, req, part)
		if err != nil {
			respondTransferJobError(c, err)
			return
		}
		RespondSuccess(c, job)
		return
	}
}

func (h *TransferJobHandler) CreateDownload(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	var req transferjob.CreateDownloadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	job, err := h.service.CreateDownloadJob(c.Request.Context(), userID, &req)
	if err != nil {
		respondTransferJobError(c, err)
		return
	}
	RespondSuccess(c, job)
}

func (h *TransferJobHandler) List(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	req := &transferjob.ListRequest{
		UserID:   userID,
		Kind:     transferjob.JobKind(strings.TrimSpace(c.Query("kind"))),
		Status:   transferjob.JobStatus(strings.TrimSpace(c.Query("status"))),
		Page:     parseTransferJobIntQuery(c, "page", 1),
		PageSize: parseTransferJobIntQuery(c, "page_size", 20),
	}
	result, err := h.service.ListJobs(c.Request.Context(), req)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	RespondSuccess(c, result)
}

func (h *TransferJobHandler) GetStatistics(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	stats, err := h.service.GetStatistics(c.Request.Context(), userID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "statistics_failed", err.Error())
		return
	}
	RespondSuccess(c, stats)
}

func (h *TransferJobHandler) GetByID(c *gin.Context) {
	userID, id, ok := h.parseJobScope(c)
	if !ok {
		return
	}
	job, err := h.service.GetJob(c.Request.Context(), userID, id)
	if err != nil {
		respondTransferJobError(c, err)
		return
	}
	RespondSuccess(c, job)
}

func (h *TransferJobHandler) Cancel(c *gin.Context) {
	userID, id, ok := h.parseJobScope(c)
	if !ok {
		return
	}
	if err := h.service.CancelJob(c.Request.Context(), userID, id); err != nil {
		respondTransferJobError(c, err)
		return
	}
	RespondSuccess(c, gin.H{"success": true})
}

func (h *TransferJobHandler) Delete(c *gin.Context) {
	userID, id, ok := h.parseJobScope(c)
	if !ok {
		return
	}
	if err := h.service.DeleteJob(c.Request.Context(), userID, id); err != nil {
		respondTransferJobError(c, err)
		return
	}
	RespondSuccess(c, gin.H{"success": true})
}

func (h *TransferJobHandler) DownloadArtifact(c *gin.Context) {
	userID, id, ok := h.parseJobScope(c)
	if !ok {
		return
	}
	job, artifactPath, err := h.service.GetArtifact(c.Request.Context(), userID, id)
	if err != nil {
		respondTransferJobError(c, err)
		return
	}
	fileName := job.ArtifactName
	if fileName == "" {
		fileName = job.FileName
	}
	if fileName == "" {
		fileName = "transfer-artifact"
	}
	c.FileAttachment(artifactPath, fileName)
}

func (h *TransferJobHandler) parseJobScope(c *gin.Context) (uuid.UUID, uuid.UUID, bool) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return uuid.Nil, uuid.Nil, false
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_id", "Invalid transfer job ID")
		return uuid.Nil, uuid.Nil, false
	}
	return userID, id, true
}

func respondTransferJobError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, transferjob.ErrJobNotFound):
		RespondError(c, http.StatusNotFound, "job_not_found", "Transfer job not found")
	case errors.Is(err, transferjob.ErrForbiddenJob):
		RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
	case errors.Is(err, serverdomain.ErrUnauthorized):
		RespondError(c, http.StatusForbidden, "forbidden", "Access denied")
	case errors.Is(err, serverdomain.ErrServerNotFound):
		RespondError(c, http.StatusBadRequest, "server_not_found", "Server not found")
	case errors.Is(err, transferjob.ErrArtifactNotReady):
		RespondError(c, http.StatusConflict, "artifact_not_ready", "Transfer artifact is not ready")
	case errors.Is(err, transferjob.ErrArtifactInUse):
		RespondError(c, http.StatusConflict, "artifact_in_use", "Transfer artifact is in use")
	case errors.Is(err, transferjob.ErrInvalidJobRequest):
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
	default:
		RespondError(c, http.StatusInternalServerError, "transfer_job_failed", err.Error())
	}
}

func parseTransferJobIntQuery(c *gin.Context, key string, fallback int) int {
	return parseTransferJobIntValue(c.Query(key), fallback)
}

func parseTransferJobIntValue(value string, fallback int) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseTransferJobInt64Value(value string, fallback int64) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseTransferJobBoolValue(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func readMultipartField(part interface{ Read([]byte) (int, error) }) string {
	data, err := io.ReadAll(io.LimitReader(part, 4096))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func applyUploadFormField(req *transferjob.CreateUploadRequest, key string, value string) {
	if req == nil || value == "" {
		return
	}
	switch key {
	case "name":
		req.Name = value
	case "server_id":
		req.ServerID = value
	case "target_path", "path":
		req.TargetPath = value
	case "file_name":
		req.FileName = value
	case "file_size", "size":
		req.FileSize = parseTransferJobInt64Value(value, req.FileSize)
	case "retention_days":
		req.RetentionDays = parseTransferJobIntValue(value, req.RetentionDays)
	case "description":
		req.Description = value
	case "defer_start":
		req.DeferStart = parseTransferJobBoolValue(value)
	}
}
