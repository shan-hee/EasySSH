package systemconfig

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyssh/shared/retention"
)

// Service 系统配置服务接口
type Service interface {
	// Get 获取系统配置
	Get(ctx context.Context) (*SystemConfig, error)

	SaveBasic(ctx context.Context, config *SystemConfig) error
	SaveFileTransfer(ctx context.Context, config *SystemConfig) error
	SaveScheduledTasks(ctx context.Context, config *SystemConfig) error
	SaveRetention(ctx context.Context, config *SystemConfig) error
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
	config, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}

	return config, nil
}

func (s *service) SaveBasic(ctx context.Context, config *SystemConfig) error {
	if config == nil {
		return errors.New("basic configuration is required")
	}
	if err := s.validateBasic(config); err != nil {
		return err
	}
	return s.repo.SaveBasic(ctx, config)
}

func (s *service) SaveFileTransfer(ctx context.Context, config *SystemConfig) error {
	if config == nil {
		return errors.New("file transfer configuration is required")
	}
	config.ApplyTransferDefaults()
	if err := s.validateFileTransfer(config); err != nil {
		return err
	}
	return s.repo.SaveFileTransfer(ctx, config)
}

func (s *service) SaveScheduledTasks(ctx context.Context, config *SystemConfig) error {
	if config == nil {
		return errors.New("scheduled task configuration is required")
	}
	if config.JobQueueMaxConcurrency < 1 || config.JobQueueMaxConcurrency > 16 {
		return errors.New("job queue max concurrency must be between 1 and 16")
	}
	return s.repo.SaveScheduledTasks(ctx, config)
}

func (s *service) SaveRetention(ctx context.Context, config *SystemConfig) error {
	if config == nil {
		return errors.New("retention configuration is required")
	}
	if !retention.Valid(config.TaskRetentionDays) || !retention.Valid(config.LogRetentionDays) || !retention.Valid(config.DeletedRetentionDays) {
		return errors.New("retention days must be one of the offered periods, or 0 to keep records forever")
	}
	return s.repo.SaveRetention(ctx, config)
}

func (s *service) validateBasic(config *SystemConfig) error {

	if strings.TrimSpace(config.SystemName) == "" {
		return errors.New("system name is required")
	}
	if len(config.SystemName) > 100 {
		return errors.New("system name is too long (max 100 characters)")
	}

	validLanguages := map[string]bool{
		"zh-CN": true,
		"en-US": true,
	}
	if !validLanguages[config.DefaultLanguage] {
		return fmt.Errorf("invalid language: %s", config.DefaultLanguage)
	}

	if strings.TrimSpace(config.DefaultTimezone) == "" {
		return errors.New("timezone is required")
	}

	if strings.TrimSpace(config.DateFormat) == "" {
		return errors.New("date format is required")
	}
	return nil
}

func (s *service) validateFileTransfer(config *SystemConfig) error {

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

	if config.TransferMaxEntries < 1 || config.TransferMaxEntries > 1000000 {
		return errors.New("transfer max entries must be between 1 and 1000000")
	}
	if config.TransferMaxDepth < 1 || config.TransferMaxDepth > 256 {
		return errors.New("transfer max depth must be between 1 and 256")
	}

	if config.SFTPMaxIdleTimeSeconds < 5 || config.SFTPMaxIdleTimeSeconds > 3600 {
		return errors.New("SFTP max idle time must be between 5 and 3600 seconds")
	}
	if config.SFTPCleanupIntervalSeconds < 5 || config.SFTPCleanupIntervalSeconds > 600 {
		return errors.New("SFTP cleanup interval must be between 5 and 600 seconds")
	}
	if config.SFTPMaxLifeTimeMinutes < 0 || config.SFTPMaxLifeTimeMinutes > 1440 {
		return errors.New("SFTP max life time must be between 0 and 1440 minutes")
	}
	if config.SFTPConnTimeoutSeconds < 1 || config.SFTPConnTimeoutSeconds > 120 {
		return errors.New("SFTP connection timeout must be between 1 and 120 seconds")
	}
	if config.SFTPMaxSessionsPerConn < 0 || config.SFTPMaxSessionsPerConn > 64 {
		return errors.New("SFTP max sessions per connection must be between 0 and 64")
	}

	return nil
}
