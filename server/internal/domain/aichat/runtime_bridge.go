package aichat

import (
	"time"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/server/internal/domain/aiconfig"
)

func NewRuntimeManager(
	aiConfigService aiconfig.Service,
	toolExecutor *ToolExecutorService,
) *runtime.Manager {
	toolRegistry := registry.NewToolRegistry(nil)
	if toolExecutor != nil {
		toolRegistry = toolExecutor.BuildToolRegistry()
	}

	manager := runtime.NewManager(
		NewConfigResolver(aiConfigService),
		provider.NewFactory(),
		toolRegistry,
		30*time.Minute,
	)
	if toolExecutor != nil {
		manager.SetServerReferenceResolver(toolExecutor.ResolveServerReferences)
	}
	return manager
}
