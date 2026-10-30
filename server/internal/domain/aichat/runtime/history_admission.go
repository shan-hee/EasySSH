package runtime

import (
	"strings"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aipermission"
	"github.com/easyssh/shared/aiprovider"

	"github.com/easyssh/server/internal/domain/aichat/provider"
)

// Called with m.mu held, before reserving a run or mutating the stored session.
// The prospective settings generate the same system context as model dispatch.
func (m *Manager) validateHistoryAdmissionLocked(s *session, messages []provider.Message, visible []MessageView, truncate bool, input SendUserMessageInput) error {
	candidate := &session{permissionMode: s.permissionMode, scope: s.scope}
	if strings.TrimSpace(input.PermissionMode) != "" {
		candidate.permissionMode = normalizePermissionMode(input.PermissionMode)
	}
	if strings.EqualFold(input.Scope.Kind, "global") {
		candidate.scope = SessionScope{}
	} else if scope := normalizeSessionScope(input.Scope); scope.Kind != "" {
		candidate.scope = scope
	}
	tools := m.visibleToolsForSessionLocked(candidate)
	prompt := buildToolSystemPrompt(candidate.permissionMode, tools, candidate.scope)
	proposed := make([]provider.Message, 0, len(messages)+1)
	proposed = append(proposed, provider.Message{Role: "system", Content: prompt})
	proposed = append(proposed, messages...)
	if contextText := strings.TrimSpace(input.Context); contextText != "" {
		proposed = append(proposed, provider.Message{Role: "user", Content: aipermission.ExternalContext(contextText)})
	}
	if err := provider.ValidateContext(proposed); err != nil {
		return err
	}
	kept := make(map[string]bool)
	for _, message := range messages {
		for _, call := range message.ToolCalls {
			kept[call.ID] = true
		}
	}
	tasks := make([]TaskView, 0, len(s.tasks))
	for _, task := range s.tasks {
		if !truncate || kept[task.toolCall.ID] {
			tasks = append(tasks, task.view)
		}
	}
	return validateStoredHistoryGrowth(visible, tasks)
}

// A scratch session carries only message slices; it does not copy mutexes,
// running tasks or persistence state. Rejected edits leave the real history intact.
func (s *session) historyThroughUser(visibleCount int, replacement *string) []provider.Message {
	scratch := session{messages: append([]provider.Message(nil), s.messages...), messageViews: s.messageViews}
	if replacement != nil {
		scratch.updateProviderMessageContentForVisibleMessage(visibleCount, *replacement)
	}
	scratch.truncateProviderMessagesAfterVisibleMessage(visibleCount)
	return scratch.messages
}

// Called under m.mu; use full internal tasks, including artifact bodies.
func (s *session) validateHistoryGrowth() error {
	tasks := make([]TaskView, 0, len(s.tasks))
	for _, task := range s.tasks {
		tasks = append(tasks, task.view)
	}
	return validateStoredHistoryGrowth(s.messageViews, tasks)
}

func validateStoredHistoryGrowth(messages []MessageView, tasks []TaskView) error {
	if err := aichatui.ValidateHistoryGrowth(messages, tasks); err != nil {
		return aiprovider.NewLimitError("ai_history_limit", err.Error())
	}
	return nil
}
