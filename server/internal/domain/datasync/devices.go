package datasync

import (
	"context"
	"time"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (device Device) Public() protocol.SyncDevice {
	return protocol.SyncDevice{ID: device.ID, Name: device.Name, CreatedAt: device.CreatedAt, ExpiresAt: device.ExpiresAt,
		LastUsedAt: device.LastUsedAt, Revoked: device.Revoked, Scopes: protocol.SyncScopes{
			Credentials: device.Scopes.Credentials, AIConfig: device.Scopes.AIConfig, Sessions: device.Scopes.Sessions,
		}}
}

// Scope changes affect subsequent authenticated requests. They neither renew a
// device nor remove copies that have already been synchronized to that device.
func (s *Service) UpdateDeviceScopes(ctx context.Context, owner, id uuid.UUID, scopes syncdata.SyncScopes) (Device, error) {
	var device Device
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND owner_id=? AND revoked=? AND expires_at>?", id, owner, false, time.Now().UTC()).First(&device).Error; err != nil {
			return err
		}
		if device.Scopes == scopes {
			return nil
		}
		if err := tx.Model(&device).UpdateColumn("scopes", syncdata.JSON(scopes)).Error; err != nil {
			return err
		}
		device.Scopes = scopes
		return nil
	})
	if err != nil {
		return Device{}, err
	}
	return device, nil
}

func (s *Service) RevokeDevice(ctx context.Context, owner, id uuid.UUID) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var device Device
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND owner_id=?", id, owner).First(&device).Error; err != nil {
			return err
		}
		if device.Revoked {
			return nil
		}
		return tx.Model(&device).UpdateColumn("revoked", true).Error
	})
}
