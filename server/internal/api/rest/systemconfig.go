package rest

import (
	"context"
	"net/http"
	"strings"

	"github.com/easyssh/server/internal/domain/oauthprovider"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/gin-gonic/gin"
)

// SystemConfigHandler 系统配置处理器
type SystemConfigHandler struct {
	service                   systemconfig.Service
	externalOAuthProviderGate *oauthprovider.ExternalProviderGate
	roleService               interface {
		RoleExists(ctx context.Context, key string) (bool, error)
	}
}

// NewSystemConfigHandler 创建系统配置处理器
func NewSystemConfigHandler(service systemconfig.Service, roleService interface {
	RoleExists(ctx context.Context, key string) (bool, error)
}, externalOAuthProviderGate *oauthprovider.ExternalProviderGate) *SystemConfigHandler {
	return &SystemConfigHandler{
		service: service, roleService: roleService, externalOAuthProviderGate: externalOAuthProviderGate,
	}
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
	// OAuth/OIDC Provider 与令牌生命周期（根密钥从部署密钥派生，不返回前端）
	OAuthAccessTokenMinutes         int    `json:"oauth_access_token_minutes"`
	OAuthRefreshTokenDays           int    `json:"oauth_refresh_token_days"`
	ExternalOAuthProviderEnabled    bool   `json:"external_oauth_provider_enabled"`
	ExternalOAuthProviderConfigured bool   `json:"external_oauth_provider_configured"`
	ExternalOAuthIssuer             string `json:"external_oauth_issuer"`
	ExternalOAuthLoginURL           string `json:"external_oauth_login_url"`
	ExternalOAuthRedirectURIs       string `json:"external_oauth_redirect_uris"`
	// SFTP/SSH 连接池（保存后重启生效）
	SFTPMaxIdleTimeSeconds     int    `json:"sftp_max_idle_time_seconds"`
	SFTPCleanupIntervalSeconds int    `json:"sftp_cleanup_interval_seconds"`
	SFTPMaxLifeTimeMinutes     int    `json:"sftp_max_life_time_minutes"`
	SFTPConnTimeoutSeconds     int    `json:"sftp_conn_timeout_seconds"`
	SFTPMaxSessionsPerConn     int    `json:"sftp_max_sessions_per_conn"`
	GeoIPDatabasePath          string `json:"geoip_database_path"`
}

type BasicInfoConfigDTO struct {
	SystemName      string `json:"system_name"`
	SystemLogo      string `json:"system_logo"`
	SystemFavicon   string `json:"system_favicon"`
	DefaultLanguage string `json:"default_language"`
	DefaultTimezone string `json:"default_timezone"`
	DateFormat      string `json:"date_format"`
}

type RegistrationConfigDTO struct {
	AllowRegistration bool   `json:"allow_registration"`
	DefaultRole       string `json:"default_role"`
}

type GoogleAuthConfigDTO struct {
	OAuthEnabled       bool   `json:"oauth_enabled"`
	GoogleClientID     string `json:"google_client_id"`
	GoogleClientSecret string `json:"google_client_secret"`
}

type OAuthProviderConfigDTO struct {
	OAuthAccessTokenMinutes      int    `json:"oauth_access_token_minutes"`
	OAuthRefreshTokenDays        int    `json:"oauth_refresh_token_days"`
	ExternalOAuthProviderEnabled bool   `json:"external_oauth_provider_enabled"`
	ExternalOAuthIssuer          string `json:"external_oauth_issuer"`
	ExternalOAuthLoginURL        string `json:"external_oauth_login_url"`
	ExternalOAuthRedirectURIs    string `json:"external_oauth_redirect_uris"`
}

