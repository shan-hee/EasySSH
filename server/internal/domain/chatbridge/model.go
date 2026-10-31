// Package chatbridge connects private bot conversations to the existing AI runtime.
package chatbridge

import "time"

type Connection struct {
	Provider string `json:"provider"`
	AppID    string `json:"app_id,omitempty" gorm:"default:null"`
	// TokenCipher holds the platform credential: a Telegram bot token or a
	// Feishu app secret.
	Revision       int64      `json:"-"`
	ID             string     `json:"id" gorm:"primaryKey"`
	OwnerID        string     `json:"-"`
	Name           string     `json:"name"`
	TokenCipher    string     `json:"-"`
	BotID          int64      `json:"-"`
	BotUsername    string     `json:"bot_username"`
	ServerIDsJSON  string     `json:"-"`
	PermissionMode string     `json:"permission_mode"`
	Enabled        bool       `json:"enabled"`
	NextUpdateID   int64      `json:"-"`
	BindCodeHash   string     `json:"-"`
	BindExpiresAt  *time.Time `json:"-"`
	LastPollAt     *time.Time `json:"last_poll_at"`
	LastError      string     `json:"last_error"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

func (Connection) TableName() string { return "chat_connections" }

// A binding watches at most its current Agent session; older sessions remain in
// the AI assistant history and are no longer projected to the chat platform.
type Binding struct {
	ExternalUserID   string     `json:"external_user_id,omitempty"`
	ExternalChatID   string     `json:"-"`
	ID               string     `json:"id" gorm:"primaryKey"`
	ConnectionID     string     `json:"connection_id"`
	UserID           int64      `json:"user_id,string"`
	ChatID           int64      `json:"-"`
	DisplayName      string     `json:"display_name"`
	CurrentSessionID string     `json:"current_session_id"`
	MessageCount     int        `json:"-"`
	Watching         bool       `json:"-"`
	RevokedAt        *time.Time `json:"revoked_at"`
	CreatedAt        time.Time  `json:"created_at"`
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
	ID           string `gorm:"primaryKey"`
	ConnectionID string
	CreatedAt    time.Time
}

func (ReceivedEvent) TableName() string { return "chat_received_events" }

type Approval struct {
	ID        string `gorm:"primaryKey"`
	BindingID string
	SessionID string
	TaskID    string
	Digest    string
	ExpiresAt time.Time
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
