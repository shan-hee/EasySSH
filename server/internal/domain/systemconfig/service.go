package systemconfig

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyssh/server/internal/pkg/crypto"
)

// Service 系统配置服务接口
type Service interface {
	// Get 获取系统配置
	Get(ctx context.Context) (*SystemConfig, error)

	SaveBasic(ctx context.Context, config *SystemConfig) error
	SaveRegistration(ctx context.Context, config *SystemConfig) error
	SaveGoogleAuth(ctx context.Context, config *SystemConfig) error
	SaveOAuthProvider(ctx context.Context, config *SystemConfig) error
	SaveFileTransfer(ctx context.Context, config *SystemConfig) error
	SaveRuntime(ctx context.Context, config *SystemConfig) error
}

type service struct {
	repo       Repository
	encryptor  *crypto.Encryptor
	production bool
}

// NewService 创建系统配置服务
func NewService(repo Repository, encryptor *crypto.Encryptor, production bool) Service {
	return &service{repo: repo, encryptor: encryptor, production: production}
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

func (s *service) SaveBasic(ctx context.Context, config *SystemConfig) error {
	if config == nil {
		return errors.New("basic configuration is required")
	}
	if err := s.validateBasic(config); err != nil {
		return err
	}
	return s.repo.SaveBasic(ctx, config)
}

func (s *service) SaveRegistration(ctx context.Context, config *SystemConfig) error {
	if config == nil {
		return errors.New("registration configuration is required")
	}
	config.DefaultRole = strings.TrimSpace(config.DefaultRole)
	if err := s.validateRegistration(config); err != nil {
		return err
	}
	return s.repo.SaveRegistration(ctx, config)
}

func (s *service) SaveGoogleAuth(ctx context.Context, config *SystemConfig) error {
	if config == nil {
		return errors.New("Google authentication configuration is required")
	}
	config.GoogleClientID = strings.TrimSpace(config.GoogleClientID)
	updateSecret := config.GoogleClientSecret != ""
	hasSecret := updateSecret
	if !hasSecret {
		existing, err := s.repo.Get(ctx)
		if err != nil {
			return err
		}
		hasSecret = existing != nil && existing.GoogleClientSecret != ""
	}
	if err := s.validateGoogleAuth(config, hasSecret); err != nil {
		return err
	}
	if updateSecret {
		if s.encryptor == nil {
			return errors.New("Google client secret encryption is unavailable")
		}
		encrypted, err := s.encryptor.EncryptSecret(config.GoogleClientSecret, googleClientSecretAAD())
		if err != nil {
			return fmt.Errorf("failed to encrypt Google client secret: %w", err)
		}
		config.GoogleClientSecret = encrypted
	}
	return s.repo.SaveGoogleAuth(ctx, config, updateSecret)
}

func (s *service) SaveOAuthProvider(ctx context.Context, config *SystemConfig) error {
	if config == nil {
		return errors.New("external OAuth/OIDC Provider configuration is required")
	}
	config.ExternalOAuthIssuer = strings.TrimRight(strings.TrimSpace(config.ExternalOAuthIssuer), "/")
	config.ExternalOAuthLoginURL = strings.TrimSpace(config.ExternalOAuthLoginURL)
	config.ExternalOAuthRedirectURIs = strings.TrimSpace(config.ExternalOAuthRedirectURIs)
	if err := s.validateOAuthProvider(config); err != nil {
		return err
	}
	return s.repo.SaveOAuthProvider(ctx, config)
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

func (s *service) SaveRuntime(ctx context.Context, config *SystemConfig) error {
	if config == nil {
		return errors.New("runtime configuration is required")
	}
	config.GeoIPDatabasePath = strings.TrimSpace(config.GeoIPDatabasePath)
	return s.repo.SaveRuntime(ctx, config)
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

func (s *service) validateRegistration(config *SystemConfig) error {
	if len(config.DefaultRole) < 2 || len(config.DefaultRole) > 64 {
		return errors.New("default role must be between 2 and 64 characters")
	}
	if config.DefaultRole == "admin" {
		return errors.New("administrator role cannot be assigned as the self-registration default")
	}
	return nil
}

func (s *service) validateGoogleAuth(config *SystemConfig, hasSecret bool) error {
	if !config.OAuthEnabled {
		return nil
	}
	if config.GoogleClientID == "" {
		return errors.New("Google client ID is required when Google sign-in is enabled")
	}
	if !hasSecret {
		return errors.New("Google client secret is required when Google sign-in is enabled")
	}
	return nil
}

func (s *service) validateFileTransfer(config *SystemConfig) error {
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

func (s *service) validateOAuthProvider(config *SystemConfig) error {
	if config.OAuthAccessTokenMinutes < 5 || config.OAuthAccessTokenMinutes > 1440 {
		return errors.New("OAuth access token expiration must be between 5 and 1440 minutes")
	}
	if config.OAuthRefreshTokenDays < 1 || config.OAuthRefreshTokenDays > 365 {
		return errors.New("OAuth refresh token expiration must be between 1 and 365 days")
	}
	tokenConfig := config.OAuthTokenConfig()
	if tokenConfig.ExternalOAuthProviderEnabled || tokenConfig.Issuer != "" || tokenConfig.LoginURL != "" || strings.TrimSpace(tokenConfig.RedirectURIs) != "" {
		if err := tokenConfig.ValidateExternalProvider(s.production); err != nil {
			return err
		}
	}
	return nil
}

func googleClientSecretAAD() []byte {
	return crypto.SecretAAD("system_config", "system", "google_client_secret")
}
