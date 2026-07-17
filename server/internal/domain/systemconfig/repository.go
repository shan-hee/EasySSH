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

	// Save 保存系统配置
	Save(ctx context.Context, config *SystemConfig) error
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
				SystemName:              "EasySSH",
				DefaultLanguage:         "zh-CN",
				DefaultTimezone:         "Asia/Shanghai",
				DateFormat:              "YYYY-MM-DD HH:mm:ss",
				DefaultDownloadMode:     "fast",
				SkipExcludedOnUpload:    true,
				MaxFileUploadSize:       100,
				DownloadExcludePatterns: DefaultDownloadExcludePatterns(),
				TransferStoragePath:     DefaultTransferStoragePath(),
				TransferRetentionDays:   DefaultTransferRetentionDays(),
				TransferMaxStorageGB:    DefaultTransferMaxStorageGB(),
				TransferMaxConcurrency:  DefaultTransferMaxConcurrency(),
				TransferCleanupEnabled:  true,
				OAuthAccessTokenMinutes: oauthDefaults.AccessTokenMinutes,
				OAuthRefreshTokenDays:   oauthDefaults.RefreshTokenDays,
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

// Save 保存系统配置
func (r *repository) Save(ctx context.Context, config *SystemConfig) error {
	config.ApplyTransferDefaults()

	// 查询是否存在配置
	var existing SystemConfig
	err := r.db.WithContext(ctx).First(&existing).Error

	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 不存在则创建
		return r.db.WithContext(ctx).Create(config).Error
	} else if err != nil {
		return err
	}

	// 存在则更新（保留ID）
	config.ID = existing.ID
	return r.db.WithContext(ctx).Save(config).Error
}
