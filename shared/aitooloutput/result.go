package aitooloutput

import (
	"encoding/json"
	"fmt"
	"strings"
)

const ReadResultTool = "read_tool_result"
const ReadResultDescription = "按工具调用 ID 分页读取当前会话已保存的工具结果，按需查看历史执行输出。不会重新执行命令或连接服务器。offset 按 Unicode 字符计数。"

func ReadResultParameters() map[string]interface{} {
	return map[string]interface{}{
		"type": "object",
		"properties": map[string]interface{}{
			"tool_call_id": map[string]interface{}{"type": "string", "description": "需要查看的原始工具调用 ID"},
			"offset":       map[string]interface{}{"type": "integer", "minimum": 0, "default": 0},
			"limit":        map[string]interface{}{"type": "integer", "minimum": 1, "maximum": 1000, "default": 1000},
		},
		"required": []string{"tool_call_id"},
	}
}

type ReadResultInput struct {
	ToolCallID string `json:"tool_call_id"`
	Offset     int    `json:"offset"`
	Limit      int    `json:"limit"`
}

// ParseCommandResult separates the execution envelope from the text output.
func ParseCommandResult(content string) (string, map[string]json.RawMessage, string, bool) {
	start := strings.IndexByte(content, '{')
	if start >= 0 {
		var payload map[string]json.RawMessage
		if json.Unmarshal([]byte(content[start:]), &payload) == nil && payload["exit_code"] != nil && payload["server_id"] != nil {
			var output string
			if json.Unmarshal(payload["output"], &output) == nil {
				return content[:start], payload, output, true
			}
		}
	}
	return "", nil, content, false
}

// ReadResultPage reads only stored text; offsets are stable across requests.
func ReadResultPage(content string, input ReadResultInput) (string, error) {
	if input.Offset < 0 || input.Limit < 0 {
		return "", fmt.Errorf("offset 和 limit 不能为负数")
	}
	if input.Limit == 0 {
		input.Limit = 1000
	}
	input.Limit = min(input.Limit, 1000)
	if prefix, payload, output, ok := ParseCommandResult(content); ok {
		// Decode before filtering so JSON-escaped binary cannot bypass detection
		// when a saved result is read again.
		payload["output"], _ = json.Marshal(Sanitize(output))
		encoded, _ := json.Marshal(payload)
		content = prefix + string(encoded)
	}
	runes := []rune(Sanitize(content))
	if input.Offset > len(runes) {
		return "", fmt.Errorf("offset 超出已保存结果长度 %d", len(runes))
	}
	end := input.Offset + min(input.Limit, len(runes)-input.Offset)
	encoded, err := json.Marshal(map[string]interface{}{
		"tool_call_id": input.ToolCallID, "offset": input.Offset, "next_offset": end,
		"total_characters": len(runes), "has_more": end < len(runes), "content": string(runes[input.Offset:end]),
	})
	return string(encoded), err
}
