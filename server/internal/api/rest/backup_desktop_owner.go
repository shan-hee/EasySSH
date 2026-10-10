package rest

import (
	"fmt"

	"gorm.io/gorm"
)

// Desktop users only describe source references. Never restore their profile,
// role or login identity into the server when importing personal resources.
func bindDesktopImportOwner(backup *UnifiedBackup, ownerID string) {
	tables := make([]BackupTable, 0, len(backup.Database.Tables))
	for _, table := range backup.Database.Tables {
		if table.Name == "users" {
			continue
		}
		for _, row := range table.Rows {
			row["user_id"] = ownerID
		}
		tables = append(tables, table)
	}
	backup.Database.Tables = tables
}

// A source UUID may already belong to someone else on the destination. Even
// overwrite must not transfer that resource (or report it as this user's data).
func (h *BackupHandler) validateDesktopImportConflictOwner(db *gorm.DB, table string, key restoreConflictKey, row map[string]interface{}, ownerID string) error {
	existingOwner, err := h.getExistingRowColumnValue(db, table, key.Columns, row, "user_id")
	if err != nil {
		return err
	}
	if backupStringValue(existingOwner) != ownerID {
		return fmt.Errorf("desktop import %s record %v conflicts with a resource owned by another user", table, row["id"])
	}
	return nil
}
