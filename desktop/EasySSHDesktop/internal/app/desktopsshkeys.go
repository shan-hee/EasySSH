package app

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
)

func (s *DesktopServerService) ListSSHKeys() ([]protocol.SSHKey, error) {
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`SELECT id,name,public_key,fingerprint,algorithm,key_size,passphrase_required,private_key <> '',saved_passphrase <> '',created_at,updated_at FROM desktop_ssh_keys ORDER BY name,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []protocol.SSHKey{}
	for rows.Next() {
		key, err := scanDesktopSSHKey(rows)
		if err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func scanDesktopSSHKey(row interface{ Scan(...any) error }) (protocol.SSHKey, error) {
	var key protocol.SSHKey
	var created, updated string
	if err := row.Scan(&key.ID, &key.Name, &key.PublicKey, &key.Fingerprint, &key.Algorithm, &key.KeySize, &key.PassphraseRequired, &key.HasPrivateKey, &key.HasSavedPassphrase, &created, &updated); err != nil {
		return protocol.SSHKey{}, err
	}
	var err error
	key.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return protocol.SSHKey{}, err
	}
	key.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	if err != nil {
		return protocol.SSHKey{}, err
	}
	return key, nil
}
func (s *DesktopServerService) ImportSSHKey(input protocol.SSHKeyImportInput) (protocol.SSHKey, error) {
	db, err := s.database()
	if err != nil {
		return protocol.SSHKey{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return protocol.SSHKey{}, err
	}
	defer tx.Rollback()
	key, err := importDesktopSSHKey(tx, input)
	if err != nil {
		return protocol.SSHKey{}, err
	}
	if err = tx.Commit(); err != nil {
		return protocol.SSHKey{}, err
	}
	return key, nil
}

func importDesktopSSHKey(tx *sql.Tx, input protocol.SSHKeyImportInput) (protocol.SSHKey, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || len(name) > 100 {
		return protocol.SSHKey{}, errors.New("key name is required (maximum 100 bytes)")
	}
	if len(input.PrivateKey) > 1<<20 || len(input.Passphrase) > 4096 {
		return protocol.SSHKey{}, errors.New("key material exceeds limit")
	}
	material := strings.TrimSpace(input.PrivateKey)
	metadata, err := sshutil.InspectPrivateKey(material, input.Passphrase)
	if err != nil {
		return protocol.SSHKey{}, err
	}
	id := uuid.NewString()
	var existing string
	err = tx.QueryRow("SELECT id FROM desktop_ssh_keys WHERE fingerprint=?", metadata.Fingerprint).Scan(&existing)
	if err != nil && err != sql.ErrNoRows {
		return protocol.SSHKey{}, err
	}
	if err == nil {
		id = existing
	}
	encrypted, err := encryptDesktopCredential(material, "desktop_ssh_keys", id, "private_key")
	if err != nil {
		return protocol.SSHKey{}, err
	}
	phrase := ""
	if input.SavePassphrase && metadata.PassphraseRequired {
		phrase, err = encryptDesktopCredential(input.Passphrase, "desktop_ssh_keys", id, "saved_passphrase")
		if err != nil {
			return protocol.SSHKey{}, err
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := tx.Exec(`INSERT INTO desktop_ssh_keys(id,name,public_key,fingerprint,algorithm,key_size,passphrase_required,private_key,saved_passphrase,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET private_key=excluded.private_key,saved_passphrase=excluded.saved_passphrase,passphrase_required=excluded.passphrase_required,updated_at=excluded.updated_at WHERE desktop_ssh_keys.id=excluded.id AND desktop_ssh_keys.private_key=''`, id, name, metadata.PublicKey, metadata.Fingerprint, metadata.Algorithm, metadata.KeySize, metadata.PassphraseRequired, encrypted, phrase, now, now)
	if err != nil {
		return protocol.SSHKey{}, err
	}

	key, err := scanDesktopSSHKey(tx.QueryRow(`SELECT id,name,public_key,fingerprint,algorithm,key_size,passphrase_required,private_key<>'',saved_passphrase<>'',created_at,updated_at FROM desktop_ssh_keys WHERE id=?`, id))
	if err != nil {
		return protocol.SSHKey{}, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return protocol.SSHKey{}, err
	}
	if count > 0 {
		action := "ssh_key_imported"
		if existing != "" {
			action = "ssh_key_material_completed"
		}
		resources, err := desktopKeyResources(tx, id)
		if err != nil {
			return protocol.SSHKey{}, err
		}
		if err = recordDesktopConfiguration(tx, action, "ssh_key", id, key.Name, "manual", []string{"private_key", "saved_passphrase"}, resources); err != nil {
			return protocol.SSHKey{}, err
		}
	}
	return key, nil
}

func (s *DesktopServerService) DeleteSSHKey(id string) error {
	if _, err := uuid.Parse(id); err != nil {
		return errors.New("invalid SSH key ID")
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRow("SELECT COUNT(*) FROM desktop_server_auth WHERE ssh_key_id=?", id).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return errors.New("SSH key is in use; detach it from connections before deleting")
	}
	var name string
	if err = tx.QueryRow("SELECT name FROM desktop_ssh_keys WHERE id=?", id).Scan(&name); err != nil {
		return err
	}
	result, err := tx.Exec("DELETE FROM desktop_ssh_keys WHERE id=?", id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	if err = recordDesktopConfiguration(tx, "ssh_key_deleted", "ssh_key", id, name, "manual", []string{"deleted"}, nil); err != nil {
		return err
	}
	return tx.Commit()
}

// Reference names are local owner metadata. The sharing-window native allowlist
// does not expose this service or any local key material.
func (s *DesktopServerService) ListSSHKeyReferences(id string) (protocol.SSHKeyReferences, error) {
	keyID, err := uuid.Parse(id)
	if err != nil || keyID == uuid.Nil || keyID.String() != id {
		return protocol.SSHKeyReferences{}, errors.New("invalid SSH key ID")
	}
	db, err := s.database()
	if err != nil {
		return protocol.SSHKeyReferences{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return protocol.SSHKeyReferences{}, err
	}
	defer tx.Rollback()
	var found string
	if err := tx.QueryRow("SELECT id FROM desktop_ssh_keys WHERE id=?", id).Scan(&found); err != nil {
		return protocol.SSHKeyReferences{}, err
	}
	rows, err := tx.Query(`SELECT s.id,COALESCE(NULLIF(s.name,''),s.host) FROM desktop_servers s JOIN desktop_server_auth a ON a.server_id=s.id WHERE a.ssh_key_id=? ORDER BY s.name,s.id`, id)
	if err != nil {
		return protocol.SSHKeyReferences{}, err
	}
	result := protocol.SSHKeyReferences{KeyID: keyID, References: []protocol.SSHKeyReference{}}
	for rows.Next() {
		var item protocol.SSHKeyReference
		if err := rows.Scan(&item.ID, &item.Name); err != nil {
			rows.Close()
			return protocol.SSHKeyReferences{}, err
		}
		result.References = append(result.References, item)
	}
	readErr := rows.Err()
	closeErr := rows.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		return protocol.SSHKeyReferences{}, err
	}
	if err := tx.Commit(); err != nil {
		return protocol.SSHKeyReferences{}, err
	}
	return result, nil
}

func (s *DesktopServerService) SetSSHKeyPassphrase(id, passphrase string, save bool) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var material, fp, name, currentPhrase string
	if err := tx.QueryRow("SELECT private_key,fingerprint,name,saved_passphrase FROM desktop_ssh_keys WHERE id=?", id).Scan(&material, &fp, &name, &currentPhrase); err != nil {
		return err
	}
	encrypted := ""
	if save {
		plain, err := decryptDesktopCredential(material, "desktop_ssh_keys", id, "private_key")
		if err != nil {
			return err
		}
		metadata, err := sshutil.InspectPrivateKey(plain, passphrase)
		if err != nil {
			return err
		}
		if metadata.Fingerprint != fp || !metadata.PassphraseRequired {
			return errors.New("key does not require this passphrase")
		}
		encrypted, err = encryptDesktopCredential(passphrase, "desktop_ssh_keys", id, "saved_passphrase")
		if err != nil {
			return err
		}
	}
	oldPhrase, err := decryptDesktopCredential(currentPhrase, "desktop_ssh_keys", id, "saved_passphrase")
	if err != nil {
		return err
	}
	if (!save && currentPhrase == "") || (save && oldPhrase == passphrase) {
		return tx.Commit()
	}
	if _, err := tx.Exec("UPDATE desktop_ssh_keys SET saved_passphrase=?,updated_at=? WHERE id=?", encrypted, time.Now().UTC().Format(time.RFC3339Nano), id); err != nil {
		return err
	}
	resources, err := desktopKeyResources(tx, id)
	if err != nil {
		return err
	}
	if err = recordDesktopConfiguration(tx, "ssh_key_passphrase_changed", "ssh_key", id, name, "manual", []string{"saved_passphrase"}, resources); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *DesktopServerService) resolveSSHKey(id *string) (string, error) {
	material, _, err := s.resolveSSHKeyCredentials(id)
	return material, err
}
func (s *DesktopServerService) resolveSSHKeyCredentials(id *string) (string, string, error) {
	if id == nil {
		return "", "", nil
	}
	db, err := s.database()
	if err != nil {
		return "", "", err
	}
	var material, phrase string
	if err := db.QueryRow("SELECT private_key,saved_passphrase FROM desktop_ssh_keys WHERE id=?", *id).Scan(&material, &phrase); err != nil {
		return "", "", err
	}
	material, err = decryptDesktopCredential(material, "desktop_ssh_keys", *id, "private_key")
	if err != nil {
		return "", "", err
	}
	phrase, err = decryptDesktopCredential(phrase, "desktop_ssh_keys", *id, "saved_passphrase")
	return material, phrase, err
}
func desktopSSHKeyID(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	id := value.String
	return &id
}
