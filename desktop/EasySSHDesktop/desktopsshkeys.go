package main

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/easyssh/shared/sshutil"
)

type DesktopSSHKey struct {
	ID                 uint   `json:"id"`
	UserID             string `json:"user_id"`
	Name               string `json:"name"`
	PublicKey          string `json:"public_key"`
	Fingerprint        string `json:"fingerprint"`
	Algorithm          string `json:"algorithm"`
	KeySize            int    `json:"key_size"`
	PassphraseRequired bool   `json:"passphrase_required"`
	CreatedAt          string `json:"created_at"`
}

type DesktopSSHKeyImport struct {
	Name       string `json:"name"`
	PrivateKey string `json:"private_key"`
	Passphrase string `json:"passphrase"`
}

func (s *DesktopServerService) ListSSHKeys() ([]DesktopSSHKey, error) {
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`SELECT id, name, public_key, fingerprint, algorithm, key_size, passphrase_required, created_at FROM desktop_ssh_keys ORDER BY name, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []DesktopSSHKey{}
	for rows.Next() {
		var key DesktopSSHKey
		key.UserID = desktopLocalDataUserID
		if err := rows.Scan(&key.ID, &key.Name, &key.PublicKey, &key.Fingerprint, &key.Algorithm, &key.KeySize, &key.PassphraseRequired, &key.CreatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func (s *DesktopServerService) ImportSSHKey(input DesktopSSHKeyImport) (DesktopSSHKey, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return DesktopSSHKey{}, errors.New("key name is required")
	}
	material := strings.TrimSpace(input.PrivateKey)
	metadata, err := sshutil.InspectPrivateKey(material, input.Passphrase)
	if err != nil {
		return DesktopSSHKey{}, err
	}
	db, err := s.database()
	if err != nil {
		return DesktopSSHKey{}, err
	}
	// Fingerprint binds the ciphertext to its key independently of local numeric IDs.
	encrypted, err := encryptDesktopCredential(material, "desktop_ssh_keys", metadata.Fingerprint, "private_key")
	if err != nil {
		return DesktopSSHKey{}, err
	}
	_, err = db.Exec(`INSERT INTO desktop_ssh_keys (name, public_key, fingerprint, algorithm, key_size, passphrase_required, private_key, created_at, updated_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(fingerprint) DO UPDATE SET private_key = excluded.private_key, passphrase_required = excluded.passphrase_required WHERE desktop_ssh_keys.private_key = ''`, name, metadata.PublicKey, metadata.Fingerprint, metadata.Algorithm, metadata.KeySize, metadata.PassphraseRequired, encrypted, time.Now().UTC().Format(time.RFC3339Nano), time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return DesktopSSHKey{}, err
	}
	keys, err := s.ListSSHKeys()
	if err != nil {
		return DesktopSSHKey{}, err
	}
	for _, key := range keys {
		if key.Fingerprint == metadata.Fingerprint {
			return key, nil
		}
	}
	return DesktopSSHKey{}, sql.ErrNoRows
}

func (s *DesktopServerService) DeleteSSHKey(id uint) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	var references int
	if err := db.QueryRow("SELECT COUNT(*) FROM desktop_servers WHERE ssh_key_id = ?", id).Scan(&references); err != nil {
		return err
	}
	if references > 0 {
		return errors.New("SSH key is in use; detach it from connections before deleting")
	}
	result, err := db.Exec("DELETE FROM desktop_ssh_keys WHERE id = ?", id)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *DesktopServerService) resolveSSHKey(id *uint) (string, error) {
	if id == nil {
		return "", nil
	}
	db, err := s.database()
	if err != nil {
		return "", err
	}
	var material, fingerprint string
	if err := db.QueryRow("SELECT private_key, fingerprint FROM desktop_ssh_keys WHERE id = ?", *id).Scan(&material, &fingerprint); err != nil {
		return "", err
	}
	if material == "" {
		return "", nil
	}
	return decryptDesktopCredential(material, "desktop_ssh_keys", fingerprint, "private_key")
}

func desktopSSHKeyID(value sql.NullInt64) *uint {
	if !value.Valid {
		return nil
	}
	id := uint(value.Int64)
	return &id
}
