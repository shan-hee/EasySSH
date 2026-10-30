package aichat

import (
	"context"
	"errors"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/aiconfig"
	sharedconfig "github.com/easyssh/shared/aiconfig"
	"github.com/easyssh/shared/protocol"
)

var ErrAINotConfigured = errors.New("AI service is not configured")

type ConfigResolver interface {
	Resolve(context.Context) (provider.Config, error)
}
type effectiveConfigResolver struct{ service aiconfig.Service }

func NewConfigResolver(service aiconfig.Service) ConfigResolver {
	return &effectiveConfigResolver{service: service}
}
func (r *effectiveConfigResolver) Resolve(ctx context.Context) (provider.Config, error) {
	if _, err := access.RequireAIActor(ctx); err != nil {
		return provider.Config{}, err
	}
	if err := access.Current(ctx).Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return provider.Config{}, err
	}
	config, err := r.service.Get(ctx)
	if err != nil {
		return provider.Config{}, err
	}
	if !config.Enabled || config.APIKey == "" || len(config.Models) == 0 {
		return provider.Config{}, ErrAINotConfigured
	}
	return provider.Config{Provider: config.Provider, APIKey: config.APIKey, Endpoint: config.Endpoint, Models: config.Models, Model: sharedconfig.FirstModel(config.Models)}, nil
}
