package rest

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/resultstore"
	"io"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/server/internal/domain/transferjob"
	"github.com/gin-gonic/gin"
)

type TransferJobHandler struct {
	limiter *sftp.TransferLimiter
	service transferjob.Service
}

func NewTransferJobHandler(service transferjob.Service, limiter *sftp.TransferLimiter) *TransferJobHandler {
	return &TransferJobHandler{service: service, limiter: limiter}
}

func (h *TransferJobHandler) CreateUpload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var input protocol.TransferUploadInput
	if err := c.ShouldBindJSON(&input); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	req := &transferjob.CreateUploadRequest{ServerID: input.ServerID, TargetPath: input.TargetPath, FileName: input.FileName, FileSize: *input.FileSize, Name: input.Name, Description: input.Description, RetentionDays: input.RetentionDays, DeferStart: input.DeferStart, Folder: input.Folder, Merge: input.Merge}
	job, err := h.service.CreateUploadJob(c.Request.Context(), req)
	respondTransferCreation(c, job, err)
}

func (h *TransferJobHandler) UploadContent(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || mediaType != "application/octet-stream" {
		RespondError(c, http.StatusUnsupportedMediaType, "invalid_content_type", "Upload content must be application/octet-stream")
		return
	}
	job, err := h.service.UploadJobContent(c.Request.Context(), id, c.Request.Body)
	respondTransferCreation(c, job, err)
}

func (h *TransferJobHandler) CreateRelay(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var input protocol.TransferRelayInput
	if err := c.ShouldBindJSON(&input); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	job, err := h.service.CreateRelayJob(c.Request.Context(), &input)
	respondTransferCreation(c, job, err)
}

func (h *TransferJobHandler) CreateDownload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512<<10)

	var input protocol.TransferDownloadInput
	if err := c.ShouldBindJSON(&input); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	req := &transferjob.CreateDownloadRequest{
		ServerID: input.ServerID, SourcePath: input.SourcePath, SourcePaths: input.SourcePaths,
		Name: input.Name, Description: input.Description, RetentionDays: input.RetentionDays,
	}
	if input.ExcludePatterns != nil {
		req.ExcludePatterns = make([]string, len(*input.ExcludePatterns))
		copy(req.ExcludePatterns, *input.ExcludePatterns)
	}
	job, err := h.service.CreateDownloadJob(c.Request.Context(), req)
	respondTransferCreation(c, job, err)
}

func (h *TransferJobHandler) List(c *gin.Context) {

	req := &transferjob.ListRequest{
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

	stats, err := h.service.GetStatistics(c.Request.Context())
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "statistics_failed", err.Error())
		return
	}
	RespondSuccess(c, stats)
}

func (h *TransferJobHandler) GetByID(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	job, err := h.service.GetJob(c.Request.Context(), id)
	if err != nil {
		respondTransferJobError(c, err)
		return
	}
	RespondSuccess(c, job)
}

func (h *TransferJobHandler) Cancel(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.service.CancelJob(c.Request.Context(), id); err != nil {
		respondTransferJobError(c, err)
		return
	}
	RespondSuccess(c, protocol.TransferMutationResult{Success: true})
}

func (h *TransferJobHandler) Delete(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.service.DeleteJob(c.Request.Context(), id); err != nil {
		respondTransferJobError(c, err)
		return
	}
	RespondSuccess(c, protocol.TransferMutationResult{Success: true})
}

func (h *TransferJobHandler) DownloadArtifact(c *gin.Context) {
	release, err := h.limiter.Acquire(c.Request.Context(), false)
	if err != nil {
		accessError(c, err)
		return
	}
	defer release()
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	job, artifactPath, err := h.service.GetArtifact(c.Request.Context(), id)
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
	scope := access.Current(c.Request.Context())
	requirements, err := h.service.ArtifactRequirements(c.Request.Context(), scope, id.String())
	if err != nil {
		respondTransferJobError(c, err)
		return
	}
	lease, err := scope.OpenWork(c.Request.Context(), access.Task, requirements...)
	if err != nil {
		accessError(c, err)
		return
	}
	defer lease.Close(nil)
	file, err := os.Open(artifactPath)
	if err != nil {
		respondTransferJobError(c, transferjob.ErrArtifactNotReady)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		respondTransferJobError(c, transferjob.ErrArtifactNotReady)
		return
	}
	if err := scope.CheckBytes(lease.Context(), requirements[0], info.Size()); err != nil {
		accessError(c, err)
		return
	}
	controller := http.NewResponseController(c.Writer)
	stop := context.AfterFunc(lease.Context(), func() { _ = controller.SetWriteDeadline(time.Now()); _ = file.Close() })
	defer stop()
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": fileName}))
	c.Header("Content-Length", strconv.FormatInt(info.Size(), 10))
	c.Header("X-Content-Type-Options", "nosniff")
	metered, finish := access.MeterWriter(lease.Context(), requirements[0], c.Writer)
	defer finish()
	_, err = io.Copy(metered, io.LimitReader(file, info.Size()))
	err = errors.Join(err, finish())
	if err != nil {
		if !c.Writer.Written() {
			c.Header("Content-Length", "")
			c.Header("Content-Disposition", "")
			accessError(c, err)
		} else {
			c.Abort()
		}
	}
}

func respondTransferCreation(c *gin.Context, job *transferjob.TransferJob, err error) {
	if err != nil {
		respondTransferJobError(c, err)
		return
	}
	RespondSuccess(c, job)
}

func respondTransferJobError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, resultstore.ErrUnavailable):
		RespondError(c, http.StatusServiceUnavailable, "storage_unavailable", "Transfer storage is unavailable")
	case errors.Is(err, transferjob.ErrOutcomeConflict):
		RespondError(c, http.StatusConflict, "transfer_outcome_conflict", "Observed transfer outcome conflicts with the stored record")
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
		accessError(c, err)
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
