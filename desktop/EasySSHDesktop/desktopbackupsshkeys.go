package main

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyssh/shared/backuputil"
	"golang.org/x/crypto/ssh"
)

func exportDesktopSSHKeys(db desktopBackupQuery, sensitive bool) (desktopBackupTable, error) {
	table := desktopBackupTable{Name: "ssh_keys", PrimaryKey: []string{"id"}, Rows: []map[string]any{}}
	table.Columns = []string{"id", "user_id", "name", "public_key", "fingerprint", "algorithm", "key_size", "passphrase_required", "created_at", "updated_at"}
	if sensitive {
		table.Columns = []string{"id", "user_id", "fingerprint", "private_key"}
	}
	rows, err := db.Query(`SELECT id, name, public_key, fingerprint, algorithm, key_size, passphrase_required, private_key, created_at, updated_at FROM desktop_ssh_keys ORDER BY id`)
	if err != nil {
		return table, err
	}
	defer rows.Close()
	for rows.Next() {
		var key DesktopSSHKey
		var material, updatedAt string
		if err := rows.Scan(&key.ID, &key.Name, &key.PublicKey, &key.Fingerprint, &key.Algorithm, &key.KeySize, &key.PassphraseRequired, &material, &key.CreatedAt, &updatedAt); err != nil {
			return table, err
		}
		row := map[string]any{"id": key.ID, "user_id": desktopBackupUserID, "fingerprint": key.Fingerprint}
		if sensitive {
			material, err = decryptDesktopCredential(material, "desktop_ssh_keys", key.Fingerprint, "private_key")
			if err != nil {
				return table, err
			}
			row["private_key"] = material
		} else {
			row["name"], row["public_key"], row["algorithm"], row["key_size"] = key.Name, key.PublicKey, key.Algorithm, key.KeySize
			row["passphrase_required"], row["created_at"], row["updated_at"] = key.PassphraseRequired, key.CreatedAt, updatedAt
		}
		table.Rows = append(table.Rows, row)
	}
	return table, rows.Err()
}

// Numeric IDs are local. Reuse the same public key by fingerprint and remap
// references before restoring connections, so ID collisions never change a key.
func restoreDesktopSSHKeys(tx *sql.Tx, backup *desktopUnifiedBackup, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult, sensitive bool) error {
	ids := map[int]int64{}
	for _, table := range backup.Database.Tables {
		if !strings.EqualFold(table.Name, "ssh_keys") {
			continue
		}
		for _, row := range table.Rows {
			oldID := desktopIntValue(row["id"], 0)
			if oldID <= 0 {
				return errors.New("invalid SSH key ID in backup")
			}
			if _, duplicate := ids[oldID]; duplicate {
				return errors.New("duplicate SSH key ID in backup")
			}
			publicKey := firstDesktopString(row, "public_key")
			parsed, _, _, _, err := ssh.ParseAuthorizedKey([]byte(publicKey))
			if err != nil {
				return fmt.Errorf("invalid backup SSH public key: %w", err)
			}
			fingerprint := ssh.FingerprintSHA256(parsed)
			if fingerprint != firstDesktopString(row, "fingerprint") {
				return errors.New("backup SSH key fingerprint does not match its public key")
			}
			var id int64
			err = tx.QueryRow("SELECT id FROM desktop_ssh_keys WHERE fingerprint = ?", fingerprint).Scan(&id)
			exists := err == nil
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if exists && strategy == backuputil.RestoreConflictError {
				return errors.New("SSH key already exists: " + fingerprint)
			}
			if exists && strategy == backuputil.RestoreConflictSkip {
				ids[oldID] = id
				result.Skipped++
				continue
			}
			now := time.Now().UTC().Format(time.RFC3339Nano)
			values := map[string]any{
				"name": firstDesktopString(row, "name"), "public_key": publicKey, "fingerprint": fingerprint,
				"algorithm": firstDesktopString(row, "algorithm"), "key_size": desktopIntValue(row["key_size"], 0),
				"passphrase_required": desktopBoolValue(row["passphrase_required"], false),
				"created_at":          desktopTimeValue(row["created_at"], now), "updated_at": desktopTimeValue(row["updated_at"], now),
			}

			if sensitive {
				if _, present := row["private_key"]; present {
					encrypted, err := encryptDesktopCredential(firstDesktopString(row, "private_key"), "desktop_ssh_keys", fingerprint, "private_key")
					if err != nil {
						return err
					}
					values["private_key"] = encrypted
				}
			}
			if exists {
				if _, hasMaterial := values["private_key"]; !hasMaterial {
					delete(values, "passphrase_required")
				}
				if err := updateDesktopBackupRow(tx, "desktop_ssh_keys", fmt.Sprint(id), values); err != nil {
					return err
				}
				result.Updated++
			} else {
				if _, ok := values["private_key"]; !ok {
					values["private_key"] = ""
				}
				if err := insertDesktopBackupRow(tx, "desktop_ssh_keys", values); err != nil {
					return err
				}
				if err := tx.QueryRow("SELECT id FROM desktop_ssh_keys WHERE fingerprint = ?", fingerprint).Scan(&id); err != nil {
					return err
				}
				result.Inserted++
			}
			ids[oldID] = id
		}
	}
	for _, table := range backup.Database.Tables {
		if !strings.EqualFold(table.Name, "servers") {
			continue
		}
		for _, row := range table.Rows {
			oldID := desktopIntValue(row["ssh_key_id"], 0)
			if oldID == 0 {
				row["ssh_key_id"] = nil
				continue
			}
			id, ok := ids[oldID]
			if !ok {
				return errors.New("connection references an SSH key missing from backup")
			}
			row["ssh_key_id"] = id
		}
	}
	return nil
}
