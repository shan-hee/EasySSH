package main

import (
	"encoding/json"

	"github.com/easyssh/shared/aitooloutput"
)

func desktopAIReadToolResult(record desktopAISessionRecord, args map[string]any) desktopAIToolResult {
	raw, err := json.Marshal(args)
	if err != nil {
		return desktopAIToolError("读取结果参数无效")
	}
	var input aitooloutput.ReadResultInput
	if json.Unmarshal(raw, &input) != nil || input.ToolCallID == "" {
		return desktopAIToolError("读取结果参数无效")
	}
	for _, task := range record.Tasks {
		if task.ToolCallID != input.ToolCallID || (task.Status != DesktopAITaskSucceeded && task.Status != DesktopAITaskFailed && task.Status != DesktopAITaskCancelled) {
			continue
		}
		page, err := aitooloutput.ReadResultPage(task.Result, input)
		if err != nil {
			return desktopAIToolError(err.Error())
		}
		return desktopAIToolResult{Content: page}
	}
	return desktopAIToolError("当前会话中未找到该调用的已完成结果")
}
