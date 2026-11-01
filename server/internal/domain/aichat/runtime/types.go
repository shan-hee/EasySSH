package runtime

import (
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/shared/aichatui"
)

type SessionStatus = protocol.AISessionStatus

const (
	SessionStatusIdle                = protocol.AISessionStatusIdle
	SessionStatusRunning             = protocol.AISessionStatusRunning
	SessionStatusWaitingConfirmation = protocol.AISessionStatusWaitingConfirmation
	SessionStatusClosed              = protocol.AISessionStatusClosed
)

type TaskStatus = aichatui.TaskStatus

const (
	TaskStatusQueued         = aichatui.TaskStatusQueued
	TaskStatusWaitingConfirm = aichatui.TaskStatusWaitingConfirm
	TaskStatusRunning        = aichatui.TaskStatusRunning
	TaskStatusSucceeded      = aichatui.TaskStatusSucceeded
	TaskStatusFailed         = aichatui.TaskStatusFailed
	TaskStatusUnknown        = aichatui.TaskStatusUnknown
	TaskStatusCancelled      = aichatui.TaskStatusCancelled
)

type Decision string

const (
	DecisionConfirm Decision = "confirm"
	DecisionReject  Decision = "reject"
)

type EventType string

const (
	EventSessionStarted        EventType = "session.started"
	EventHistoryChanged        EventType = "history.changed"
	EventSessionUpdated        EventType = "session.updated"
	EventAssistantDelta        EventType = "assistant.delta"
	EventAssistantCompleted    EventType = "assistant.completed"
	EventProviderToolStarted   EventType = "provider.tool.started"
	EventProviderToolDelta     EventType = "provider.tool.arguments.delta"
	EventProviderToolCompleted EventType = "provider.tool.completed"
	EventProviderUsageUpdated  EventType = "provider.usage.updated"
	EventProviderCompleted     EventType = "provider.response.completed"
	EventTaskCreated           EventType = "task.created"
	EventTaskUpdated           EventType = "task.updated"
	EventConfirmationRequested EventType = "confirmation.requested"
	EventConfirmationResolved  EventType = "confirmation.resolved"
	EventError                 EventType = "error"
	EventSessionCompleted      EventType = "session.completed"
)

type TransportType = protocol.AITransportType

const (
	TransportAISDKUI = protocol.AISdkUI
)

type MessageView = aichatui.MessageView

type TaskView = aichatui.TaskView

type AssistantEventData struct {
	MessageID string                     `json:"message_id"`
	Delta     string                     `json:"delta,omitempty"`
	Content   string                     `json:"content,omitempty"`
	Reasoning string                     `json:"reasoning,omitempty"`
	Usage     *provider.Usage            `json:"usage,omitempty"`
	Metadata  *provider.ProviderMetadata `json:"provider_metadata,omitempty"`
}

type ConfirmationView struct {
	TaskID    string    `json:"task_id"`
	Status    string    `json:"status"`
	Decision  string    `json:"decision,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type ErrorView struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Provider   string `json:"provider,omitempty"`
	StatusCode int    `json:"status_code,omitempty"`
	RequestID  string `json:"request_id,omitempty"`
	Retryable  bool   `json:"retryable"`
}

type UIMessage = aichatui.UIMessage
type Attachment = provider.Attachment

type SessionListItem = protocol.AISessionListItem

type SessionScope = protocol.AISessionScope

// SessionView is an internal runtime snapshot. HTTP exposes AISessionOverview.
type SessionView struct {
	Actor            protocol.Actor         `json:"actor"`
	Title            string                 `json:"title,omitempty"`
	ID               string                 `json:"id"`
	Model            string                 `json:"model"`
	PermissionMode   string                 `json:"permission_mode"`
	Scope            SessionScope           `json:"scope,omitempty"`
	Status           SessionStatus          `json:"status"`
	CreatedAt        time.Time              `json:"created_at"`
	UpdatedAt        time.Time              `json:"updated_at"`
	Messages         []aichatui.MessageView `json:"messages"`
	Tasks            []aichatui.TaskView    `json:"tasks"`
	UIMessages       []aichatui.UIMessage   `json:"ui_messages"`
	DefaultTransport TransportType          `json:"default_transport"`
}

type Event struct {
	History      *protocol.AIHistoryChange `json:"history,omitempty"`
	ID           string                    `json:"id"`
	Type         EventType                 `json:"type"`
	SessionID    string                    `json:"session_id"`
	CreatedAt    time.Time                 `json:"created_at"`
	Session      *SessionView              `json:"session,omitempty"`
	Assistant    *AssistantEventData       `json:"assistant,omitempty"`
	Task         *TaskView                 `json:"task,omitempty"`
	UIMessage    *UIMessage                `json:"ui_message,omitempty"`
	Confirmation *ConfirmationView         `json:"confirmation,omitempty"`
	Error        *ErrorView                `json:"error,omitempty"`
	Provider     *provider.Event           `json:"provider_event,omitempty"`
}

type CreateSessionInput struct {
	Model          string
	PermissionMode string
	Scope          SessionScope
}

type SendUserMessageInput struct {
	ReasoningEffort  string
	ServerReferences []aichatui.ServerReference
	MessageID        string
	Content          string
	Attachments      []provider.Attachment
	Context          string
	Model            string
	PermissionMode   string
	Scope            SessionScope
}

type UpdateMessageInput struct {
	ServerReferences []aichatui.ServerReference
	Content          string
}

type ConfirmTaskInput struct {
	TaskID   string
	Decision Decision
	Reason   string
}
