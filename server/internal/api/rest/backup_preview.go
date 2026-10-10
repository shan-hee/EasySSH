package rest

import (
	"context"
	"fmt"

	"github.com/easyssh/shared/backuputil"
)

// Preview uses SELECTs only: it never allocates sequence IDs, invokes write hooks or mutates data.
// Import rechecks conflicts inside its transaction because data may change after preview.
func (h *BackupHandler) previewApplicationData(ctx context.Context, backup *UnifiedBackup, includeConfig, includeData, sensitiveConfig, sensitiveData bool, strategy RestoreConflictStrategy) (map[string]*restoreSectionSummary, error) {
	db := h.db.WithContext(ctx)
	summaries := map[string]*restoreSectionSummary{}
	owners := map[string]interface{}{}
	for _, part := range []struct {
		name                string
		section             *BackupDataSection
		selected, sensitive bool
	}{
		{"config", backup.Config, includeConfig, sensitiveConfig}, {"database", backup.Database, includeData, sensitiveData},
	} {
		if !part.selected || part.section == nil {
			continue
		}
		summary := &restoreSectionSummary{}
		summaries[part.name] = summary
		for _, table := range orderedDataRestoreTables(part.section.Tables) {
			policy, ok := backupPolicyForTable(table.Name)
			if !ok || !policy.Restorable {
				return nil, fmt.Errorf("resource cannot be imported: %s", table.Name)
			}
			if string(policy.Section) != part.name {
				return nil, fmt.Errorf("resource is in the wrong section: %s", table.Name)
			}
			if err := h.validateRestoreTable(db, &table, policy, part.sensitive); err != nil {
				return nil, err
			}
			keys, err := h.getRestoreConflictKeysForPolicy(db, table.Name, table.PrimaryKey, policy)
			if err != nil {
				return nil, err
			}
			summary.Tables++
			for _, raw := range table.Rows {
				row, err := h.normalizeRestoreRow(db, table.Name, table.Columns, raw)
				if err != nil {
					return nil, err
				}
				if err := backuputil.ValidateApplicationRow(table.Name, row); err != nil {
					return nil, err
				}
				applyRestoreUserIDMapping(row, owners)
				var conflict *restoreConflictKey
				if table.Name == "ssh_keys" {
					var count int64
					if err := db.Table(table.Name).Where("user_id=? AND fingerprint=?", row["user_id"], row["fingerprint"]).Count(&count).Error; err != nil {
						return nil, err
					}
					if count > 0 {
						conflict = &restoreConflictKey{Columns: []string{"user_id", "fingerprint"}}
					}
				} else {
					conflict, err = h.findBackupConflictKey(db, table.Name, keys, row)
					if err != nil {
						return nil, err
					}
					if conflict == nil && policy.RestoreMode == backupRestoreSingleton {
						conflict, err = h.findExistingConfigRowKey(db, table.Name, table.PrimaryKey, row)
						if err != nil {
							return nil, err
						}
					}
				}
				if conflict == nil {
					summary.Inserted++
					continue
				}
				if table.Name == "users" {
					if _, err := h.recordExistingUserIDMapping(db, table.Name, table.PrimaryKey, *conflict, row, owners); err != nil {
						return nil, err
					}
				}
				if policy.RestoreMode == backupRestoreSingleton || policy.DefaultSeeded || strategy == RestoreConflictOverwrite {
					summary.Updated++
				} else if strategy == RestoreConflictSkip {
					summary.Skipped++
				} else {
					return nil, fmt.Errorf("existing %s record conflicts; select skip or overwrite before import", table.Name)
				}
			}
		}
	}
	return summaries, nil
}
