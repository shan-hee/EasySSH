package rest

import (
	"context"
	"net/http"
	"strings"

	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/gin-gonic/gin"
)

// SystemConfigHandler 系统配置处理器
type SystemConfigHandler struct {
	service     systemconfig.Service
	roleService interface {
		RoleExists(ctx context.Context, key string) (bool, error)
	}
}

// NewSystemConfigHandler 创建系统配置处理器
func NewSystemConfigHandler(service systemconfig.Service, roleService interface {
	RoleExists(ctx context.Context, key string) (bool, error)
}) *SystemConfigHandler {
	return &SystemConfigHandler{service: service, roleService: roleService}
}

// GetSystemConfigResponseV2 获取系统配置响应（新版）
type GetSystemConfigResponseV2 struct {
	Config *SystemConfigDTOV2 `json:"config"`
}

// SystemConfigDTOV2 系统配置DTO（新版）
type SystemConfigDTOV2 struct {
	SystemName              string `json:"system_name"`
	SystemLogo              string `json:"system_logo"`
	SystemFavicon           string `json:"system_favicon"`
	DefaultLanguage         string `json:"default_language"`
	DefaultTimezone         string `json:"default_timezone"`
	DateFormat              string `json:"date_format"`
	DownloadExcludePatterns string `json:"download_exclude_patterns"`
	DefaultDownloadMode     string `json:"default_download_mode"`
	SkipExcludedOnUpload    bool   `json:"skip_excluded_on_upload"`
	MaxFileUploadSize       int    `json:"max_file_upload_size"`
	TransferStoragePath     string `json:"transfer_storage_path"`
	TransferRetentionDays   int    `json:"transfer_retention_days"`
	TransferMaxStorageGB    int    `json:"transfer_max_storage_gb"`
	TransferMaxConcurrency  int    `json:"transfer_max_concurrency"`
	TransferCleanupEnabled  bool   `json:"transfer_cleanup_enabled"`
	// 注册配置
	AllowRegistration bool   `json:"allow_registration"`
	DefaultRole       string `json:"default_role"`
	// OAuth 配置
	OAuthEnabled          bool   `json:"oauth_enabled"`
	GoogleClientID        string `json:"google_client_id"`
	GoogleClientSecret    string `json:"google_client_secret,omitempty"`
	HasGoogleClientSecret bool   `json:"has_google_client_secret,omitempty"`
	// OAuth/OIDC 令牌生命周期（不包含 OAUTH_GLOBAL_SECRET）
	OAuthAccessTokenMinutes int `json:"oauth_access_token_minutes"`
	OAuthRefreshTokenDays   int `json:"oauth_refresh_token_days"`
}

// GetSystemConfig 获取系统配置
// @Summary 获取系统配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Success 200 {object} GetSystemConfigResponse
// @Router /api/v1/settings/system [get]
func (h *SystemConfigHandler) GetSystemConfig(c *gin.Context) {
	config, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 转换为DTO
	dto := h.toDTO(config)

	c.JSON(http.StatusOK, GetSystemConfigResponseV2{Config: dto})
}

// SaveSystemConfig 保存系统配置
// @Summary 保存系统配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body SystemConfigDTOV2 true "系统配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system [post]
func (h *SystemConfigHandler) SaveSystemConfig(c *gin.Context) {
	var dto SystemConfigDTOV2
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// 转换为模型
	config, err := h.fromDTO(&dto)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !h.validateDefaultRole(c, config.DefaultRole) {
		return
	}

	if err := h.service.Save(c.Request.Context(), config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "System configuration saved successfully"})
}

// toDTO 将模型转换为DTO
func (h *SystemConfigHandler) toDTO(config *systemconfig.SystemConfig) *SystemConfigDTOV2 {
	oauthTokenConfig := config.OAuthTokenConfig()
	dto := &SystemConfigDTOV2{
		SystemName:              config.SystemName,
		SystemLogo:              config.SystemLogo,
		SystemFavicon:           config.SystemFavicon,
		DefaultLanguage:         config.DefaultLanguage,
		DefaultTimezone:         config.DefaultTimezone,
		DateFormat:              config.DateFormat,
		DownloadExcludePatterns: config.DownloadExcludePatterns,
		DefaultDownloadMode:     config.DefaultDownloadMode,
		SkipExcludedOnUpload:    config.SkipExcludedOnUpload,
		MaxFileUploadSize:       config.MaxFileUploadSize,
		TransferStoragePath:     config.TransferStoragePath,
		TransferRetentionDays:   config.TransferRetentionDays,
		TransferMaxStorageGB:    config.TransferMaxStorageGB,
		TransferMaxConcurrency:  config.TransferMaxConcurrency,
		TransferCleanupEnabled:  config.TransferCleanupEnabled,
		AllowRegistration:       config.AllowRegistration,
		DefaultRole:             config.DefaultRole,
		OAuthEnabled:            config.OAuthEnabled,
		GoogleClientID:          config.GoogleClientID,
		HasGoogleClientSecret:   config.GoogleClientSecret != "",
		OAuthAccessTokenMinutes: oauthTokenConfig.AccessTokenMinutes,
		OAuthRefreshTokenDays:   oauthTokenConfig.RefreshTokenDays,
	}

	return dto
}

