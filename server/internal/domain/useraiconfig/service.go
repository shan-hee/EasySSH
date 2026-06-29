package useraiconfig

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyssh/server/internal/pkg/crypto"
	"github.com/google/uuid"
)

// Service 用户AI配置服务接口
type Service interface {
	// GetUserConfig 获取用户AI配置
	GetUserConfig(ctx context.Context, userID uuid.UUID) (*UserAIConfig, error)

	// SaveUserConfig 保存用户AI配置
	SaveUserConfig(ctx context.Context, config *UserAIConfig) error

	// DeleteUserConfig 删除用户AI配置（恢复使用系统配置）
	DeleteUserConfig(ctx context.Context, userID uuid.UUID) error
}

type service struct {
	repo      Repository
	encryptor *crypto.Encryptor
}

// NewService 创建用户AI配置服务
func NewService(repo Repository, encryptor *crypto.Encryptor) Service {
	return &service{repo: repo, encryptor: encryptor}
}

// GetUserConfig 获取用户AI配置
func (s *service) GetUserConfig(ctx context.Context, userID uuid.UUID) (*UserAIConfig, error) {
	config, err := s.repo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if config.CustomAPIKey != "" && s.encryptor != nil {
		decrypted, err := s.encryptor.DecryptSecret(config.CustomAPIKey, userAPIKeyAAD(config.UserID))
		if err != nil {
			return nil, fmt.Errorf("failed to decrypt custom API key: %w", err)
		}
		config.CustomAPIKey = decrypted
	}
	return config, nil
}

// SaveUserConfig 保存用户AI配置
func (s *service) SaveUserConfig(ctx context.Context, config *UserAIConfig) error {
	// 更新已有自定义配置时允许前端不回传密钥，避免因密钥不下发而误要求用户重复填写。
	if !config.UseSystemConfig && config.CustomEnabled && strings.TrimSpace(config.CustomAPIKey) == "" {
		if existing, err := s.repo.GetByUserID(ctx, config.UserID); err == nil && existing != nil && existing.CustomAPIKey != "" {
			config.CustomAPIKey = existing.CustomAPIKey
		}
	}

	// 验证配置
	if err := s.validateUserConfig(config); err != nil {
		return err
	}
	if config.CustomAPIKey != "" && s.encryptor != nil && !crypto.HasEncryptedPrefix(config.CustomAPIKey) {
		encrypted, err := s.encryptor.EncryptSecret(config.CustomAPIKey, userAPIKeyAAD(config.UserID))
		if err != nil {
			return fmt.Errorf("failed to encrypt custom API key: %w", err)
		}
		config.CustomAPIKey = encrypted
	}

	return s.repo.Save(ctx, config)
}

// DeleteUserConfig 删除用户AI配置（恢复使用系统配置）
func (s *service) DeleteUserConfig(ctx context.Context, userID uuid.UUID) error {
	return s.repo.Delete(ctx, userID)
}

// validateUserConfig 验证用户配置
func (s *service) validateUserConfig(config *UserAIConfig) error {
	// 如果使用系统配置，不需要验证自定义配置
	if config.UseSystemConfig {
		return nil
	}

	// 如果启用自定义配置，需要验证
	if config.CustomEnabled {
		provider := strings.ToLower(strings.TrimSpace(config.CustomProvider))
		if provider == "" {
			provider = "openai"
		}

		// 验证服务商（与系统配置保持一致）
		validProviders := map[string]bool{
			"openai":          true,
			"openai-response": true,
			"gemini":          true,
			"anthropic":       true,
		}
		if !validProviders[provider] {
			return fmt.Errorf("invalid provider: %s (supported: openai, openai-response, gemini, anthropic)", config.CustomProvider)
		}
		config.CustomProvider = provider

		// 验证API密钥
		if config.CustomAPIKey == "" {
			return errors.New("API key is required when custom AI is enabled")
		}

		// 验证模型列表
		if strings.TrimSpace(config.CustomModels) == "" {
			return errors.New("at least one model is required when custom AI is enabled")
		}
	}

	return nil
}

func userAPIKeyAAD(userID uuid.UUID) []byte {
	return crypto.SecretAAD("user_ai_config", userID.String(), "custom_api_key")
}
