package aichat

import (
	"context"
	"encoding/json"

	"github.com/easyssh/shared/aiworkspace"
)

// ToolCall AI 请求的工具调用
type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// ToolResult 工具执行结果
type ToolResult struct {
	CommandOutput string                    `json:"command_output,omitempty"`
	Artifact      *aiworkspace.FileArtifact `json:"artifact,omitempty"`
	ToolCallID    string                    `json:"tool_call_id"`
	Content       string                    `json:"content"`
	IsError       bool                      `json:"is_error,omitempty"`
	Unknown       bool                      `json:"unknown,omitempty"`
	Cancelled     bool                      `json:"cancelled,omitempty"`
}

// ToolExecutor 工具执行器接口
type ToolExecutor interface {
	Execute(ctx context.Context, args json.RawMessage) (*ToolResult, error)
}
