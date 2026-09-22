package runtime

import (
	"context"
	"encoding/json"

	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/shared/aitooloutput"
	"github.com/google/uuid"
)

func (m *Manager) sessionToolSpec(s *session, name string) (registry.ToolSpec, bool) {
	if name != aitooloutput.ReadResultTool {
		return m.registry.Get(name)
	}
	return registry.ToolSpec{
		Name: name, DisplayName: "查看执行结果", Description: aitooloutput.ReadResultDescription,
		Parameters: aitooloutput.ReadResultParameters(), ConfirmStrategy: registry.ConfirmNone,
		Executor: func(ctx context.Context, userID uuid.UUID, args json.RawMessage) (registry.ExecutionResult, error) {
			if err := ctx.Err(); err != nil {
				return registry.ExecutionResult{}, err
			}
			var input aitooloutput.ReadResultInput
			if err := json.Unmarshal(args, &input); err != nil {
				return registry.ExecutionResult{Content: "读取结果参数无效", IsError: true}, nil
			}
			m.mu.RLock()
			var content string
			found := false
			if userID == s.userID && input.ToolCallID != "" {
				for _, task := range s.tasks {
					if task.toolCall.ID == input.ToolCallID && (task.view.Status == TaskStatusSucceeded || task.view.Status == TaskStatusFailed || task.view.Status == TaskStatusCancelled) {
						content, found = task.view.Result, true
						break
					}
				}
			}
			m.mu.RUnlock()
			if !found {
				return registry.ExecutionResult{Content: "当前会话中未找到该调用的已完成结果", IsError: true}, nil
			}
			page, err := aitooloutput.ReadResultPage(content, input)
			if err != nil {
				return registry.ExecutionResult{Content: err.Error(), IsError: true}, nil
			}
			return registry.ExecutionResult{Content: page}, nil
		},
	}, true
}
