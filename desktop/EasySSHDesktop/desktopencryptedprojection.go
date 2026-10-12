package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/easyssh/shared/sshutil"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

type encryptedProjection struct {
	Snapshot syncdata.Snapshot `json:"snapshot"`
	Hash     string            `json:"hash"`
}
type portableCredential struct {
	Connection string                `json:"connection"`
	Password   string                `json:"password"`
	PrivateKey string                `json:"private_key"`
	Passphrase string                `json:"private_key_passphrase"`
	Key        *syncdata.KeyMaterial `json:"key,omitempty"`
}
type portableHistory struct {
	Payload     syncdata.VaultPayload `json:"payload"`
	Attachments map[string]string     `json:"attachments"`
}

func (s *DesktopSyncService) encryptedSnapshot(tx *sql.Tx, owner, scope string) (syncdata.Snapshot, error) {
	result := syncdata.Snapshot{}
	entries := []DesktopVaultState{}
	switch scope {
	case "ssh_keys":
		return encryptedKeySnapshot(tx, owner)
	case "credentials":
		rows, err := tx.Query(`SELECT m.remote_id,m.local_id FROM desktop_sync_records m JOIN desktop_servers s ON s.id=m.local_id WHERE m.space_id=? AND m.kind='server'`, owner)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			v := DesktopVaultState{SpaceID: owner, Kind: "credential"}
			if err = rows.Scan(&v.ID, &v.LocalID); err != nil {
				rows.Close()
				return nil, err
			}
			entries = append(entries, v)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	case "ai_config":
		entries = append(entries, DesktopVaultState{SpaceID: owner, Kind: "ai_config", ID: syncdata.AIConfigID})
	case "sessions":
		rows, err := tx.Query(`SELECT remote_id,local_id FROM desktop_sync_vault WHERE space_id=? AND kind='ai_session'`, owner)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			v := DesktopVaultState{SpaceID: owner, Kind: "ai_session", ObservedRef: "present"}
			if err = rows.Scan(&v.ID, &v.LocalID); err != nil {
				rows.Close()
				return nil, err
			}
			entries = append(entries, v)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	default:
		return nil, errors.New("invalid encrypted projection scope")
	}
	for _, entry := range entries {
		payload, err := s.captureLocalVault(tx, entry)
		if err != nil {
			return nil, err
		}
		if payload == nil {
			continue
		}
		content := ""
		if scope == "credentials" {
			c := payload.Credential
			value := portableCredential{Connection: c.Connection, Password: c.Password, Key: c.Key, Passphrase: c.Passphrase}
			if c.Key != nil {
				value.PrivateKey = c.Key.PrivateKey
			}
			content = syncdata.JSON(value)
		} else {
			history := portableHistory{Payload: *payload, Attachments: map[string]string{}}
			if payload.Conversation != nil {
				for _, message := range payload.Conversation.Messages {
					for _, attachment := range message.Attachments {
						id := strings.TrimPrefix(attachment.Data, "sync-attachment:")
						value, err := localObject(tx, owner, id)
						if err != nil {
							return nil, err
						}
						history.Attachments[id] = value
					}
				}
			}
			content = syncdata.JSON(history)
		}
		result["value/"+entry.ID] = syncdata.Record{"content": content}
	}
	return result, nil
}

