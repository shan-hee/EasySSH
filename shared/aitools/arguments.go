package aitools

import (
	"encoding/json"
	"fmt"
)

func DecodeArguments(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}

	var args map[string]any
	if err := json.Unmarshal(raw, &args); err != nil {
		return map[string]any{"_raw": string(raw)}
	}
	if args == nil {
		return map[string]any{}
	}
	return args
}

func SummarizeTask(toolName string, args map[string]any) string {
	for _, key := range []string{"command", "path", "server_id"} {
		if value, ok := args[key]; ok {
			text := fmt.Sprint(value)
			runes := []rune(text)
			if len(runes) > 48 {
				text = string(runes[:48]) + "..."
			}
			return text
		}
	}
	return toolName
}
