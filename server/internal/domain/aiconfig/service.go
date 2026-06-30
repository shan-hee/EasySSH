package aiconfig

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/easyssh/server/internal/pkg/crypto"
)

// Service AI配置服务接口
type Service interface {
	// GetSystemConfig 获取系统级AI配置
	GetSystemConfig(ctx context.Context) (*AIConfig, error)

	// SaveSystemConfig 保存系统级AI配置
	SaveSystemConfig(ctx context.Context, config *AIConfig) error
}

type service struct {
	repo      Repository
	encryptor *crypto.Encryptor
}

// NewService 创建AI配置服务
func NewService(repo Repository, encryptor *crypto.Encryptor) Service {
	return &service{repo: repo, encryptor: encryptor}
}

// GetSystemConfig 获取系统级AI配置
func (s *service) GetSystemConfig(ctx context.Context) (*AIConfig, error) {
	config, err := s.repo.GetSystemConfig(ctx)
	if err != nil {
		return nil, err
	}
	if config.SystemAPIKey != "" && s.encryptor != nil {
		decrypted, err := s.encryptor.DecryptSecret(config.SystemAPIKey, systemAPIKeyAAD())
		if err != nil {
			return nil, fmt.Errorf("failed to decrypt system API key: %w", err)
		}
		config.SystemAPIKey = decrypted
	}
	return config, nil
}

// SaveSystemConfig 保存系统级AI配置
func (s *service) SaveSystemConfig(ctx context.Context, config *AIConfig) error {
	// 更新系统配置时允许前端不回传密钥，避免因密钥不下发而误清空已有配置。
	if strings.TrimSpace(config.SystemAPIKey) == "" {
		if existing, err := s.repo.GetSystemConfig(ctx); err == nil && existing != nil && existing.SystemAPIKey != "" {
			config.SystemAPIKey = existing.SystemAPIKey
		}
	}

	// 验证配置
	if err := s.validateSystemConfig(config); err != nil {
		return err
	}
	if config.SystemAPIKey != "" && s.encryptor != nil && !crypto.HasEncryptedPrefix(config.SystemAPIKey) {
		encrypted, err := s.encryptor.EncryptSecret(config.SystemAPIKey, systemAPIKeyAAD())
		if err != nil {
			return fmt.Errorf("failed to encrypt system API key: %w", err)
		}
		config.SystemAPIKey = encrypted
	}

	return s.repo.SaveSystemConfig(ctx, config)
}

// validateSystemConfig 验证系统配置
func (s *service) validateSystemConfig(config *AIConfig) error {
	if !config.SystemEnabled {
		return nil
	}

	provider := strings.ToLower(strings.TrimSpace(config.SystemProvider))
	if provider == "" {
		provider = "openai"
	}

	// 验证服务商
	validProviders := map[string]bool{
		"openai":          true,
		"openai-response": true,
		"gemini":          true,
		"anthropic":       true,
	}
	if !validProviders[provider] {
		return fmt.Errorf("invalid provider: %s (supported: openai, openai-response, gemini, anthropic)", config.SystemProvider)
	}
	config.SystemProvider = provider

	// 验证模型列表
	if strings.TrimSpace(config.SystemModels) == "" {
		return errors.New("at least one model is required when system AI is enabled")
	}

	return nil
}

func systemAPIKeyAAD() []byte {
	return crypto.SecretAAD("ai_config", "system", "system_api_key")
}
