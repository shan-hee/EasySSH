package rest

import (
	"context"
	"net/http"

	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/server/internal/domain/transferjob"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
)

// SystemConfigHandler 系统配置处理器
type SystemConfigHandler struct {
	transferStorage transferjob.Service
	transferLimiter *sftp.TransferLimiter
	service         systemconfig.Service
	jobQueue        interface {
		SetMaxConcurrency(maxConcurrency int)
		RuntimeStatus(ctx context.Context) (jobqueue.RuntimeStatus, error)
	}
}

// NewSystemConfigHandler 创建系统配置处理器
func NewSystemConfigHandler(service systemconfig.Service, jobQueue interface {
	SetMaxConcurrency(int)
	RuntimeStatus(context.Context) (jobqueue.RuntimeStatus, error)
}, transferLimiter *sftp.TransferLimiter, transferStorage transferjob.Service) *SystemConfigHandler {
	return &SystemConfigHandler{service: service, jobQueue: jobQueue, transferLimiter: transferLimiter, transferStorage: transferStorage}
}

// GetPublicBranding exposes only the fields needed before owner login.
func (h *SystemConfigHandler) GetPublicBranding(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	config, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "branding_unavailable"})
		return
	}
	c.JSON(http.StatusOK, protocol.PublicBranding{
		SystemName: config.SystemName, SystemLogo: config.SystemLogo,
		SystemFavicon: config.SystemFavicon, DefaultLanguage: config.DefaultLanguage,
	})
}

// GetSystemConfig 获取系统配置
// @Summary 获取系统配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Success 200 {object} protocol.SystemConfigResponse
// @Router /api/v1/settings/system [get]
func (h *SystemConfigHandler) GetSystemConfig(c *gin.Context) {
	config, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 转换为DTO
	dto := h.toDTO(config)

	c.JSON(http.StatusOK, protocol.SystemConfigResponse{Config: *dto})
}

// toDTO 将模型转换为DTO
func (h *SystemConfigHandler) toDTO(config *systemconfig.SystemConfig) *protocol.SystemConfig {
	dto := &protocol.SystemConfig{
		PublicURL:                  config.PublicURL,
		SystemName:                 config.SystemName,
		SystemLogo:                 config.SystemLogo,
		SystemFavicon:              config.SystemFavicon,
		DefaultLanguage:            config.DefaultLanguage,
		DefaultTimezone:            config.DefaultTimezone,
		DateFormat:                 config.DateFormat,
		DownloadExcludePatterns:    config.DownloadExcludePatterns,
		SkipExcludedOnUpload:       config.SkipExcludedOnUpload,
		MaxFileUploadSize:          config.MaxFileUploadSize,
		TransferStoragePath:        config.TransferStoragePath,
		TransferRetentionDays:      config.TransferRetentionDays,
		TransferMaxStorageGB:       config.TransferMaxStorageGB,
		TransferMaxConcurrency:     config.TransferMaxConcurrency,
		TransferMaxEntries:         config.TransferMaxEntries,
		TransferMaxDepth:           config.TransferMaxDepth,
		TransferCleanupEnabled:     config.TransferCleanupEnabled,
		SFTPMaxIdleTimeSeconds:     config.SFTPMaxIdleTimeSeconds,
		SFTPCleanupIntervalSeconds: config.SFTPCleanupIntervalSeconds,
		SFTPMaxLifeTimeMinutes:     config.SFTPMaxLifeTimeMinutes,
		SFTPConnTimeoutSeconds:     config.SFTPConnTimeoutSeconds,
		SFTPMaxSessionsPerConn:     config.SFTPMaxSessionsPerConn,
		JobQueueMaxConcurrency:     config.JobQueueMaxConcurrency,
	}

	return dto
}

// PatchBasicInfo 部分更新基本信息配置
// @Summary 部分更新基本信息配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body protocol.SystemBasicUpdate true "基本信息配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/basic [patch]
func (h *SystemConfigHandler) PatchBasicInfo(c *gin.Context) {
	var dto protocol.SystemBasicUpdate
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// 获取现有配置
	existingConfig, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 只更新基本信息字段
	if dto.PublicURL != nil {
		existingConfig.PublicURL = *dto.PublicURL
	}
	if dto.SystemName != nil {
		existingConfig.SystemName = *dto.SystemName
	}
	if dto.SystemLogo != nil {
		existingConfig.SystemLogo = *dto.SystemLogo
	}
	if dto.SystemFavicon != nil {
		existingConfig.SystemFavicon = *dto.SystemFavicon
	}
	if dto.DefaultLanguage != nil {
		existingConfig.DefaultLanguage = *dto.DefaultLanguage
	}
	if dto.DefaultTimezone != nil {
		existingConfig.DefaultTimezone = *dto.DefaultTimezone
	}
	if dto.DateFormat != nil {
		existingConfig.DateFormat = *dto.DateFormat
	}
	if err := h.service.SaveBasic(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "Basic info updated successfully"})
}

