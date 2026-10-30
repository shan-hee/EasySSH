package grant

import (
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/google/uuid"
)

const ProtocolVersion = int(protocol.AccessVersion)

type Grant struct {
	ID              uuid.UUID  `gorm:"type:char(36);primaryKey" json:"id"`
	PublicID        string     `gorm:"size:64;not null;uniqueIndex" json:"public_id"`
	SecretHash      string     `gorm:"size:64;not null" json:"-"`
	Name            string     `gorm:"size:100;not null" json:"name"`
	Version         int64      `gorm:"not null" json:"version"`
	DefaultContent  string     `gorm:"size:32;not null" json:"default_content"`
	ExpiresAt       *time.Time `json:"expires_at"`
	RevokedAt       *time.Time `json:"revoked_at"`
	MaxSessions     int        `gorm:"not null" json:"max_sessions"`
	MaxConnections  int        `gorm:"not null" json:"max_connections"`
	UploadLimit     *int64     `json:"upload_limit"`
	DownloadLimit   *int64     `json:"download_limit"`
	AIRequestLimit  *int64     `json:"ai_request_limit"`
	UploadedBytes   int64      `gorm:"not null" json:"uploaded_bytes"`
	DownloadedBytes int64      `gorm:"not null" json:"downloaded_bytes"`
	AIRequests      int64      `gorm:"not null" json:"ai_requests"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (Grant) TableName() string { return "grants" }

type Resource struct {
	GrantID                    uuid.UUID         `gorm:"type:char(36);primaryKey" json:"-"`
	ServerID                   uuid.UUID         `gorm:"type:char(36);primaryKey" json:"server_id"`
	Actions                    []protocol.Action `gorm:"serializer:json;type:text;not null" json:"actions"`
	ApprovedConnectionRevision int64             `gorm:"not null" json:"approved_connection_revision"`
	AllowInteractive           bool              `gorm:"not null" json:"allow_interactive"`
}

func (Resource) TableName() string { return "grant_resources" }

type ScriptScope struct {
	GrantID    uuid.UUID                              `gorm:"type:char(36);primaryKey" json:"-"`
	ServerID   uuid.UUID                              `gorm:"type:char(36);primaryKey" json:"server_id"`
	ScriptID   uuid.UUID                              `gorm:"type:char(36);primaryKey" json:"script_id"`
	Version    string                                 `gorm:"size:64;not null" json:"version"`
	Parameters map[string]protocol.GrantParameterRule `gorm:"serializer:json;type:text;not null" json:"parameters"`
}

func (ScriptScope) TableName() string { return "grant_script_scopes" }

type BrowserContainer struct {
	ID        uuid.UUID `gorm:"type:char(36);primaryKey"`
	TokenHash string    `gorm:"size:64;not null;uniqueIndex"`
	CSRFHash  string    `gorm:"size:64;not null"`
	CreatedAt time.Time
	ExpiresAt time.Time
}

func (BrowserContainer) TableName() string { return "access_containers" }

type Session struct {
	ID           uuid.UUID  `gorm:"type:char(36);primaryKey" json:"id"`
	GrantID      uuid.UUID  `gorm:"type:char(36);not null;index" json:"grant_id"`
	GrantVersion int64      `gorm:"not null" json:"grant_version"`
	ClientKind   string     `gorm:"size:16;not null" json:"client_kind"`
	TokenHash    *string    `gorm:"size:64;uniqueIndex" json:"-"`
	ContainerID  *uuid.UUID `gorm:"type:char(36);index" json:"-"`
	CreatedAt    time.Time  `json:"created_at"`
	LastSeenAt   time.Time  `json:"last_seen_at"`
	ExpiresAt    time.Time  `json:"expires_at"`
	RevokedAt    *time.Time `json:"revoked_at"`
}

func (Session) TableName() string { return "access_sessions" }

func (g Grant) Public() protocol.Grant {
	return protocol.Grant{
		ID:              g.ID,
		PublicID:        g.PublicID,
		Name:            g.Name,
		Version:         g.Version,
		DefaultContent:  g.DefaultContent,
		ExpiresAt:       g.ExpiresAt,
		RevokedAt:       g.RevokedAt,
		MaxSessions:     g.MaxSessions,
		MaxConnections:  g.MaxConnections,
		UploadLimit:     g.UploadLimit,
		DownloadLimit:   g.DownloadLimit,
		AIRequestLimit:  g.AIRequestLimit,
		UploadedBytes:   g.UploadedBytes,
		DownloadedBytes: g.DownloadedBytes,
		AIRequests:      g.AIRequests,
		CreatedAt:       g.CreatedAt,
		UpdatedAt:       g.UpdatedAt,
	}
}
