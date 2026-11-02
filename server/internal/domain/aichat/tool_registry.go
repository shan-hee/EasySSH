package aichat

import (
	"context"
	"encoding/json"

	"github.com/easyssh/server/internal/domain/aichat/registry"
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

	specs := []registry.ToolSpec{
		{
			Name:            "list_servers",
			DisplayName:     "列出服务器",
			Description:     "列出用户的所有服务器。返回服务器列表，包含ID、名称、主机地址、状态等信息。",
			Parameters:      map[string]interface{}{"type": "object", "properties": map[string]interface{}{}, "required": []string{}},
			ConfirmStrategy: registry.ConfirmNone,
			SupportedModes:  []string{"readonly", "balanced", "privileged"},
			Executor:        exec(s.executeListServers, "list_servers"),
		},
		{
			Name:        "get_server_info",
			DisplayName: "获取服务器信息",
			Description: "获取指定服务器的详细信息，包括主机地址、端口、用户名、状态、操作系统等。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID",
					},
				},
				"required": []string{"server_id"},
			},
			ConfirmStrategy: registry.ConfirmNone,
			SupportedModes:  []string{"readonly", "balanced", "privileged"},
			Executor:        exec(s.executeGetServerInfo, "get_server_info"),
		},
		{
			Name:        "execute_command",
			DisplayName: "执行命令",
			Description: "在指定服务器上执行Shell命令。返回命令输出结果。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "要执行命令的服务器ID",
					},
					"command": map[string]interface{}{
						"type":        "string",
						"description": "要执行的Shell命令",
					},
					"timeout": map[string]interface{}{
						"type":        "integer",
						"description": "命令执行超时时间（秒），默认60秒，最大300秒",
						"default":     60,
					},
				},
				"required": []string{"server_id", "command"},
			},
			Dangerous:       true,
			ConfirmStrategy: registry.ConfirmUser,
			SupportedModes:  []string{"balanced", "privileged"},
			Executor:        exec(s.executeCommand, "execute_command"),
		},
		{
			Name:        "list_directory",
			DisplayName: "列出目录",
			Description: "列出服务器上指定目录的内容，包括文件和子目录。按名称排序分页返回；结果含 next_offset 时用它继续读取。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID",
					},
					"path": map[string]interface{}{
						"type":        "string",
						"description": "目录路径，默认为登录用户的主目录",
					},
					"offset": map[string]interface{}{
						"type":        "integer",
						"minimum":     0,
						"description": "跳过的条目数，默认 0",
					},
					"limit": map[string]interface{}{
						"type":        "integer",
						"minimum":     1,
						"description": "本页最多返回条目数，默认 100；内容超过约 48 KiB 时提前结束本页",
					},
				},
				"required": []string{"server_id"},
			},
			ConfirmStrategy: registry.ConfirmNone,
			SupportedModes:  []string{"readonly", "balanced", "privileged"},
			Executor:        exec(s.executeListDirectory, "list_directory"),
		},
		{
			Name:        "read_file",
			DisplayName: "读取文件",
			Description: "读取服务器上指定文本文件（最大 2 MiB）。按行分段返回，结果包含总行数和 sha256；未读完时用提示的 start_line 继续读取。单行超过 48 KiB 时明确报错，不会跳过该行。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID",
					},
					"path": map[string]interface{}{
						"type":        "string",
						"description": "文件路径",
					},
					"start_line": map[string]interface{}{
						"type":        "integer",
						"minimum":     1,
						"description": "起始行号，从 1 开始，默认 1",
					},
					"max_lines": map[string]interface{}{
						"type":        "integer",
						"minimum":     1,
						"description": "最多返回行数，默认 100；内容超过约 48 KiB 时在整行处提前结束",
					},
				},
				"required": []string{"server_id", "path"},
			},
			ConfirmStrategy: registry.ConfirmNone,
			SupportedModes:  []string{"readonly", "balanced", "privileged"},
			Executor:        exec(s.executeReadFile, "read_file"),
		},
		{
			Name:        "write_file",
			DisplayName: "写入文件",
			Description: "向服务器写入最多 2 MiB 的 UTF-8 文本。修改文件优先使用此工具：记录真实原文件和提议内容供用户查看对比，执行前核对原内容，变化时停止写入。会话文件使用 create_artifact。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID",
					},
					"path": map[string]interface{}{
						"type":        "string",
						"description": "文件路径",
					},
					"content": map[string]interface{}{
						"type":        "string",
						"description": "要写入的内容",
					},
					"expected_sha256": map[string]interface{}{
						"type":        "string",
						"description": "可选：read_file 返回的 sha256。文件当前内容与之不同或已删除时拒绝写入",
					},
				},
				"required": []string{"server_id", "path", "content"},
			},
			Dangerous:       true,
			ConfirmStrategy: registry.ConfirmUser,
			SupportedModes:  []string{"balanced", "privileged"},
			Executor:        exec(s.executeWriteFile, "write_file"),
			Prepare:         s.prepareWriteFile,
		},
		{
			Name:        "create_directory",
			DisplayName: "创建目录",
			Description: "在服务器上创建目录。支持递归创建。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID",
					},
					"path": map[string]interface{}{
						"type":        "string",
						"description": "目录路径",
					},
				},
				"required": []string{"server_id", "path"},
			},
			ConfirmStrategy: registry.ConfirmNone,
			SupportedModes:  []string{"balanced", "privileged"},
			Executor:        exec(s.executeCreateDirectory, "create_directory"),
		},
		{
			Name:        "delete_file",
			DisplayName: "删除文件",
			Description: "删除服务器上的文件或目录。目录会被递归删除。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID",
					},
					"path": map[string]interface{}{
						"type":        "string",
						"description": "文件或目录路径",
					},
				},
				"required": []string{"server_id", "path"},
			},
			Dangerous:       true,
			ConfirmStrategy: registry.ConfirmUser,
			SupportedModes:  []string{"balanced", "privileged"},
			Executor:        exec(s.executeDeleteFile, "delete_file"),
		},
		{
			Name:        "get_system_info",
			DisplayName: "系统信息",
			Description: "获取服务器的系统信息，包括 CPU、内存、磁盘、网络和 Docker 概况。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID",
					},
				},
				"required": []string{"server_id"},
			},
			ConfirmStrategy: registry.ConfirmNone,
			SupportedModes:  []string{"readonly", "balanced", "privileged"},
			Executor:        exec(s.executeGetSystemInfo, "get_system_info"),
		},
	}

	return registry.NewToolRegistry(specs)
}
