package app

import "github.com/easyssh/shared/aichatui"

// Sync contains public history only. Native execution provenance cannot be
// reconstructed from tool IDs or results supplied by another device.
func fromAichatUIMessages(messages []aichatui.MessageView) []DesktopAIMessageView {
	result := make([]DesktopAIMessageView, 0, len(messages))
	for _, message := range messages {
		attachments := make([]DesktopAIImageAttachment, 0, len(message.Attachments))
		for _, attachment := range message.Attachments {
			attachments = append(attachments, DesktopAIImageAttachment(attachment))
		}
		value := DesktopAIMessageView{
			ID: message.ID, Role: message.Role, Content: message.Content, Reasoning: message.Reasoning, ExternalContent: message.ExternalContent,
			ServerReferences: message.ServerReferences, Attachments: attachments,
			CreatedAt: message.CreatedAt.UTC().Format(desktopAITimeLayout),
		}
		if message.Usage != nil {
			usage := DesktopAIUsage(*message.Usage)
			value.Usage = &usage
		}
		if message.ProviderMetadata != nil {
			metadata := DesktopAIProviderMetadata(*message.ProviderMetadata)
			value.ProviderMetadata = &metadata
		}
		if message.StoppedAt != nil {
			value.StoppedAt = message.StoppedAt.UTC().Format(desktopAITimeLayout)
		}
		result = append(result, value)
	}
	return result
}

func fromAichatUITasks(tasks []aichatui.TaskView) []DesktopAITaskView {
	result := make([]DesktopAITaskView, 0, len(tasks))
	for _, task := range tasks {
		result = append(result, DesktopAITaskView{
			ID: task.ID, AssistantMessageID: task.AssistantMessageID, ToolCallID: task.ToolCallID,
			ToolName: task.ToolName, ToolDisplayName: task.ToolDisplayName, Summary: task.Summary,
			Status: DesktopAITaskStatus(task.Status), Dangerous: task.Dangerous,
			RequiresConfirmation: task.RequiresConfirmation, Arguments: task.Arguments,
			Result: task.Result, Error: task.Error, File: task.File, Artifact: task.Artifact,
			CommandOutput: task.CommandOutput,
			CreatedAt:     task.CreatedAt.UTC().Format(desktopAITimeLayout),
			UpdatedAt:     task.UpdatedAt.UTC().Format(desktopAITimeLayout),
		})
	}
	return result
}
