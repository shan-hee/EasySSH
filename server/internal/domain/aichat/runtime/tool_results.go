package runtime

import (
	"context"
	"encoding/json"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"

	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/shared/aitooloutput"
	"github.com/easyssh/shared/aiworkspace"
)

func (m *Manager) sessionToolSpec(s *session, name string) (registry.ToolSpec, bool) {
	if name == aiworkspace.CreateTool {
		return registry.ToolSpec{Name: name, DisplayName: "生成文件", Description: aiworkspace.CreateDescription,
			Parameters: aiworkspace.CreateParameters(), ConfirmStrategy: registry.ConfirmNone,
			Executor: func(ctx context.Context, raw json.RawMessage) (registry.ExecutionResult, error) {
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
		Executor: func(ctx context.Context, args json.RawMessage) (registry.ExecutionResult, error) {
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
			if sameConversationActor(access.Current(ctx).Actor(), s.actor) && input.ToolCallID != "" {
				for _, task := range s.tasks {
					if task.toolCall.ID == input.ToolCallID && (task.view.Status == TaskStatusSucceeded || task.view.Status == TaskStatusFailed || task.view.Status == TaskStatusCancelled || task.view.Status == TaskStatusUnknown) {
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

func (m *Manager) GetTaskFile(ctx context.Context, sessionID, taskID string) (protocol.ContentReference, error) {
	if err := m.beginOperation(); err != nil {
		return protocol.ContentReference{}, err
	}
	defer m.endOperation()
	actor, err := access.RequireAIActor(ctx)
	if err != nil {
		return protocol.ContentReference{}, err
	}
	m.mu.RLock()
	store := m.store
	m.mu.RUnlock()
	if store == nil {
		return protocol.ContentReference{}, ErrTaskNotFound
	}
	return store.TaskFile(ctx, actor, sessionID, taskID)
}
