package main

import (
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/easyssh/shared/sshutil"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

type portableSSHKey struct {
	DesktopSSHKey
	PrivateKey string `json:"private_key"`
	Passphrase string `json:"passphrase"`
}

func encryptedKeySnapshot(tx *sql.Tx, owner string) (syncdata.Snapshot, error) {
	rows, err := tx.Query(`SELECT m.remote_id,m.wire_id,k.name,k.public_key,k.fingerprint,k.algorithm,k.key_size,k.passphrase_required,k.created_at,k.private_key,k.passphrase FROM desktop_sync_keys m JOIN desktop_ssh_keys k ON k.id=m.local_id WHERE m.space_id=?`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	snapshot := syncdata.Snapshot{}
	for rows.Next() {
		var id, private, passphrase string
		var value portableSSHKey
		if err = rows.Scan(&id, &value.ID, &value.Name, &value.PublicKey, &value.Fingerprint, &value.Algorithm, &value.KeySize, &value.PassphraseRequired, &value.CreatedAt, &private, &passphrase); err != nil {
			return nil, err
		}
		value.UserID = owner
		value.PrivateKey, err = decryptDesktopCredential(private, "desktop_ssh_keys", value.Fingerprint, "private_key")
		if err != nil {
			return nil, err
		}
		value.Passphrase, err = decryptDesktopCredential(passphrase, "desktop_ssh_keys", value.Fingerprint, "passphrase")
		if err != nil {
			return nil, err
		}
		snapshot["value/"+id] = syncdata.Record{"content": syncdata.JSON(value)}
	}
	return snapshot, rows.Err()
}

func applyEncryptedKeys(tx *sql.Tx, owner string, before, after syncdata.Snapshot) error {
	fingerprints := map[string]bool{}
	for _, record := range after {
		var value portableSSHKey
		if err := json.Unmarshal([]byte(record["content"]), &value); err != nil {
			return err
		}
		if fingerprints[value.Fingerprint] {
			return errors.New("SSH key library has duplicate fingerprints; remove the duplicate record before syncing")
		}
		fingerprints[value.Fingerprint] = true
	}
	for key := range before {
		if _, exists := after[key]; exists {
			continue
		}
		var local int64
		if err := tx.QueryRow(`SELECT local_id FROM desktop_sync_keys WHERE space_id=? AND remote_id=?`, owner, strings.TrimPrefix(key, "value/")).Scan(&local); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM desktop_sync_keys WHERE space_id=? AND remote_id=?`, owner, strings.TrimPrefix(key, "value/")); err != nil {
			return err
		}
		// A key still used by another account or a local server is retained locally.
		if _, err := tx.Exec(`DELETE FROM desktop_ssh_keys WHERE id=? AND NOT EXISTS(SELECT 1 FROM desktop_sync_keys WHERE local_id=?) AND NOT EXISTS(SELECT 1 FROM desktop_servers WHERE ssh_key_id=?)`, local, local, local); err != nil {
			return err
		}
	}
	for key, record := range after {
		id := strings.TrimPrefix(key, "value/")
		if !strings.HasPrefix(key, "value/") || !syncdata.ValidUUID(id) {
			return errors.New("invalid SSH key record")
		}
		var value portableSSHKey
		if err := json.Unmarshal([]byte(record["content"]), &value); err != nil {
			return err
		}
		if value.ID == 0 || uint64(value.ID) > 9007199254740991 || strings.TrimSpace(value.Name) == "" {
			return errors.New("invalid SSH key metadata")
		}
		metadata, err := sshutil.InspectPrivateKey(value.PrivateKey, value.Passphrase)
		if err != nil {
			if !value.PassphraseRequired || value.Passphrase != "" {
				return err
			}
			material := &syncdata.KeyMaterial{Name: value.Name, PublicKey: value.PublicKey, PrivateKey: value.PrivateKey, Fingerprint: value.Fingerprint, Algorithm: value.Algorithm, KeySize: value.KeySize, PassphraseRequired: true}
			if err = syncdata.ValidateKey(material); err != nil {
				return err
			}
			metadata = sshutil.KeyMetadata{PublicKey: value.PublicKey, Fingerprint: value.Fingerprint, Algorithm: value.Algorithm, KeySize: value.KeySize, PassphraseRequired: true}
		}
		if metadata.Fingerprint != value.Fingerprint || metadata.PublicKey != value.PublicKey {
			return errors.New("SSH key fingerprint mismatch")
		}
		private, err := encryptDesktopCredential(value.PrivateKey, "desktop_ssh_keys", value.Fingerprint, "private_key")
		if err != nil {
			return err
		}
		passphrase, err := encryptDesktopCredential(value.Passphrase, "desktop_ssh_keys", value.Fingerprint, "passphrase")
		if err != nil {
			return err
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		created := value.CreatedAt
		if _, err := time.Parse(time.RFC3339Nano, created); err != nil {
			return err
		}
		if _, err = tx.Exec(`INSERT INTO desktop_ssh_keys(name,public_key,fingerprint,algorithm,key_size,passphrase_required,private_key,passphrase,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING`, value.Name, metadata.PublicKey, value.Fingerprint, metadata.Algorithm, metadata.KeySize, metadata.PassphraseRequired, private, passphrase, created, now); err != nil {
			return err
		}
		var local int64
		if err = tx.QueryRow(`SELECT id FROM desktop_ssh_keys WHERE fingerprint=?`, value.Fingerprint).Scan(&local); err != nil {
			return err
		}
		// Scope ownership is explicit; never replace an unrelated account's material.
		var others int
		if err = tx.QueryRow(`SELECT COUNT(*) FROM desktop_sync_keys WHERE local_id=? AND space_id<>?`, local, owner).Scan(&others); err != nil {
			return err
		}
		if others == 0 {
			if _, err = tx.Exec(`UPDATE desktop_ssh_keys SET name=?,private_key=?,passphrase=?,passphrase_required=?,updated_at=? WHERE id=?`, value.Name, private, passphrase, metadata.PassphraseRequired, now, local); err != nil {
				return err
			}
		} else {
			var savedPrivate, savedPassphrase, savedName string
			if err = tx.QueryRow(`SELECT private_key,passphrase,name FROM desktop_ssh_keys WHERE id=?`, local).Scan(&savedPrivate, &savedPassphrase, &savedName); err != nil {
				return err
			}
			plainPrivate, err := decryptDesktopCredential(savedPrivate, "desktop_ssh_keys", value.Fingerprint, "private_key")
			if err != nil {
				return err
			}
			plainPassphrase, err := decryptDesktopCredential(savedPassphrase, "desktop_ssh_keys", value.Fingerprint, "passphrase")
			if err != nil {
				return err
			}
			if plainPrivate != value.PrivateKey || plainPassphrase != value.Passphrase || savedName != value.Name {
				return errors.New("SSH key is shared with another account and differs; resolve the key in that account before syncing")
			}
		}
		if _, err = tx.Exec(`INSERT INTO desktop_sync_keys(space_id,remote_id,local_id,wire_id) VALUES(?,?,?,?) ON CONFLICT(space_id,remote_id) DO UPDATE SET local_id=excluded.local_id,wire_id=excluded.wire_id`, owner, id, local, value.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *DesktopSyncService) KeyCandidates() ([]DesktopSyncCandidate, error) {
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`SELECT 'ssh_key/'||k.id,k.name,COALESCE(m.space_id,''),COALESCE(p.account_name,''),COALESCE(p.server_url,'') FROM desktop_ssh_keys k LEFT JOIN desktop_sync_keys m ON m.local_id=k.id LEFT JOIN desktop_sync_spaces p ON p.id=m.space_id ORDER BY (m.space_id=(SELECT space_id FROM desktop_sync_state WHERE id=1)) DESC,k.name,k.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []DesktopSyncCandidate{}
	seen := map[string]bool{}
	for rows.Next() {
		var v DesktopSyncCandidate
		if err = rows.Scan(&v.Key, &v.Name, &v.SpaceID, &v.AccountName, &v.ServerURL); err != nil {
			return nil, err
		}
		if !seen[v.Key] {
			result = append(result, v)
			seen[v.Key] = true
		}
	}
	return result, rows.Err()
}

func (s *DesktopSyncService) EnrollSSHKey(owner, local string) error {
	if err := s.encryptedBinding(owner); err != nil {
		return err
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
	update, err := tx.Exec(`UPDATE desktop_sync_state SET revision=revision+1 WHERE id=1 AND space_id=? AND token<>''`, owner)
	if err != nil {
		return err
	}
	n, _ := update.RowsAffected()
	if n != 1 {
		return errors.New("sync account changed")
	}
	var id int64
	if err = tx.QueryRow(`SELECT id FROM desktop_ssh_keys WHERE id=?`, local).Scan(&id); err != nil {
		return err
	}
	remote := uuid.New()
	wire := binary.BigEndian.Uint64(remote[:8]) >> 11
	if wire == 0 {
		wire = 1
	}
	if _, err = tx.Exec(`INSERT INTO desktop_sync_keys(space_id,remote_id,local_id,wire_id) VALUES(?,?,?,?)`, owner, remote.String(), id, wire); err != nil {
		return err
	}
	return tx.Commit()
}
