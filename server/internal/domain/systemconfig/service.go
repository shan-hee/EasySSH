package systemconfig

import (
	"context"
	"errors"
	"fmt"
)

// Service 系统配置服务接口
type Service interface {
	// Get 获取系统配置
	Get(ctx context.Context) (*SystemConfig, error)

	// Save 保存系统配置
	Save(ctx context.Context, config *SystemConfig) error
}

type service struct {
	repo Repository
}

// NewService 创建系统配置服务
func NewService(repo Repository) Service {
	return &service{repo: repo}
}

// Get 获取系统配置
func (s *service) Get(ctx context.Context) (*SystemConfig, error) {
	return s.repo.Get(ctx)
}

// Save 保存系统配置
func (s *service) Save(ctx context.Context, config *SystemConfig) error {
	config.ApplyTransferDefaults()

	// 验证配置
	if err := s.validate(config); err != nil {
		return err
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

	if err := s.validateJWTSessionConfig(config.JWTSessionConfig()); err != nil {
		return err
	}

	return nil
}

func (s *service) validateJWTSessionConfig(config *JWTSessionConfig) error {
	if config.AccessExpireMinutes < 5 || config.AccessExpireMinutes > 1440 {
		return errors.New("JWT access token expiration must be between 5 and 1440 minutes")
	}
	if config.RefreshIdleExpireDays < 1 || config.RefreshIdleExpireDays > 90 {
		return errors.New("JWT refresh token idle expiration must be between 1 and 90 days")
	}
	if config.RefreshAbsoluteExpireDays < 1 || config.RefreshAbsoluteExpireDays > 365 {
		return errors.New("JWT refresh token absolute expiration must be between 1 and 365 days")
	}
	if config.RefreshAbsoluteExpireDays < config.RefreshIdleExpireDays {
		return errors.New("JWT refresh token absolute expiration must be greater than or equal to idle expiration")
	}
	return nil
}
