package notificationconfig

import (
	"context"
	"errors"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Update locks the singleton and commits all changed channels in one write.
type Repository interface {
	Get(context.Context) (*NotificationConfig, error)
	Update(context.Context, func(*NotificationConfig) error) error
}

type repository struct{ db *gorm.DB }

func NewRepository(db *gorm.DB) Repository { return &repository{db: db} }

func (r *repository) Get(ctx context.Context) (*NotificationConfig, error) {
	var config NotificationConfig
	err := r.db.WithContext(ctx).First(&config, 1).Error
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return &config, err
	}
	config = NotificationConfig{
		ID: 1, SMTPConfig: `{"enabled":false}`, WebhookConfig: `{"enabled":false,"method":"POST"}`,
		DingTalkConfig: `{"enabled":false}`, WeComConfig: `{"enabled":false}`,
	}
	if err := r.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&config).Error; err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).First(&config, 1).Error; err != nil {
		return nil, err
	}
	return &config, nil
}

func (r *repository) Update(ctx context.Context, change func(*NotificationConfig) error) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := (&repository{db: tx}).Get(ctx); err != nil {
			return err
		}
		var config NotificationConfig
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&config, 1).Error; err != nil {
			return err
		}
		before := config
		if err := change(&config); err != nil {
			return err
		}
		fields := []string{}
		for _, field := range []struct{ name, before, after string }{
			{"smtp", before.SMTPConfig, config.SMTPConfig}, {"webhook", before.WebhookConfig, config.WebhookConfig},
			{"dingtalk", before.DingTalkConfig, config.DingTalkConfig}, {"wecom", before.WeComConfig, config.WeComConfig},
		} {
			if field.before != field.after {
				fields = append(fields, field.name)
			}
		}
		if len(fields) == 0 {
			return nil
		}
		result := tx.Model(&NotificationConfig{}).Where("id = ?", 1).Updates(map[string]any{
			"smtp_config": config.SMTPConfig, "webhook_config": config.WebhookConfig,
			"ding_talk_config": config.DingTalkConfig, "we_com_config": config.WeComConfig, "updated_at": time.Now().UTC(),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return operationrecord.RecordConfiguration(tx, access.Current(ctx).Actor(), operationrecord.ConfigurationChange{
			Action: "notification_settings_update", ResourceKind: "notification_config", ResourceID: "1",
			Name: "通知设置", Source: "manual", Fields: fields,
		})
	})
}
