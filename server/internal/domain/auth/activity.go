package auth

import (
	"context"
	"slices"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func recordOwnerChange(tx *gorm.DB, action, kind string, id uuid.UUID, fields []string) error {
	return operationrecord.RecordConfiguration(tx, access.Current(tx.Statement.Context).Actor(), operationrecord.ConfigurationChange{
		Action: action, ResourceKind: kind, ResourceID: id.String(), Name: "所有者设置",
		Source: "manual", Fields: fields,
	})
}

// Preference values are compared in memory but only field names enter activity.
func ownerPreferenceValues(owner Owner) map[string]any {
	return map[string]any{
		"username": owner.Username, "email": owner.Email, "avatar": owner.Avatar, "language": owner.Language, "timezone": owner.Timezone,
		"notify_email_login": owner.NotifyEmailLogin, "notify_email_alert": owner.NotifyEmailAlert, "notify_browser": owner.NotifyBrowser,
		"notify_new_device": owner.NotifyNewDevice, "notify_new_location": owner.NotifyNewLocation, "notify_suspicious": owner.NotifySuspicious,
		"notify_task_in_app": owner.NotifyTaskInApp, "notify_task_success": owner.NotifyTaskSuccess, "notify_task_failure": owner.NotifyTaskFailure,
		"notify_task_partial": owner.NotifyTaskPartial, "notify_task_external": owner.NotifyTaskExternal,
		"monitor_data_source": owner.MonitorDataSource, "nezha_api_endpoint": owner.NezhaAPIEndpoint, "nezha_api_token": owner.NezhaAPIToken,
		"komari_api_endpoint": owner.KomariAPIEndpoint, "komari_api_token": owner.KomariAPIToken,
	}
}

func (s *Service) updateOwnerPreferences(ctx context.Context, id uuid.UUID, change func(Owner) (map[string]any, error)) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var owner Owner
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&owner, "id=?", id).Error; err != nil {
			return err
		}
		values, err := change(owner)
		if err != nil {
			return err
		}
		before := ownerPreferenceValues(owner)
		updates := map[string]any{}
		fields := []string{}
		for field, value := range values {
			previous, ok := before[field]
			if !ok {
				return ErrInvalidInput
			}
			if previous == value {
				continue
			}
			if (field == "nezha_api_token" || field == "komari_api_token") && previous != "" && value != "" {
				oldPlain, err := s.decryptOwnerSecret(id, field, previous.(string))
				if err != nil {
					return err
				}
				newPlain, err := s.decryptOwnerSecret(id, field, value.(string))
				if err != nil {
					return err
				}
				if oldPlain == newPlain {
					continue
				}
			}
			updates[field] = value
			fields = append(fields, field)
		}
		if len(fields) == 0 {
			return nil
		}
		if err := tx.Model(&owner).Updates(updates).Error; err != nil {
			return err
		}
		slices.Sort(fields)
		return recordOwnerChange(tx, "profile_update", "owner", id, fields)
	})
}
