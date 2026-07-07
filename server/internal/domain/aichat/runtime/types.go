package runtime

import (
	"time"

	"github.com/easyssh/shared/aichatui"
)

type SessionStatus string

const (
	SessionStatusIdle                SessionStatus = "idle"
	SessionStatusRunning             SessionStatus = "running"
	SessionStatusWaitingConfirmation SessionStatus = "waiting_confirmation"
	SessionStatusClosed              SessionStatus = "closed"
)

type TaskStatus = aichatui.TaskStatus

const (
	TaskStatusQueued         = aichatui.TaskStatusQueued
	TaskStatusWaitingConfirm = aichatui.TaskStatusWaitingConfirm
	TaskStatusRunning        = aichatui.TaskStatusRunning
	TaskStatusSucceeded      = aichatui.TaskStatusSucceeded
	TaskStatusFailed         = aichatui.TaskStatusFailed
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
	EventAssistantDelta        EventType = "assistant.delta"
	EventAssistantCompleted    EventType = "assistant.completed"
	EventTaskCreated           EventType = "task.created"
	EventTaskUpdated           EventType = "task.updated"
	EventConfirmationRequested EventType = "confirmation.requested"
	EventConfirmationResolved  EventType = "confirmation.resolved"
	EventError                 EventType = "error"
	EventSessionCompleted      EventType = "session.completed"
)

type TransportType string

const (
	TransportAISDKUI TransportType = "ai_sdk_ui"
)

type ToolView struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name,omitempty"`
	Description string `json:"description"`
	Dangerous   bool   `json:"dangerous"`
}

type MessageView = aichatui.MessageView

type TaskView = aichatui.TaskView

type AssistantEventData struct {
	MessageID string `json:"message_id"`
	Delta     string `json:"delta,omitempty"`
	Content   string `json:"content,omitempty"`
}

type ConfirmationView struct {
	TaskID    string    `json:"task_id"`
	Status    string    `json:"status"`
	Decision  string    `json:"decision,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type ErrorView struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type UIMessage = aichatui.UIMessage

type SessionListItem struct {
	ID             string        `json:"id"`
	Model          string        `json:"model"`
	PermissionMode string        `json:"permission_mode"`
	Status         SessionStatus `json:"status"`
	Title          string        `json:"title"`
	CustomTitle    bool          `json:"custom_title"`
	MessageCount   int           `json:"message_count"`
	TaskCount      int           `json:"task_count"`
	CreatedAt      time.Time     `json:"created_at"`
	UpdatedAt      time.Time     `json:"updated_at"`
}

type SessionScope struct {
	Kind              string `json:"kind,omitempty"`
	TerminalSessionID string `json:"terminal_session_id,omitempty"`
	ServerID          string `json:"server_id,omitempty"`
	ServerName        string `json:"server_name,omitempty"`
	Host              string `json:"host,omitempty"`
	Port              int    `json:"port,omitempty"`
	Username          string `json:"username,omitempty"`
}

type SessionView struct {
	ID               string        `json:"id"`
	Model            string        `json:"model"`
	PermissionMode   string        `json:"permission_mode"`
	Scope            SessionScope  `json:"scope,omitempty"`
	Status           SessionStatus `json:"status"`
	CreatedAt        time.Time     `json:"created_at"`
	UpdatedAt        time.Time     `json:"updated_at"`
	Messages         []MessageView `json:"messages"`
	Tasks            []TaskView    `json:"tasks"`
	UIMessages       []UIMessage   `json:"ui_messages"`
	AvailableTools   []ToolView    `json:"available_tools"`
	DefaultTransport TransportType `json:"default_transport"`
}

type Event struct {
	ID           string              `json:"id"`
	Type         EventType           `json:"type"`
	SessionID    string              `json:"session_id"`
	CreatedAt    time.Time           `json:"created_at"`
	Session      *SessionView        `json:"session,omitempty"`
	Assistant    *AssistantEventData `json:"assistant,omitempty"`
	Task         *TaskView           `json:"task,omitempty"`
	UIMessage    *UIMessage          `json:"ui_message,omitempty"`
	Confirmation *ConfirmationView   `json:"confirmation,omitempty"`
	Error        *ErrorView          `json:"error,omitempty"`
}

type CreateSessionInput struct {
	Model          string
	PermissionMode string
	Scope          SessionScope
}

type SendUserMessageInput struct {
	Content        string
	Context        string
	Model          string
	PermissionMode string
	Scope          SessionScope
}

type ConfirmTaskInput struct {
	TaskID   string
	Decision Decision
}
