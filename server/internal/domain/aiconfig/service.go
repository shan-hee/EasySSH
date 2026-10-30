package aiconfig

import (
	"context"
	"errors"
	"fmt"

	sharedconfig "github.com/easyssh/shared/aiconfig"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/secretcrypto"
)

type Service interface {
	Get(context.Context) (*Config, error)
	Save(context.Context, protocol.AIConfigInput) (protocol.OwnerAIConfig, error)
	Reset(context.Context) error
}
type service struct {
	repo      Repository
	encryptor *crypto.Encryptor
}

func NewService(repo Repository, encryptor *crypto.Encryptor) Service {
	return &service{repo: repo, encryptor: encryptor}
}
func (s *service) Get(ctx context.Context) (*Config, error) {
	config, err := s.repo.Get(ctx)
	if err != nil {
		return nil, err
	}
	if config.APIKey != "" {
		if s.encryptor == nil {
			return nil, errors.New("AI secret encryption is unavailable")
		}
		config.APIKey, err = s.encryptor.DecryptSecret(config.APIKey, APIKeyAAD())
		if err != nil {
			return nil, fmt.Errorf("decrypt AI API key: %w", err)
		}
	}
	return config, nil
}
func (s *service) Save(ctx context.Context, input protocol.AIConfigInput) (protocol.OwnerAIConfig, error) {
	current, err := s.Get(ctx)
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	input, err = sharedconfig.NormalizeInput(input, current.Input())
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	config := &Config{ID: ConfigID, Enabled: input.Enabled, Provider: input.Provider, Endpoint: input.Endpoint, Models: input.Models}
	if *input.APIKey != "" {
		if s.encryptor == nil {
			return protocol.OwnerAIConfig{}, errors.New("AI secret encryption is unavailable")
		}
		config.APIKey, err = s.encryptor.EncryptSecret(*input.APIKey, APIKeyAAD())
		if err != nil {
			return protocol.OwnerAIConfig{}, err
		}
	}
	if err := s.repo.Save(ctx, config); err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	return sharedconfig.Public(input), nil
}
func (s *service) Reset(ctx context.Context) error {
	// Keep a disabled value so synchronization propagates the reset as well.
	return s.repo.Save(ctx, &Config{ID: ConfigID, Provider: "openai", Models: []string{}})
}
