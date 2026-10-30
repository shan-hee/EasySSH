package server

import (
	"errors"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// DeleteConfiguration is shared by owner edits and configuration sync. The
// caller owns the transaction; credentials and their sync history disappear
// together. Reusable SSH keys and activity snapshots have their own lifecycle.
func DeleteConfiguration(tx *gorm.DB, id uuid.UUID) error {
	var row Server
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").First(&row, "id=?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrServerNotFound
		}
		return err
	}
	for _, table := range []string{"sync_vault_objects", "sync_vault_documents"} {
		if err := tx.Exec("DELETE FROM "+table+" WHERE kind=? AND resource_id=?", "credential", id.String()).Error; err != nil {
			return err
		}
	}
	result := tx.Unscoped().Delete(&Server{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrServerNotFound
	}
	return nil
}
