package aiconfig

import (
	"context"
	"errors"
	"slices"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/secretcrypto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository interface {
	Get(context.Context) (*Config, error)
	Save(context.Context, *Config) error
}
type repository struct {
	db        *gorm.DB
	encryptor *crypto.Encryptor
}

func NewRepository(db *gorm.DB, encryptor *crypto.Encryptor) Repository {
	return &repository{db: db, encryptor: encryptor}
}
func (r *repository) Get(ctx context.Context) (*Config, error) {
	var config Config
	err := r.db.WithContext(ctx).First(&config, ConfigID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &Config{ID: ConfigID, Provider: "openai", Models: []string{}}, nil
	}
	return &config, err
}
func (r *repository) Save(ctx context.Context, config *Config) error {
	config.ID = ConfigID
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var before Config
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&before, ConfigID).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		fields := []string{}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fields = append(fields, "created")
		} else {
			keyChanged := before.APIKey != config.APIKey
			if keyChanged {
				if r.encryptor == nil {
					return errors.New("AI secret encryption is unavailable")
				}
				previous, err := r.encryptor.DecryptSecret(before.APIKey, APIKeyAAD())
				if err != nil {
					return err
				}
				next, err := r.encryptor.DecryptSecret(config.APIKey, APIKeyAAD())
				if err != nil {
					return err
				}
				keyChanged = previous != next
			}
			for _, field := range []struct {
				name    string
				changed bool
			}{
				{"enabled", before.Enabled != config.Enabled}, {"provider", before.Provider != config.Provider},
				{"endpoint", before.Endpoint != config.Endpoint}, {"api_key", keyChanged}, {"models", !slices.Equal(before.Models, config.Models)},
			} {
				if field.changed {
					fields = append(fields, field.name)
				}
			}
		}
		if len(fields) == 0 {
			return nil
		}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoUpdates: clause.AssignmentColumns([]string{"enabled", "provider", "endpoint", "api_key", "models", "updated_at"})}).Create(config).Error; err != nil {
			return err
		}
		actor := access.Current(ctx).Actor()
		source := "manual"
		if actor.Kind == protocol.Device {
			source = "automation"
		}
		return operationrecord.RecordConfiguration(tx, actor, operationrecord.ConfigurationChange{
			Action: "ai_config_update", ResourceKind: "ai_config", ResourceID: "1", Name: "AI 配置", Source: source, Fields: fields,
		})
	})
}
