package runtime

import (
	"context"
	"encoding/json"

	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/shared/aitooloutput"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/google/uuid"
)

func (m *Manager) sessionToolSpec(s *session, name string) (registry.ToolSpec, bool) {
	if name == aiworkspace.CreateTool {
		return registry.ToolSpec{Name: name, DisplayName: "生成文件", Description: aiworkspace.CreateDescription,
			Parameters: aiworkspace.CreateParameters(), ConfirmStrategy: registry.ConfirmNone,
			Executor: func(ctx context.Context, userID uuid.UUID, raw json.RawMessage) (registry.ExecutionResult, error) {
				if err := ctx.Err(); err != nil {
					return registry.ExecutionResult{}, err
				}
				file, err := aiworkspace.Create(raw)
				if err != nil {
					return registry.ExecutionResult{}, err
				}
				return registry.ExecutionResult{Content: "文件已生成，可在文件面板预览和下载：" + file.Name, Artifact: file}, nil
			}}, true
	}
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

func (m *Manager) GetTaskFile(userID uuid.UUID, sessionID, taskID string) (*aiworkspace.FileArtifact, error) {
	s, err := m.getOrRestoreSession(context.Background(), userID, sessionID)
	if err != nil {
		return nil, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	task, ok := s.tasks[taskID]
	if !ok || task.view.Artifact == nil {
		return nil, ErrTaskNotFound
	}
	file := *task.view.Artifact
	return &file, nil
}