// PatchFileTransferConfig 部分更新文件传输配置
// @Summary 部分更新文件传输配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body protocol.FileTransferConfigUpdate true "文件传输配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/file-transfer [patch]
func (h *SystemConfigHandler) PatchFileTransferConfig(c *gin.Context) {
	var dto protocol.FileTransferConfigUpdate
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// 获取现有配置
	existingConfig, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 只更新文件传输字段
	if dto.DownloadExcludePatterns != nil {
		existingConfig.DownloadExcludePatterns = *dto.DownloadExcludePatterns
	}
	if dto.SkipExcludedOnUpload != nil {
		existingConfig.SkipExcludedOnUpload = *dto.SkipExcludedOnUpload
	}
	if dto.MaxFileUploadSize != nil {
		existingConfig.MaxFileUploadSize = *dto.MaxFileUploadSize
	}
	if dto.TransferStoragePath != nil {
		existingConfig.TransferStoragePath = *dto.TransferStoragePath
	}
	if dto.TransferRetentionDays != nil {
		existingConfig.TransferRetentionDays = *dto.TransferRetentionDays
	}
	if dto.TransferMaxStorageGB != nil {
		existingConfig.TransferMaxStorageGB = *dto.TransferMaxStorageGB
	}
	if dto.TransferMaxConcurrency != nil {
		existingConfig.TransferMaxConcurrency = *dto.TransferMaxConcurrency
	}
	if dto.TransferMaxEntries != nil {
		existingConfig.TransferMaxEntries = *dto.TransferMaxEntries
	}
	if dto.TransferMaxDepth != nil {
		existingConfig.TransferMaxDepth = *dto.TransferMaxDepth
	}
	if dto.TransferCleanupEnabled != nil {
		existingConfig.TransferCleanupEnabled = *dto.TransferCleanupEnabled
	}
	if dto.SFTPMaxIdleTimeSeconds != nil {
		existingConfig.SFTPMaxIdleTimeSeconds = *dto.SFTPMaxIdleTimeSeconds
	}
	if dto.SFTPCleanupIntervalSeconds != nil {
		existingConfig.SFTPCleanupIntervalSeconds = *dto.SFTPCleanupIntervalSeconds
	}
	if dto.SFTPMaxLifeTimeMinutes != nil {
		existingConfig.SFTPMaxLifeTimeMinutes = *dto.SFTPMaxLifeTimeMinutes
	}
	if dto.SFTPConnTimeoutSeconds != nil {
		existingConfig.SFTPConnTimeoutSeconds = *dto.SFTPConnTimeoutSeconds
	}
	if dto.SFTPMaxSessionsPerConn != nil {
		existingConfig.SFTPMaxSessionsPerConn = *dto.SFTPMaxSessionsPerConn
	}

	if err := h.transferStorage.ConfigureStorage(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.transferLimiter.SetLimit(existingConfig.TransferMaxConcurrency)
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: "File transfer config updated successfully"})
}

// GetScheduledTaskConfig 获取后台任务队列配置与当前运行状态。
// @Summary 获取定时任务运行配置
// @Tags 系统设置
// @Produce json
// @Success 200 {object} protocol.ScheduledTaskConfigResponse
// @Router /api/v1/settings/system/scheduled-tasks [get]
func (h *SystemConfigHandler) GetScheduledTaskConfig(c *gin.Context) {
	if h.jobQueue == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Job queue runtime is unavailable"})
		return
	}
	config, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	status, err := h.jobQueue.RuntimeStatus(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, protocol.ScheduledTaskConfigResponse{
		Config: protocol.ScheduledTaskConfig{JobQueueMaxConcurrency: config.JobQueueMaxConcurrency},
		Status: status,
	})
}

// PatchScheduledTaskConfig 更新后台任务最大并发并立即应用。
// @Summary 更新定时任务运行配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body protocol.ScheduledTaskConfig true "定时任务运行配置"
// @Success 200 {object} protocol.ScheduledTaskConfigResponse
// @Router /api/v1/settings/system/scheduled-tasks [patch]
func (h *SystemConfigHandler) PatchScheduledTaskConfig(c *gin.Context) {
	if h.jobQueue == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Job queue runtime is unavailable"})
		return
	}
	var dto protocol.ScheduledTaskConfig
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	existingConfig, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	existingConfig.JobQueueMaxConcurrency = dto.JobQueueMaxConcurrency
	if err := h.service.SaveScheduledTasks(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.jobQueue.SetMaxConcurrency(existingConfig.JobQueueMaxConcurrency)
	status, err := h.jobQueue.RuntimeStatus(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, protocol.ScheduledTaskConfigResponse{Config: dto, Status: status})
}
