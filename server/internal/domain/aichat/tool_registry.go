package aichat

import (
	"context"
	"encoding/json"

	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/shared/aitools"
	"github.com/google/uuid"
)

func (s *ToolExecutorService) BuildToolRegistry() *registry.ToolRegistry {
	if s == nil {
		return registry.NewToolRegistry(nil)
	}

	exec := func(fn func(ctx context.Context, toolCall *ToolCall) (*ToolResult, error), toolName string) registry.ToolExecutor {
		return func(ctx context.Context, args json.RawMessage) (registry.ExecutionResult, error) {
			result, err := fn(ctx, &ToolCall{
				ID:        uuid.NewString(),
				Name:      toolName,
				Arguments: args,
			})
			if err != nil {
				return registry.ExecutionResult{}, err
			}
			return registry.ExecutionResult{
				CommandOutput: result.CommandOutput,
				Content:       result.Content,
				Artifact:      result.Artifact,
				IsError:       result.IsError,
				Unknown:       result.Unknown,
				Cancelled:     result.Cancelled,
			}, nil
		}
	}

	executors := map[string]func(context.Context, *ToolCall) (*ToolResult, error){
		"list_servers":     s.executeListServers,
		"get_server_info":  s.executeGetServerInfo,
		"execute_command":  s.executeCommand,
		"list_directory":   s.executeListDirectory,
		"read_file":        s.executeReadFile,
		"write_file":       s.executeWriteFile,
		"create_directory": s.executeCreateDirectory,
		"delete_file":      s.executeDeleteFile,
		"get_system_info":  s.executeGetSystemInfo,
	}
	specs := make([]registry.ToolSpec, 0, len(executors))
	for _, definition := range aitools.Definitions() {
		spec := registry.ToolSpec{
			Name: definition.Name, DisplayName: definition.DisplayName,
			Description: definition.Description, Parameters: definition.Parameters,
			Executor: exec(executors[definition.Name], definition.Name),
		}
		if definition.Name == "write_file" {
			spec.Prepare = s.prepareWriteFile
		}
		specs = append(specs, spec.WithPolicy())
	}
	return registry.NewToolRegistry(specs)
}
