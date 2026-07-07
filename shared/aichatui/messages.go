package aichatui

import (
	"sort"
	"strings"
	"time"
)

type TaskStatus string

const (
	TaskStatusQueued         TaskStatus = "queued"
	TaskStatusWaitingConfirm TaskStatus = "waiting_confirm"
	TaskStatusRunning        TaskStatus = "running"
	TaskStatusSucceeded      TaskStatus = "succeeded"
	TaskStatusFailed         TaskStatus = "failed"
	TaskStatusCancelled      TaskStatus = "cancelled"
)

type MessageView struct {
	ID        string    `json:"id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

type TaskView struct {
	ID                   string                 `json:"id"`
	AssistantMessageID   string                 `json:"assistant_message_id,omitempty"`
	ToolCallID           string                 `json:"tool_call_id"`
	ToolName             string                 `json:"tool_name"`
	ToolDisplayName      string                 `json:"tool_display_name,omitempty"`
	Summary              string                 `json:"summary,omitempty"`
	Status               TaskStatus             `json:"status"`
	Dangerous            bool                   `json:"dangerous"`
	RequiresConfirmation bool                   `json:"requires_confirmation"`
	Arguments            map[string]interface{} `json:"arguments,omitempty"`
	Result               string                 `json:"result,omitempty"`
	Error                string                 `json:"error,omitempty"`
	CreatedAt            time.Time              `json:"created_at"`
	UpdatedAt            time.Time              `json:"updated_at"`
}

type UIMessage struct {
	ID       string                   `json:"id"`
	Role     string                   `json:"role"`
	Metadata map[string]interface{}   `json:"metadata,omitempty"`
	Parts    []map[string]interface{} `json:"parts"`
}

func BuildMessages(messages []MessageView, tasks []TaskView) []UIMessage {
	items := make([]timelineItem, 0, len(messages)+len(tasks))
	sequence := 0
	for _, message := range messages {
		items = append(items, timelineItem{
			createdAt:  message.CreatedAt,
			sequence:   sequence,
			message:    message,
			hasMessage: true,
		})
		sequence++
	}
	for _, task := range tasks {
		items = append(items, timelineItem{
			createdAt: task.CreatedAt,
			sequence:  sequence,
			task:      task,
			hasTask:   true,
		})
		sequence++
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].createdAt.Equal(items[j].createdAt) {
			return items[i].sequence < items[j].sequence
		}
		return items[i].createdAt.Before(items[j].createdAt)
	})

	uiMessages := make([]UIMessage, 0, len(items))
	currentAssistantIndex := -1
	currentStepSource := ""

	for _, item := range items {
		if item.hasMessage {
			message := item.message
			switch message.Role {
			case "user", "system":
				if uiMessage, ok := Message(message, false); ok {
					uiMessages = append(uiMessages, uiMessage)
				}
				currentAssistantIndex = -1
				currentStepSource = ""
			case "assistant":
				parts := AssistantParts(message, false)
				if len(parts) == 0 {
					continue
				}
				currentAssistantIndex = ensureAssistantMessage(&uiMessages, currentAssistantIndex, message.ID, message.CreatedAt)
				appendStepStartIfNeeded(&uiMessages[currentAssistantIndex], &currentStepSource, message.ID)
				uiMessages[currentAssistantIndex].Parts = append(uiMessages[currentAssistantIndex].Parts, parts...)
			}
			continue
		}

		if item.hasTask {
			task := item.task
			messageID := firstNonEmpty(task.AssistantMessageID, "task:"+task.ID)
			currentAssistantIndex = ensureAssistantMessage(&uiMessages, currentAssistantIndex, messageID, task.CreatedAt)

			stepSource := task.AssistantMessageID
			if stepSource == "" {
				stepSource = currentStepSource
			}
			if stepSource == "" {
				stepSource = "task:" + task.ID
			}
			appendStepStartIfNeeded(&uiMessages[currentAssistantIndex], &currentStepSource, stepSource)
			uiMessages[currentAssistantIndex].Parts = append(uiMessages[currentAssistantIndex].Parts, TaskPart(task))
		}
	}

	return uiMessages
}

type timelineItem struct {
	createdAt  time.Time
	sequence   int
	message    MessageView
	hasMessage bool
	task       TaskView
	hasTask    bool
}

func Message(message MessageView, streaming bool) (UIMessage, bool) {
	switch message.Role {
	case "user", "system":
		return UIMessage{
			ID:   message.ID,
			Role: message.Role,
			Metadata: map[string]interface{}{
				"source":       "message",
				"createdAt":    message.CreatedAt,
				"originalRole": message.Role,
			},
			Parts: []map[string]interface{}{
				{
					"type":  "text",
					"text":  message.Content,
					"state": "done",
				},
			},
		}, true
	case "assistant":
		return AssistantMessage(message, streaming), true
	default:
		return UIMessage{}, false
	}
}

func AssistantMessage(message MessageView, streaming bool) UIMessage {
	return UIMessage{
		ID:   message.ID,
		Role: "assistant",
		Metadata: map[string]interface{}{
			"source":       "message",
			"createdAt":    message.CreatedAt,
			"pending":      streaming,
			"originalRole": message.Role,
		},
		Parts: AssistantParts(message, streaming),
	}
}

func AssistantParts(message MessageView, streaming bool) []map[string]interface{} {
	toolStatus, withoutToolStatus := ExtractLastTaggedContent(message.Content, "tool-status")
	reasoning, text := ExtractLastTaggedContent(withoutToolStatus, "think")
	state := "done"
	if streaming {
		state = "streaming"
	}

	parts := make([]map[string]interface{}, 0, 3)
	if strings.TrimSpace(toolStatus) != "" {
		parts = append(parts, map[string]interface{}{
			"type": "data-tool-status",
			"id":   message.ID + ":tool-status",
			"data": map[string]interface{}{
				"text": strings.TrimSpace(toolStatus),
			},
		})
	}
	if strings.TrimSpace(reasoning) != "" {
		parts = append(parts, map[string]interface{}{
			"type":  "reasoning",
			"text":  strings.TrimSpace(reasoning),
			"state": state,
		})
	}
	if strings.TrimSpace(text) != "" {
		parts = append(parts, map[string]interface{}{
			"type":  "text",
			"text":  strings.TrimSpace(text),
			"state": state,
		})
	}

	return parts
}

func TaskMessage(task TaskView) UIMessage {
	return UIMessage{
		ID:   "task:" + task.ID,
		Role: "assistant",
		Metadata: map[string]interface{}{
			"source":               "task",
			"createdAt":            task.CreatedAt,
			"updatedAt":            task.UpdatedAt,
			"taskId":               task.ID,
			"taskStatus":           task.Status,
			"dangerous":            task.Dangerous,
			"requiresConfirmation": task.RequiresConfirmation,
			"displayName":          task.ToolDisplayName,
			"summary":              task.Summary,
		},
		Parts: []map[string]interface{}{TaskPart(task)},
	}
}

func TaskMessagePtr(task TaskView) *UIMessage {
	uiMessage := TaskMessage(task)
	return &uiMessage
}

func TaskPart(task TaskView) map[string]interface{} {
	part := map[string]interface{}{
		"type":             "dynamic-tool",
		"toolName":         task.ToolName,
		"toolCallId":       firstNonEmpty(task.ToolCallID, task.ID),
		"title":            firstNonEmpty(task.ToolDisplayName, task.ToolName),
		"providerExecuted": false,
		"input":            task.Arguments,
		"toolMetadata": map[string]interface{}{
			"taskId":               task.ID,
			"assistantMessageId":   task.AssistantMessageID,
			"taskStatus":           task.Status,
			"dangerous":            task.Dangerous,
			"requiresConfirmation": task.RequiresConfirmation,
			"displayName":          task.ToolDisplayName,
			"summary":              task.Summary,
		},
	}

	switch task.Status {
	case TaskStatusWaitingConfirm:
		part["state"] = "approval-requested"
		part["approval"] = map[string]interface{}{
			"id": task.ID,
		}
	case TaskStatusSucceeded:
		part["state"] = "output-available"
		part["output"] = task.Result
	case TaskStatusFailed:
		part["state"] = "output-error"
		part["errorText"] = firstNonEmpty(task.Error, "Tool execution failed")
	case TaskStatusCancelled:
		part["state"] = "output-denied"
		part["approval"] = map[string]interface{}{
			"id":       task.ID,
			"approved": false,
			"reason":   firstNonEmpty(task.Error, task.Result),
		}
	default:
		part["state"] = "input-available"
	}

	if task.Arguments == nil {
		part["input"] = map[string]interface{}{}
	}

	return part
}

func ExtractLastTaggedContent(content string, tagName string) (string, string) {
	openTag := "<" + tagName + ">"
	closeTag := "</" + tagName + ">"
	lower := strings.ToLower(content)
	lowerOpen := strings.ToLower(openTag)
	lowerClose := strings.ToLower(closeTag)

	start := strings.LastIndex(lower, lowerOpen)
	if start < 0 {
		return "", content
	}

	valueStart := start + len(openTag)
	endRelative := strings.Index(lower[valueStart:], lowerClose)
	if endRelative < 0 {
		return strings.TrimSpace(content[valueStart:]), strings.TrimSpace(content[:start])
	}

	end := valueStart + endRelative
	value := content[valueStart:end]
	remaining := strings.TrimSpace(content[:start] + content[end+len(closeTag):])
	return strings.TrimSpace(value), remaining
}

func CreatedAt(message UIMessage) time.Time {
	if message.Metadata == nil {
		return time.Time{}
	}
	value, ok := message.Metadata["createdAt"]
	if !ok {
		return time.Time{}
	}
	switch typed := value.(type) {
	case time.Time:
		return typed
	case string:
		parsed, err := time.Parse(time.RFC3339Nano, typed)
		if err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func ensureAssistantMessage(messages *[]UIMessage, currentIndex int, messageID string, createdAt time.Time) int {
	if currentIndex >= 0 {
		return currentIndex
	}
	if strings.TrimSpace(messageID) == "" {
		messageID = "assistant"
	}
	*messages = append(*messages, UIMessage{
		ID:   messageID,
		Role: "assistant",
		Metadata: map[string]interface{}{
			"source":       "message",
			"createdAt":    createdAt,
			"originalRole": "assistant",
		},
		Parts: []map[string]interface{}{},
	})
	return len(*messages) - 1
}

func appendStepStartIfNeeded(message *UIMessage, currentStepSource *string, sourceID string) {
	if strings.TrimSpace(sourceID) == "" {
		sourceID = "assistant"
	}
	if *currentStepSource == sourceID {
		return
	}
	message.Parts = append(message.Parts, map[string]interface{}{"type": "step-start"})
	*currentStepSource = sourceID
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
