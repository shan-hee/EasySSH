package aiprovider

import (
	"encoding/json"
	"strings"
	"unicode/utf8"
)

const (
	MaxRequestMessages  = 1024
	MaxRequestTextBytes = 8 << 20
	MaxRequestTools     = 128
	MaxToolSchemaBytes  = 1 << 20
	MaxRequestImages    = 32
	MaxModels           = 4096
	MaxModelIDBytes     = 256
	maxHTTPRequestBytes = 64 << 20
)

// Reject oversized contexts before cloning tool history or constructing SDK
// payloads. No messages are silently dropped: tool calls/results remain paired,
// and the caller retains the complete stored conversation for review or editing.
func validateRequestSize(req TurnRequest) error {
	if len(req.Messages) > MaxRequestMessages {
		return NewLimitError("ai_context_limit", "AI 上下文超过 1024 条消息，请新建会话或编辑历史后继续")
	}
	if len(req.Tools) > MaxRequestTools {
		return NewLimitError("ai_request_limit", "AI 请求工具定义超过 128 项")
	}
	if len(req.Model) > MaxModelIDBytes || !utf8.ValidString(req.Model) {
		return NewLimitError("invalid_model", "AI 模型标识无效或过长")
	}
	remaining := MaxRequestTextBytes
	add := func(value string) bool {
		if len(value) > remaining {
			return false
		}
		remaining -= len(value)
		return true
	}
	images := 0
	for _, message := range req.Messages {
		if !add(message.Role) || !add(message.Content) || !add(message.ToolCallID) {
			return contextSizeError()
		}
		if len(message.ToolCalls) > MaxToolCallsPerResponse {
			return NewLimitError("ai_context_limit", "历史消息中的工具调用超过单次响应上限")
		}
		for _, call := range message.ToolCalls {
			if !add(call.ID) || !add(call.Name) || len(call.Arguments) > remaining {
				return contextSizeError()
			}
			remaining -= len(call.Arguments)
		}
		images += len(message.Attachments)
		if images > MaxRequestImages {
			return NewLimitError("ai_context_limit", "AI 上下文图片超过 32 张，请减少当前会话中的图片")
		}
		for _, attachment := range message.Attachments {
			if !add(attachment.ID) || !add(attachment.Name) || !add(attachment.MediaType) {
				return contextSizeError()
			}
		}
	}
	schemaRemaining := MaxToolSchemaBytes
	for _, tool := range req.Tools {
		if !add(tool.Name) || !add(tool.DisplayName) || !add(tool.Description) {
			return contextSizeError()
		}
		schema, err := json.Marshal(tool.Parameters)
		if err != nil {
			return NewLimitError("invalid_tool_schema", "AI 工具参数定义不能编码为 JSON")
		}
		if len(schema) > schemaRemaining {
			return NewLimitError("ai_request_limit", "AI 工具参数定义总量超过 1 MiB")
		}
		schemaRemaining -= len(schema)
	}
	return nil
}
func contextSizeError() error {
	return NewLimitError("ai_context_limit", "AI 上下文文本与工具参数总量超过 8 MiB，请新建会话或编辑历史后继续")
}

type modelListBudget struct {
	count int
	items map[string]struct{}
}

func (b *modelListBudget) add(raw string) error {
	b.count++
	if b.count > MaxModels {
		return NewLimitError("ai_model_list_limit", "AI 模型列表超过 4096 项，未返回不完整列表")
	}
	id := strings.TrimSpace(raw)
	if id == "" {
		return nil
	}
	if len(id) > MaxModelIDBytes || !utf8.ValidString(id) || strings.ContainsAny(id, "\x00\r\n") {
		return NewLimitError("invalid_model_list", "AI 模型列表含无效或过长标识")
	}
	if b.items == nil {
		b.items = make(map[string]struct{})
	}
	b.items[id] = struct{}{}
	return nil
}
