// Package chatbridge connects private Telegram conversations to the existing AI runtime.
package chatbridge

import "time"

type Connection struct {
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
// the AI assistant history and are no longer projected to Telegram.
type Binding struct {
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
	Code      string    `json:"code"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}
