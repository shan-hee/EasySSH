package systemconfig

import (
	"context"
	"errors"

	"gorm.io/gorm"
)

// Repository 系统配置仓库接口
type Repository interface {
	// Get 获取系统配置（单例模式，只有一条记录）
	Get(ctx context.Context) (*SystemConfig, error)

	SaveBasic(ctx context.Context, config *SystemConfig) error
	SaveRegistration(ctx context.Context, config *SystemConfig) error
	SaveGoogleAuth(ctx context.Context, config *SystemConfig, updateSecret bool) error
	SaveOAuthProvider(ctx context.Context, config *SystemConfig) error
	SaveFileTransfer(ctx context.Context, config *SystemConfig) error
	SaveRuntime(ctx context.Context, config *SystemConfig) error
}

type repository struct {
	db *gorm.DB
}

// NewRepository 创建系统配置仓库
func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

// Get 获取系统配置
func (r *repository) Get(ctx context.Context) (*SystemConfig, error) {
	var config SystemConfig

	// 查询第一条记录（单例模式）
	err := r.db.WithContext(ctx).First(&config).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 如果不存在，创建默认配置
			oauthDefaults := DefaultOAuthTokenConfig()
			config = SystemConfig{
				SystemName:                   "EasySSH",
				DefaultLanguage:              "zh-CN",
				DefaultTimezone:              "Asia/Shanghai",
				DateFormat:                   "YYYY-MM-DD HH:mm:ss",
				DefaultDownloadMode:          "fast",
				SkipExcludedOnUpload:         true,
				MaxFileUploadSize:            100,
				DownloadExcludePatterns:      DefaultDownloadExcludePatterns(),
				TransferStoragePath:          DefaultTransferStoragePath(),
				TransferRetentionDays:        DefaultTransferRetentionDays(),
				TransferMaxStorageGB:         DefaultTransferMaxStorageGB(),
				TransferMaxConcurrency:       DefaultTransferMaxConcurrency(),
				TransferCleanupEnabled:       true,
				OAuthAccessTokenMinutes:      oauthDefaults.AccessTokenMinutes,
				OAuthRefreshTokenDays:        oauthDefaults.RefreshTokenDays,
				ExternalOAuthProviderEnabled: oauthDefaults.ExternalOAuthProviderEnabled,
				SFTPMaxIdleTimeSeconds:       120,
				SFTPCleanupIntervalSeconds:   30,
				SFTPConnTimeoutSeconds:       10,
				SFTPMaxSessionsPerConn:       8,
			}

			// 创建默认配置
			if err := r.db.WithContext(ctx).Create(&config).Error; err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}

	config.ApplyTransferDefaults()
	return &config, nil
}

func (r *repository) update(ctx context.Context, values map[string]any) error {
	existing, err := r.Get(ctx)
	if err != nil {
		return err
	}
	return r.db.WithContext(ctx).Model(&SystemConfig{}).Where("id = ?", existing.ID).Updates(values).Error
}

func (r *repository) SaveBasic(ctx context.Context, config *SystemConfig) error {
	return r.update(ctx, map[string]any{
		"system_name":      config.SystemName,
		"system_logo":      config.SystemLogo,
		"system_favicon":   config.SystemFavicon,
		"default_language": config.DefaultLanguage,
		"default_timezone": config.DefaultTimezone,
		"date_format":      config.DateFormat,
	})
}

func (r *repository) SaveRegistration(ctx context.Context, config *SystemConfig) error {
	return r.update(ctx, map[string]any{
		"allow_registration": config.AllowRegistration,
		"default_role":       config.DefaultRole,
	})
}

func (r *repository) SaveGoogleAuth(ctx context.Context, config *SystemConfig, updateSecret bool) error {
	values := map[string]any{
		"oauth_enabled":    config.OAuthEnabled,
		"google_client_id": config.GoogleClientID,
	}
	if updateSecret {
		values["google_client_secret"] = config.GoogleClientSecret
	}
	return r.update(ctx, values)
}

func (r *repository) SaveOAuthProvider(ctx context.Context, config *SystemConfig) error {
	return r.update(ctx, map[string]any{
		"oauth_access_token_minutes":      config.OAuthAccessTokenMinutes,
		"oauth_refresh_token_days":        config.OAuthRefreshTokenDays,
		"external_oauth_provider_enabled": config.ExternalOAuthProviderEnabled,
		"external_oauth_issuer":           config.ExternalOAuthIssuer,
		"external_oauth_login_url":        config.ExternalOAuthLoginURL,
		"external_oauth_redirect_uris":    config.ExternalOAuthRedirectURIs,
	})
}

func (r *repository) SaveFileTransfer(ctx context.Context, config *SystemConfig) error {
	return r.update(ctx, map[string]any{
		"download_exclude_patterns":     config.DownloadExcludePatterns,
		"default_download_mode":         config.DefaultDownloadMode,
		"skip_excluded_on_upload":       config.SkipExcludedOnUpload,
		"max_file_upload_size":          config.MaxFileUploadSize,
		"transfer_storage_path":         config.TransferStoragePath,
		"transfer_retention_days":       config.TransferRetentionDays,
		"transfer_max_storage_gb":       config.TransferMaxStorageGB,
		"transfer_max_concurrency":      config.TransferMaxConcurrency,
		"transfer_cleanup_enabled":      config.TransferCleanupEnabled,
		"sftp_max_idle_time_seconds":    config.SFTPMaxIdleTimeSeconds,
		"sftp_cleanup_interval_seconds": config.SFTPCleanupIntervalSeconds,
		"sftp_max_life_time_minutes":    config.SFTPMaxLifeTimeMinutes,
		"sftp_conn_timeout_seconds":     config.SFTPConnTimeoutSeconds,
		"sftp_max_sessions_per_conn":    config.SFTPMaxSessionsPerConn,
	})
}

func (r *repository) SaveRuntime(ctx context.Context, config *SystemConfig) error {
	return r.update(ctx, map[string]any{
		"geo_ip_database_path": config.GeoIPDatabasePath,
	})
}
