package datasync

import (
	"github.com/easyssh/shared/syncengine"
	"gorm.io/gorm"
)

// RotateTimelines must run whenever the database stops continuing the history
// its devices have synchronized against, such as after a restore from a backup.
// The restored versions would otherwise name different edits than the ones the
// devices remember, and neither side could tell. Devices then realign: they
// compare by value, add what either side lacks and never infer a deletion.
func RotateTimelines(tx *gorm.DB) error {
	var states []State
	if err := tx.Select("owner_id", "document").Find(&states).Error; err != nil {
		return err
	}
	for _, state := range states {
		document, err := syncengine.Rotate(string(state.Document))
		if err != nil {
			return err
		}
		if err = tx.Model(&State{}).Where("owner_id = ?", state.OwnerID).UpdateColumn("document", document).Error; err != nil {
			return err
		}
	}
	var documents []VaultDocument
	if err := tx.Select("owner_id", "kind", "resource_id", "document").Find(&documents).Error; err != nil {
		return err
	}
	for _, row := range documents {
		document, err := syncengine.Rotate(string(row.Document))
		if err != nil {
			return err
		}
		if err = tx.Model(&VaultDocument{}).Where("owner_id = ? AND kind = ? AND resource_id = ?", row.OwnerID, row.Kind, row.ResourceID).UpdateColumn("document", document).Error; err != nil {
			return err
		}
	}
	return nil
}
