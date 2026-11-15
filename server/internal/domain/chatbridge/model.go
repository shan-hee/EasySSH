// Package chatbridge connects private bot conversations to the existing AI runtime.
package chatbridge

import "time"

type Connection struct {
	Provider string `gorm:"not null;uniqueIndex:idx_chat_connection_app,priority:1" json:"provider"`
	AppID    string `json:"app_id,omitempty" gorm:"default:null;uniqueIndex:idx_chat_connection_app,priority:2"`
	// TokenCipher holds the platform credential: a Telegram bot token or a
	// Feishu app secret.
	Revision       int64      `gorm:"not null" json:"-"`
	ID             string     `json:"id" gorm:"primaryKey"`
	OwnerID        string     `gorm:"not null" json:"-"`
	Name           string     `gorm:"not null" json:"name"`
	TokenCipher    string     `gorm:"not null" json:"-"`
	BotID          int64      `gorm:"not null;uniqueIndex:idx_chat_connections_bot_id" json:"-"`
	BotUsername    string     `gorm:"not null" json:"bot_username"`
	ServerIDsJSON  string     `gorm:"not null" json:"-"`
	PermissionMode string     `gorm:"not null" json:"permission_mode"`
	Enabled        bool       `gorm:"not null" json:"enabled"`
	NextUpdateID   int64      `gorm:"not null" json:"-"`
	BindCodeHash   string     `gorm:"not null" json:"-"`
	BindExpiresAt  *time.Time `json:"-"`
	LastPollAt     *time.Time `json:"last_poll_at"`
	LastError      string     `gorm:"not null" json:"last_error"`
	CreatedAt      time.Time  `gorm:"not null" json:"created_at"`
	UpdatedAt      time.Time  `gorm:"not null" json:"updated_at"`
}

func (Connection) TableName() string { return "chat_connections" }

// A binding watches at most its current Agent session; older sessions remain in
// the AI assistant history and are no longer projected to the chat platform.
type Binding struct {
	ExternalUserID   string     `gorm:"not null" json:"external_user_id,omitempty"`
	ExternalChatID   string     `gorm:"not null" json:"-"`
	ID               string     `json:"id" gorm:"primaryKey"`
	ConnectionID     string     `gorm:"not null" json:"connection_id"`
	UserID           int64      `gorm:"not null" json:"user_id,string"`
	ChatID           int64      `gorm:"not null" json:"-"`
	DisplayName      string     `gorm:"not null" json:"display_name"`
	CurrentSessionID string     `gorm:"not null" json:"current_session_id"`
	MessageCount     int        `gorm:"not null" json:"-"`
	Watching         bool       `gorm:"not null" json:"-"`
	RevokedAt        *time.Time `json:"revoked_at"`
	CreatedAt        time.Time  `gorm:"not null" json:"created_at"`
}

func (Binding) TableName() string { return "chat_bindings" }

func (b Binding) chatAddress() any {
	if b.ExternalChatID != "" {
		return b.ExternalChatID
	}
	return b.ChatID
}

// ReceivedEvent is claimed before dispatch; reconnects must never replay work.
type ReceivedEvent struct {
	ID           string    `gorm:"primaryKey"`
	ConnectionID string    `gorm:"not null"`
	CreatedAt    time.Time `gorm:"not null"`
}

func (ReceivedEvent) TableName() string { return "chat_received_events" }

type Approval struct {
	ID        string    `gorm:"primaryKey"`
	BindingID string    `gorm:"not null"`
	SessionID string    `gorm:"not null;uniqueIndex:idx_chat_approvals_session_task,priority:1"`
	TaskID    string    `gorm:"not null;uniqueIndex:idx_chat_approvals_session_task,priority:2"`
	Digest    string    `gorm:"not null"`
	ExpiresAt time.Time `gorm:"not null"`
	UsedAt    *time.Time
}

func (Approval) TableName() string { return "chat_approvals" }

type ConnectionInput struct {
	Provider       string   `json:"provider"`
	AppID          string   `json:"app_id"`
	AppSecret      string   `json:"app_secret"`
	Name           string   `json:"name"`
	Token          string   `json:"token"`
	ServerIDs      []string `json:"server_ids"`
	PermissionMode string   `json:"permission_mode"`
	Enabled        bool     `json:"enabled"`
}

type ConnectionView struct {
	Connection
	ServerIDs []string `json:"server_ids"`
	Status    string   `json:"status"`
}

type Detail struct {
	Connection ConnectionView `json:"connection"`
	Bindings   []Binding      `json:"bindings"`
}

type BindCode struct {
	Command   string    `json:"command"`
	Code      string    `json:"code"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Session is an Agent session started from a binding. The session itself lives
// in the AI runtime; the binding only identifies who started it.
type Session struct {
	ID          string    `json:"id"`
	BindingID   string    `json:"binding_id"`
	DisplayName string    `json:"display_name"`
	Status      string    `json:"status"`
	Preview     string    `json:"preview"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// TranscriptMessage is one bot message as the chat app shows it.
type TranscriptMessage struct {
	ID        string    `json:"id"`
	From      string    `json:"from"`
	Text      string    `json:"text"`
	Buttons   []string  `json:"buttons"`
	CreatedAt time.Time `json:"created_at"`
}
