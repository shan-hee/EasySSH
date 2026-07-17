package systemconfig

import (
	"context"
	"errors"
	"fmt"

	"github.com/easyssh/server/internal/pkg/crypto"
)

// Service 系统配置服务接口
type Service interface {
	// Get 获取系统配置
	Get(ctx context.Context) (*SystemConfig, error)

	// Save 保存系统配置
	Save(ctx context.Context, config *SystemConfig) error
}

type service struct {
	repo      Repository
	encryptor *crypto.Encryptor
}

// NewService 创建系统配置服务
func NewService(repo Repository, encryptor *crypto.Encryptor) Service {
	return &service{repo: repo, encryptor: encryptor}
}

// Get 获取系统配置
func (s *service) Get(ctx context.Context) (*SystemConfig, error) {
	config, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	if config.GoogleClientSecret != "" && s.encryptor != nil {
		decrypted, err := s.encryptor.DecryptSecret(config.GoogleClientSecret, googleClientSecretAAD())
		if err != nil {
			return nil, fmt.Errorf("failed to decrypt Google client secret: %w", err)
		}
		config.GoogleClientSecret = decrypted
	}
	return config, nil
}

// Save 保存系统配置
func (s *service) Save(ctx context.Context, config *SystemConfig) error {
	config.ApplyTransferDefaults()

	// 验证配置
	if err := s.validate(config); err != nil {
		return err
	}
	if s.encryptor != nil {
		if config.GoogleClientSecret == "" {
			if existing, err := s.repo.Get(ctx); err == nil && existing != nil && existing.GoogleClientSecret != "" {
				config.GoogleClientSecret = existing.GoogleClientSecret
			}
		}
		if config.GoogleClientSecret != "" && !crypto.HasEncryptedPrefix(config.GoogleClientSecret) {
			encrypted, err := s.encryptor.EncryptSecret(config.GoogleClientSecret, googleClientSecretAAD())
			if err != nil {
				return fmt.Errorf("failed to encrypt Google client secret: %w", err)
			}
			config.GoogleClientSecret = encrypted
		}
	}

	return s.repo.Save(ctx, config)
}

// validate 验证系统配置
func (s *service) validate(config *SystemConfig) error {
	// 验证系统名称
	if config.SystemName == "" {
		return errors.New("system name is required")
	}
	if len(config.SystemName) > 100 {
		return errors.New("system name is too long (max 100 characters)")
	}

	// 验证语言
	validLanguages := map[string]bool{
		"zh-CN": true,
		"en-US": true,
	}
	if !validLanguages[config.DefaultLanguage] {
		return fmt.Errorf("invalid language: %s", config.DefaultLanguage)
	}

	// 验证时区
	if config.DefaultTimezone == "" {
		return errors.New("timezone is required")
	}

	// 验证日期格式
	if config.DateFormat == "" {
		return errors.New("date format is required")
	}

	// 验证下载模式
	if config.DefaultDownloadMode != "fast" && config.DefaultDownloadMode != "compatible" {
		return fmt.Errorf("invalid download mode: %s", config.DefaultDownloadMode)
	}

	// 验证文件上传大小
	if config.MaxFileUploadSize < 1 || config.MaxFileUploadSize > 1024 {
		return errors.New("max file upload size must be between 1 and 1024 MB")
	}
	if config.TransferRetentionDays < 1 || config.TransferRetentionDays > 30 {
		return errors.New("transfer retention days must be between 1 and 30")
	}
	if config.TransferMaxStorageGB < 1 || config.TransferMaxStorageGB > 1024 {
		return errors.New("transfer max storage must be between 1 and 1024 GB")
	}
	if config.TransferMaxConcurrency < 1 || config.TransferMaxConcurrency > 16 {
		return errors.New("transfer max concurrency must be between 1 and 16")
	}

	if err := s.validateOAuthTokenConfig(config.OAuthTokenConfig()); err != nil {
		return err
	}

	return nil
}

func googleClientSecretAAD() []byte {
	return crypto.SecretAAD("system_config", "system", "google_client_secret")
}

func (s *service) validateOAuthTokenConfig(config *OAuthTokenConfig) error {
	if config.AccessTokenMinutes < 5 || config.AccessTokenMinutes > 1440 {
		return errors.New("OAuth access token expiration must be between 5 and 1440 minutes")
	}
	if config.RefreshTokenDays < 1 || config.RefreshTokenDays > 365 {
		return errors.New("OAuth refresh token expiration must be between 1 and 365 days")
	}
	return nil
}
