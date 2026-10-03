package rest

import (
	"errors"
	"fmt"

	"github.com/easyssh/server/internal/domain/sshkey"
	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"
)

type restoredSSHKey struct {
	ID    uint
	Owner string
}

// IDs belong to a database, fingerprints identify keys. Resolve keys before
// restoring connection references, including when a conflict is skipped.
func (h *BackupHandler) restoreSSHKeyTable(tx *gorm.DB, table BackupTable, policy backupTablePolicy, strategy RestoreConflictStrategy, users map[string]interface{}, keys map[string]restoredSSHKey, summary *restoreSectionSummary, sensitive bool) error {
	if err := h.validateRestoreTable(tx, &table, policy, sensitive); err != nil {
		return err
	}
	summary.Tables++
	for _, raw := range table.Rows {
		row, err := h.normalizeRestoreRow(tx, table.Name, table.Columns, raw)
		if err != nil {
			return err
		}
		oldID := restoreMappingKey(row["id"])
		if row["id"] == nil || oldID == "0" {
			return errors.New("invalid SSH key ID in backup")
		}
		if _, exists := keys[oldID]; exists {
			return errors.New("duplicate SSH key ID in backup")
		}
		applyRestoreUserIDMapping(row, users)
		owner := backupStringValue(row["user_id"])
		publicKey, _, _, _, err := ssh.ParseAuthorizedKey([]byte(backupStringValue(row["public_key"])))
		if err != nil {
			return fmt.Errorf("invalid backup SSH public key: %w", err)
		}
		fingerprint := ssh.FingerprintSHA256(publicKey)
		if fingerprint != backupStringValue(row["fingerprint"]) {
			return errors.New("backup SSH key fingerprint does not match its public key")
		}
		var existing sshkey.SSHKey
		err = tx.Where("user_id = ? AND fingerprint = ?", owner, fingerprint).First(&existing).Error
		exists := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if exists && strategy == RestoreConflictError {
			return fmt.Errorf("SSH key already exists: %s", fingerprint)
		}
		if exists && strategy == RestoreConflictSkip {
			keys[oldID] = restoredSSHKey{existing.ID, owner}
			summary.Skipped++
			continue
		}
		delete(row, "id")
		if !exists {
			if err := h.prepareRestoreInsertRow("ssh_keys", row); err != nil {
				return err
			}
		}
		if sensitive {
			if err := h.prepareSensitiveRestoreRow("ssh_keys", row); err != nil {
				return err
			}
		}
		if exists {
			if _, hasMaterial := row["private_key"]; !hasMaterial {
				delete(row, "passphrase_required")
			}
			if err := tx.Table("ssh_keys").Where("id = ?", existing.ID).Updates(row).Error; err != nil {
				return err
			}
			summary.Updated++
		} else {
			if err := tx.Table("ssh_keys").Create(row).Error; err != nil {
				return err
			}
			if err := tx.Where("user_id = ? AND fingerprint = ?", owner, fingerprint).First(&existing).Error; err != nil {
				return err
			}
			summary.Inserted++
		}
		keys[oldID] = restoredSSHKey{existing.ID, owner}
	}
	return nil
}

func remapBackupServerKeys(table BackupTable, users map[string]interface{}, keys map[string]restoredSSHKey) error {
	for _, row := range table.Rows {
		if row["ssh_key_id"] == nil {
			continue
		}
		key, ok := keys[restoreMappingKey(row["ssh_key_id"])]
		if !ok {
			return errors.New("connection references an SSH key missing from backup")
		}
		owner := row["user_id"]
		if mapped, ok := users[restoreMappingKey(owner)]; ok {
			owner = mapped
		}
		if backupStringValue(owner) != key.Owner {
			return errors.New("connection and SSH key must belong to the same user")
		}
		row["ssh_key_id"] = key.ID
	}
	return nil
}
