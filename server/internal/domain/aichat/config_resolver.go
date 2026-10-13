package aichat

import (
	"context"
	"errors"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/aiconfig"
	"github.com/easyssh/server/internal/domain/useraiconfig"
	sharedaiconfig "github.com/easyssh/shared/aiconfig"
	"github.com/google/uuid"
)

var (
	ErrAINotConfigured = errors.New("AI service is not configured")
)

type ConfigResolver interface {
	Resolve(ctx context.Context, userID uuid.UUID) (provider.Config, error)
}

type effectiveConfigResolver struct {
	aiConfigService     aiconfig.Service
	userAIConfigService useraiconfig.Service
}

func NewConfigResolver(
	aiConfigService aiconfig.Service,
	userAIConfigService useraiconfig.Service,
) ConfigResolver {
	return &effectiveConfigResolver{
		aiConfigService:     aiConfigService,
		userAIConfigService: userAIConfigService,
	}
}

func (r *effectiveConfigResolver) Resolve(ctx context.Context, userID uuid.UUID) (provider.Config, error) {
	userConfig, err := r.userAIConfigService.GetUserConfig(ctx, userID)
	if err == nil && userConfig != nil && !userConfig.UseSystemConfig && userConfig.CustomEnabled {
		models := sharedaiconfig.ParseModels(userConfig.CustomModels)

		return provider.Config{
			Provider: sharedaiconfig.NormalizeProvider(userConfig.CustomProvider),
			APIKey:   userConfig.CustomAPIKey,
			Endpoint: userConfig.CustomEndpoint,
			Model:    sharedaiconfig.FirstModel(models),
			Models:   models,
		}, nil
	}

	systemConfig, err := r.aiConfigService.GetSystemConfig(ctx)
	if err != nil {
		return provider.Config{}, errors.Join(errors.New("failed to get system AI config"), err)
	}

	if !systemConfig.SystemEnabled {
		return provider.Config{}, ErrAINotConfigured
	}

	models := sharedaiconfig.ParseModels(systemConfig.SystemModels)
	return provider.Config{
		Provider: sharedaiconfig.NormalizeProvider(systemConfig.SystemProvider),
		APIKey:   systemConfig.SystemAPIKey,
		Endpoint: systemConfig.SystemAPIEndpoint,
		Model:    sharedaiconfig.FirstModel(models),
		Models:   models,
	}, nil
}