func (s *DesktopSyncService) EncryptedProjectionLoad(owner, scope string) (encryptedProjection, error) {
	if err := s.encryptedBinding(owner); err != nil {
		return encryptedProjection{}, err
	}
	if !desktopAISyncMu.TryLock() {
		return encryptedProjection{}, errors.New("AI is busy")
	}
	defer desktopAISyncMu.Unlock()
	db, err := s.database()
	if err != nil {
		return encryptedProjection{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return encryptedProjection{}, err
	}
	defer tx.Rollback()
	snapshot, err := s.encryptedSnapshot(tx, owner, scope)
	if err != nil {
		return encryptedProjection{}, err
	}
	if err = tx.Commit(); err != nil {
		return encryptedProjection{}, err
	}
	return encryptedProjection{Snapshot: snapshot, Hash: syncdata.Hash(snapshot)}, nil
}

func (s *DesktopSyncService) EncryptedProjectionApply(owner, scope, expectedHash, encoded string) (encryptedProjection, error) {
	if err := s.encryptedBinding(owner); err != nil {
		return encryptedProjection{}, err
	}
	if len(encoded) > 128<<20 {
		return encryptedProjection{}, errors.New("projection exceeds 128 MiB")
	}
	var snapshot syncdata.Snapshot
	if err := json.Unmarshal([]byte(encoded), &snapshot); err != nil {
		return encryptedProjection{}, err
	}
	if !desktopAISyncMu.TryLock() {
		return encryptedProjection{}, errors.New("AI is busy")
	}
	defer desktopAISyncMu.Unlock()
	db, err := s.database()
	if err != nil {
		return encryptedProjection{}, err
	}
	tx, err := db.Begin()
	if err != nil {
		return encryptedProjection{}, err
	}
	defer tx.Rollback()
	updated, err := tx.Exec(`UPDATE desktop_sync_state SET revision=revision WHERE id=1 AND space_id=? AND token<>''`, owner)
	if err != nil {
		return encryptedProjection{}, err
	}
	count, _ := updated.RowsAffected()
	if count != 1 {
		return encryptedProjection{}, errors.New("sync account changed")
	}
	before, err := s.encryptedSnapshot(tx, owner, scope)
	if err != nil {
		return encryptedProjection{}, err
	}
	if syncdata.Hash(before) != expectedHash {
		return encryptedProjection{}, errors.New("local data changed; retry sync")
	}
	if scope == "ssh_keys" {
		if err = applyEncryptedKeys(tx, owner, before, snapshot); err != nil {
			return encryptedProjection{}, err
		}
		after, e := encryptedKeySnapshot(tx, owner)
		if e != nil {
			return encryptedProjection{}, e
		}
		if e = tx.Commit(); e != nil {
			return encryptedProjection{}, e
		}
		return encryptedProjection{Snapshot: after, Hash: syncdata.Hash(after)}, nil
	}
	for key := range before {
		if _, exists := snapshot[key]; exists {
			continue
		}
		id := strings.TrimPrefix(key, "value/")
		switch scope {
		case "credentials":
			_, err = tx.Exec(`UPDATE desktop_servers SET password='',ssh_key_id=NULL WHERE id IN (SELECT local_id FROM desktop_sync_records WHERE space_id=? AND kind='server' AND remote_id=?)`, owner, id)
		case "ai_config":
			_, err = tx.Exec(`DELETE FROM desktop_ai_config WHERE id=?`, owner)
		case "sessions":
			_, err = tx.Exec(`DELETE FROM desktop_ai_sessions WHERE id IN (SELECT local_id FROM desktop_sync_vault WHERE space_id=? AND kind='ai_session' AND remote_id=?)`, owner, id)
			if err == nil {
				_, err = tx.Exec(`DELETE FROM desktop_sync_vault WHERE space_id=? AND kind='ai_session' AND remote_id=?`, owner, id)
			}
		}
		if err != nil {
			return encryptedProjection{}, err
		}
	}
	for key, record := range snapshot {
		if !strings.HasPrefix(key, "value/") || !syncdata.ValidUUID(strings.TrimPrefix(key, "value/")) {
			return encryptedProjection{}, errors.New("invalid projection record")
		}
		id := strings.TrimPrefix(key, "value/")
		v := DesktopVaultState{SpaceID: owner, ID: id}
		var p syncdata.VaultPayload
		switch scope {
		case "credentials":
			v.Kind = "credential"
			if err = tx.QueryRow(`SELECT local_id FROM desktop_sync_records WHERE space_id=? AND kind='server' AND remote_id=?`, owner, id).Scan(&v.LocalID); err == sql.ErrNoRows {
				continue
			} else if err != nil {
				return encryptedProjection{}, err
			}
			var value portableCredential
			if err = json.Unmarshal([]byte(record["content"]), &value); err != nil {
				return encryptedProjection{}, err
			}
			p = syncdata.VaultPayload{Kind: "credential", Credential: &syncdata.Credential{Connection: value.Connection, Password: value.Password, Passphrase: value.Passphrase}}
			if value.PrivateKey != "" {
				if value.Key != nil && value.Key.PrivateKey == value.PrivateKey {
					p.Credential.Key = value.Key
				} else {
					metadata, err := sshutil.InspectPrivateKey(value.PrivateKey, value.Passphrase)
					if err != nil {
						return encryptedProjection{}, err
					}
					p.Credential.Key = &syncdata.KeyMaterial{Name: "Synced key", PrivateKey: value.PrivateKey, PublicKey: metadata.PublicKey, Fingerprint: metadata.Fingerprint, Algorithm: metadata.Algorithm, KeySize: metadata.KeySize, PassphraseRequired: metadata.PassphraseRequired}
				}
			}
		case "ai_config", "sessions":
			var history portableHistory
			if err = json.Unmarshal([]byte(record["content"]), &history); err != nil {
				return encryptedProjection{}, err
			}
			p = history.Payload
			v.Kind = "ai_config"
			if scope == "sessions" {
				v.Kind = "ai_session"
			}
			if scope == "ai_config" && id != syncdata.AIConfigID {
				return encryptedProjection{}, errors.New("invalid AI configuration ID")
			}
			if scope == "sessions" {
				err = tx.QueryRow(`SELECT local_id FROM desktop_sync_vault WHERE space_id=? AND kind='ai_session' AND remote_id=?`, owner, id).Scan(&v.LocalID)
				if err == sql.ErrNoRows {
					v.LocalID = uuid.NewString()
					if _, err = tx.Exec(`INSERT INTO desktop_sync_vault(space_id,kind,remote_id,local_id) VALUES(?,'ai_session',?,?)`, owner, id, v.LocalID); err != nil {
						return encryptedProjection{}, err
					}
				} else if err != nil {
					return encryptedProjection{}, err
				}
				for attachmentID, data := range history.Attachments {
					if !syncdata.ValidAttachmentID(attachmentID) {
						return encryptedProjection{}, errors.New("invalid attachment ID")
					}
					if err = s.putLocalObject(tx, owner, "attachment", attachmentID, id, data); err != nil {
						return encryptedProjection{}, err
					}
				}
			}
		default:
			return encryptedProjection{}, errors.New("invalid projection scope")
		}
		if err = p.Validate(v.Kind); err != nil {
			return encryptedProjection{}, err
		}
		if err = s.applyLocalVault(tx, v, p); err != nil {
			return encryptedProjection{}, err
		}
	}
	after, err := s.encryptedSnapshot(tx, owner, scope)
	if err != nil {
		return encryptedProjection{}, err
	}
	if err = tx.Commit(); err != nil {
		return encryptedProjection{}, err
	}
	return encryptedProjection{Snapshot: after, Hash: syncdata.Hash(after)}, nil
}
