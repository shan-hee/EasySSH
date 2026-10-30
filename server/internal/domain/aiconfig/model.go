package aiconfig

import (
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/secretcrypto"
	"time"
)

const ConfigID = 1

// Config is the owner's sole AI configuration in this instance. APIKey is
// encrypted at rest; only the service's internal Get result is decrypted.
type Config struct {
	ID        uint     `gorm:"primaryKey;autoIncrement:false;check:ai_config_singleton,id = 1"`
	Enabled   bool     `gorm:"not null"`
	Provider  string   `gorm:"size:20;not null"`
	Endpoint  string   `gorm:"type:text;not null"`
	APIKey    string   `gorm:"type:text;not null" json:"-"`
	Models    []string `gorm:"serializer:json;type:text;not null"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Config) TableName() string { return "ai_config" }
func APIKeyAAD() []byte          { return crypto.SecretAAD("ai_config", "1", "api_key") }
func (c Config) Input() protocol.AIConfigInput {
	key := c.APIKey
	return protocol.AIConfigInput{Enabled: c.Enabled, Provider: c.Provider, Endpoint: c.Endpoint, APIKey: &key, Models: append([]string{}, c.Models...)}
}