// fromDTO 将DTO转换为模型
func (h *SystemConfigHandler) fromDTO(dto *SystemConfigDTOV2) (*systemconfig.SystemConfig, error) {
	config := &systemconfig.SystemConfig{
		SystemName:              dto.SystemName,
		SystemLogo:              dto.SystemLogo,
		SystemFavicon:           dto.SystemFavicon,
		DefaultLanguage:         dto.DefaultLanguage,
		DefaultTimezone:         dto.DefaultTimezone,
		DateFormat:              dto.DateFormat,
		DownloadExcludePatterns: dto.DownloadExcludePatterns,
		DefaultDownloadMode:     dto.DefaultDownloadMode,
		SkipExcludedOnUpload:    dto.SkipExcludedOnUpload,
		MaxFileUploadSize:       dto.MaxFileUploadSize,
		TransferStoragePath:     dto.TransferStoragePath,
		TransferRetentionDays:   dto.TransferRetentionDays,
		TransferMaxStorageGB:    dto.TransferMaxStorageGB,
		TransferMaxConcurrency:  dto.TransferMaxConcurrency,
		TransferCleanupEnabled:  dto.TransferCleanupEnabled,
		AllowRegistration:       dto.AllowRegistration,
		DefaultRole:             dto.DefaultRole,
		OAuthEnabled:            dto.OAuthEnabled,
		GoogleClientID:          dto.GoogleClientID,
		GoogleClientSecret:      dto.GoogleClientSecret,
		OAuthAccessTokenMinutes: dto.OAuthAccessTokenMinutes,
		OAuthRefreshTokenDays:   dto.OAuthRefreshTokenDays,
	}

	return config, nil
}

// PatchBasicInfo 部分更新基本信息配置
// @Summary 部分更新基本信息配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body SystemConfigDTOV2 true "基本信息配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/basic [patch]
func (h *SystemConfigHandler) PatchBasicInfo(c *gin.Context) {
	var dto SystemConfigDTOV2
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
	existingConfig.SystemName = dto.SystemName
	existingConfig.SystemLogo = dto.SystemLogo
	existingConfig.SystemFavicon = dto.SystemFavicon
	existingConfig.DefaultLanguage = dto.DefaultLanguage
	existingConfig.DefaultTimezone = dto.DefaultTimezone
	existingConfig.DateFormat = dto.DateFormat
	existingConfig.AllowRegistration = dto.AllowRegistration
	existingConfig.DefaultRole = dto.DefaultRole
	existingConfig.OAuthEnabled = dto.OAuthEnabled
	existingConfig.GoogleClientID = dto.GoogleClientID
	existingConfig.GoogleClientSecret = dto.GoogleClientSecret
	if !h.validateDefaultRole(c, existingConfig.DefaultRole) {
		return
	}

	if err := h.service.Save(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Basic info updated successfully"})
}

func (h *SystemConfigHandler) validateDefaultRole(c *gin.Context, key string) bool {
	key = strings.TrimSpace(key)
	if h.roleService == nil || key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Default role is required"})
		return false
	}
	exists, err := h.roleService.RoleExists(c.Request.Context(), key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return false
	}
	if !exists {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Default role does not exist"})
		return false
	}
	return true
}

// PatchFileTransferConfig 部分更新文件传输配置
// @Summary 部分更新文件传输配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body SystemConfigDTOV2 true "文件传输配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/file-transfer [patch]
func (h *SystemConfigHandler) PatchFileTransferConfig(c *gin.Context) {
	var dto SystemConfigDTOV2
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
	existingConfig.DownloadExcludePatterns = dto.DownloadExcludePatterns
	existingConfig.DefaultDownloadMode = dto.DefaultDownloadMode
	existingConfig.SkipExcludedOnUpload = dto.SkipExcludedOnUpload
	existingConfig.MaxFileUploadSize = dto.MaxFileUploadSize
	existingConfig.TransferStoragePath = dto.TransferStoragePath
	existingConfig.TransferRetentionDays = dto.TransferRetentionDays
	existingConfig.TransferMaxStorageGB = dto.TransferMaxStorageGB
	existingConfig.TransferMaxConcurrency = dto.TransferMaxConcurrency
	existingConfig.TransferCleanupEnabled = dto.TransferCleanupEnabled

	if err := h.service.Save(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "File transfer config updated successfully"})
}

// PatchOAuthTokenConfig 部分更新 OAuth/OIDC 令牌生命周期配置。
// @Summary 部分更新 OAuth/OIDC 令牌配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body SystemConfigDTOV2 true "OAuth/OIDC 令牌配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/oauth-token [patch]
func (h *SystemConfigHandler) PatchOAuthTokenConfig(c *gin.Context) {
	var dto SystemConfigDTOV2
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	existingConfig, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	existingConfig.OAuthAccessTokenMinutes = dto.OAuthAccessTokenMinutes
	existingConfig.OAuthRefreshTokenDays = dto.OAuthRefreshTokenDays

	if err := h.service.Save(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "OAuth token configuration saved successfully"})
}
