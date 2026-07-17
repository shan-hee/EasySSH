package oauthprovider

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Client struct {
	ID                          string         `gorm:"primaryKey;size:191" json:"id"`
	Name                        string         `gorm:"not null;size:200" json:"name"`
	SecretHash                  string         `gorm:"type:text" json:"-"`
	RedirectURIs                []string       `gorm:"serializer:json;type:text" json:"redirect_uris"`
	GrantTypes                  []string       `gorm:"serializer:json;type:text" json:"grant_types"`
	ResponseTypes               []string       `gorm:"serializer:json;type:text" json:"response_types"`
	Scopes                      []string       `gorm:"serializer:json;type:text" json:"scopes"`
	Audience                    []string       `gorm:"serializer:json;type:text" json:"audience"`
	Public                      bool           `gorm:"not null;default:false" json:"public"`
	TokenEndpointAuthMethod     string         `gorm:"not null;size:50;default:'client_secret_basic'" json:"token_endpoint_auth_method"`
	RequestObjectSigningAlg     string         `gorm:"size:50" json:"request_object_signing_alg"`
	TokenEndpointAuthSigningAlg string         `gorm:"size:50" json:"token_endpoint_auth_signing_alg"`
	CreatedAt                   time.Time      `json:"created_at"`
	UpdatedAt                   time.Time      `json:"updated_at"`
	DeletedAt                   gorm.DeletedAt `gorm:"index" json:"-"`
}

func (Client) TableName() string { return "oauth_clients" }

type ClientAssertion struct {
	JTIHash   string    `gorm:"primaryKey;size:64"`
	ExpiresAt time.Time `gorm:"not null;index"`
	CreatedAt time.Time
}

func (ClientAssertion) TableName() string { return "oauth_client_assertions" }

type Grant struct {
	ID              uuid.UUID `gorm:"type:char(36);primaryKey"`
	Kind            string    `gorm:"not null;size:32;uniqueIndex:idx_oauth_grant_kind_signature,priority:1"`
	Signature       string    `gorm:"not null;size:255;uniqueIndex:idx_oauth_grant_kind_signature,priority:2"`
	RequestID       string    `gorm:"not null;size:100;index"`
	AccessSignature string    `gorm:"size:255;index"`
	RequestData     string    `gorm:"type:text;not null"`
	Active          bool      `gorm:"not null;default:true;index"`
	ExpiresAt       time.Time `gorm:"not null;index"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (Grant) TableName() string { return "oauth_grants" }

func (g *Grant) BeforeCreate(*gorm.DB) error {
	if g.ID == uuid.Nil {
		g.ID = uuid.New()
	}
	return nil
}

type SigningKey struct {
	ID                  string `gorm:"primaryKey;size:64"`
	EncryptedPrivatePEM string `gorm:"type:text;not null"`
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

func (SigningKey) TableName() string { return "oauth_signing_keys" }

type LoginChallenge struct {
	ID          uuid.UUID `gorm:"type:char(36);primaryKey"`
	TokenHash   string    `gorm:"not null;uniqueIndex;size:64"`
	UserID      uuid.UUID `gorm:"type:char(36);not null;index"`
	RequestData string    `gorm:"type:text;not null"`
	ExpiresAt   time.Time `gorm:"not null;index"`
	UsedAt      *time.Time
	CreatedAt   time.Time
}

func (LoginChallenge) TableName() string { return "oauth_login_challenges" }

func (c *LoginChallenge) BeforeCreate(*gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}