type FileTransferConfigDTO struct {
	DownloadExcludePatterns    string `json:"download_exclude_patterns"`
	DefaultDownloadMode        string `json:"default_download_mode"`
	SkipExcludedOnUpload       bool   `json:"skip_excluded_on_upload"`
	MaxFileUploadSize          int    `json:"max_file_upload_size"`
	TransferStoragePath        string `json:"transfer_storage_path"`
	TransferRetentionDays      int    `json:"transfer_retention_days"`
	TransferMaxStorageGB       int    `json:"transfer_max_storage_gb"`
	TransferMaxConcurrency     int    `json:"transfer_max_concurrency"`
	TransferCleanupEnabled     bool   `json:"transfer_cleanup_enabled"`
	SFTPMaxIdleTimeSeconds     int    `json:"sftp_max_idle_time_seconds"`
	SFTPCleanupIntervalSeconds int    `json:"sftp_cleanup_interval_seconds"`
	SFTPMaxLifeTimeMinutes     int    `json:"sftp_max_life_time_minutes"`
	SFTPConnTimeoutSeconds     int    `json:"sftp_conn_timeout_seconds"`
	SFTPMaxSessionsPerConn     int    `json:"sftp_max_sessions_per_conn"`
}

type RuntimeConfigDTO struct {
	GeoIPDatabasePath string `json:"geoip_database_path"`
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

// toDTO 将模型转换为DTO
func (h *SystemConfigHandler) toDTO(config *systemconfig.SystemConfig) *SystemConfigDTOV2 {
	oauthTokenConfig := config.OAuthTokenConfig()
	dto := &SystemConfigDTOV2{
		SystemName:                      config.SystemName,
		SystemLogo:                      config.SystemLogo,
		SystemFavicon:                   config.SystemFavicon,
		DefaultLanguage:                 config.DefaultLanguage,
		DefaultTimezone:                 config.DefaultTimezone,
		DateFormat:                      config.DateFormat,
		DownloadExcludePatterns:         config.DownloadExcludePatterns,
		DefaultDownloadMode:             config.DefaultDownloadMode,
		SkipExcludedOnUpload:            config.SkipExcludedOnUpload,
		MaxFileUploadSize:               config.MaxFileUploadSize,
		TransferStoragePath:             config.TransferStoragePath,
		TransferRetentionDays:           config.TransferRetentionDays,
		TransferMaxStorageGB:            config.TransferMaxStorageGB,
		TransferMaxConcurrency:          config.TransferMaxConcurrency,
		TransferCleanupEnabled:          config.TransferCleanupEnabled,
		AllowRegistration:               config.AllowRegistration,
		DefaultRole:                     config.DefaultRole,
		OAuthEnabled:                    config.OAuthEnabled,
		GoogleClientID:                  config.GoogleClientID,
		HasGoogleClientSecret:           config.GoogleClientSecret != "",
		OAuthAccessTokenMinutes:         oauthTokenConfig.AccessTokenMinutes,
		OAuthRefreshTokenDays:           oauthTokenConfig.RefreshTokenDays,
		ExternalOAuthProviderEnabled:    oauthTokenConfig.ExternalOAuthProviderEnabled,
		ExternalOAuthProviderConfigured: h.externalOAuthProviderGate != nil && h.externalOAuthProviderGate.Configured(),
		ExternalOAuthIssuer:             oauthTokenConfig.Issuer,
		ExternalOAuthLoginURL:           oauthTokenConfig.LoginURL,
		ExternalOAuthRedirectURIs:       oauthTokenConfig.RedirectURIs,
		SFTPMaxIdleTimeSeconds:          config.SFTPMaxIdleTimeSeconds,
		SFTPCleanupIntervalSeconds:      config.SFTPCleanupIntervalSeconds,
		SFTPMaxLifeTimeMinutes:          config.SFTPMaxLifeTimeMinutes,
		SFTPConnTimeoutSeconds:          config.SFTPConnTimeoutSeconds,
		SFTPMaxSessionsPerConn:          config.SFTPMaxSessionsPerConn,
		GeoIPDatabasePath:               config.GeoIPDatabasePath,
	}

	return dto
}

// PatchBasicInfo 部分更新基本信息配置
// @Summary 部分更新基本信息配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body BasicInfoConfigDTO true "基本信息配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/basic [patch]
func (h *SystemConfigHandler) PatchBasicInfo(c *gin.Context) {
	var dto BasicInfoConfigDTO
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
	if err := h.service.SaveBasic(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Basic info updated successfully"})
}

// PatchRegistrationConfig 更新用户注册配置。
// @Summary 更新用户注册配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body RegistrationConfigDTO true "用户注册配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/registration [patch]
func (h *SystemConfigHandler) PatchRegistrationConfig(c *gin.Context) {
	var dto RegistrationConfigDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if !h.validateDefaultRole(c, dto.DefaultRole) {
		return
	}
	existingConfig, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	existingConfig.AllowRegistration = dto.AllowRegistration
	existingConfig.DefaultRole = dto.DefaultRole
	if err := h.service.SaveRegistration(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Registration configuration saved successfully"})
}

// PatchGoogleAuthConfig 更新 Google 登录配置。
// @Summary 更新 Google 登录配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body GoogleAuthConfigDTO true "Google 登录配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/google-auth [patch]
func (h *SystemConfigHandler) PatchGoogleAuthConfig(c *gin.Context) {
	var dto GoogleAuthConfigDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	existingConfig, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	existingConfig.OAuthEnabled = dto.OAuthEnabled
	existingConfig.GoogleClientID = dto.GoogleClientID
	existingConfig.GoogleClientSecret = dto.GoogleClientSecret
	if err := h.service.SaveGoogleAuth(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Google authentication configuration saved successfully"})
}

// PatchOAuthProviderConfig 更新对外 OAuth/OIDC Provider 配置。
// @Summary 更新对外 OAuth/OIDC Provider 配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body OAuthProviderConfigDTO true "OAuth/OIDC Provider 配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/oauth-provider [patch]
func (h *SystemConfigHandler) PatchOAuthProviderConfig(c *gin.Context) {
	var dto OAuthProviderConfigDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	if !h.validateExternalOAuthProvider(c, dto.ExternalOAuthProviderEnabled) {
		return
	}
	existingConfig, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	existingConfig.OAuthAccessTokenMinutes = dto.OAuthAccessTokenMinutes
	existingConfig.OAuthRefreshTokenDays = dto.OAuthRefreshTokenDays
	existingConfig.ExternalOAuthProviderEnabled = dto.ExternalOAuthProviderEnabled
	existingConfig.ExternalOAuthIssuer = dto.ExternalOAuthIssuer
	existingConfig.ExternalOAuthLoginURL = dto.ExternalOAuthLoginURL
	existingConfig.ExternalOAuthRedirectURIs = dto.ExternalOAuthRedirectURIs
	if err := h.service.SaveOAuthProvider(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	_ = h.externalOAuthProviderGate.SetEnabled(existingConfig.ExternalOAuthProviderEnabled)
	c.JSON(http.StatusOK, gin.H{"message": "OAuth/OIDC Provider configuration saved successfully"})
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
// @Param request body FileTransferConfigDTO true "文件传输配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/file-transfer [patch]
func (h *SystemConfigHandler) PatchFileTransferConfig(c *gin.Context) {
	var dto FileTransferConfigDTO
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
	existingConfig.SFTPMaxIdleTimeSeconds = dto.SFTPMaxIdleTimeSeconds
	existingConfig.SFTPCleanupIntervalSeconds = dto.SFTPCleanupIntervalSeconds
	existingConfig.SFTPMaxLifeTimeMinutes = dto.SFTPMaxLifeTimeMinutes
	existingConfig.SFTPConnTimeoutSeconds = dto.SFTPConnTimeoutSeconds
	existingConfig.SFTPMaxSessionsPerConn = dto.SFTPMaxSessionsPerConn

	if err := h.service.SaveFileTransfer(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "File transfer config updated successfully"})
}

// PatchRuntimeConfig 更新运行数据服务配置（保存后重启生效）。
// @Summary 更新运行数据服务配置
// @Tags 系统设置
// @Accept json
// @Produce json
// @Param request body RuntimeConfigDTO true "运行数据服务配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/system/runtime [patch]
func (h *SystemConfigHandler) PatchRuntimeConfig(c *gin.Context) {
	var dto RuntimeConfigDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	existingConfig, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	existingConfig.GeoIPDatabasePath = dto.GeoIPDatabasePath
	if err := h.service.SaveRuntime(c.Request.Context(), existingConfig); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Runtime configuration saved successfully"})
}

func (h *SystemConfigHandler) validateExternalOAuthProvider(c *gin.Context, enabled bool) bool {
	if h.externalOAuthProviderGate == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "External OAuth/OIDC Provider gate is unavailable"})
		return false
	}
	if err := h.externalOAuthProviderGate.ValidateEnabled(enabled); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return false
	}
	return true
}
