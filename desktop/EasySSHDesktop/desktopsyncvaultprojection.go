package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

func (s *DesktopSyncService) captureLocalVault(tx *sql.Tx, v DesktopVaultState) (*syncdata.VaultPayload, error) {
	p := &syncdata.VaultPayload{Kind: v.Kind, Source: "desktop"}
	switch v.Kind {
	case "credential":
		var host, user, method, encrypted, updated string
		var port int
		var keyID sql.NullInt64
		err := tx.QueryRow(`SELECT host,port,username,auth_method,password,ssh_key_id,updated_at FROM desktop_servers WHERE id=?`, v.LocalID).Scan(&host, &port, &user, &method, &encrypted, &keyID, &updated)
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		if encrypted == "" && !keyID.Valid && v.ObservedRef == "" {
			return nil, nil
		}
		password, err := decryptDesktopCredential(encrypted, "desktop_servers", v.LocalID, "password")
		if err != nil {
			return nil, err
		}
		p.Credential = &syncdata.Credential{Connection: syncdata.JSON(syncdata.Connection{Host: host, Port: port, Username: user, AuthMethod: method}), Password: password}
		if keyID.Valid {
			var k syncdata.KeyMaterial
			var enc string
			err = tx.QueryRow(`SELECT name,public_key,private_key,fingerprint,algorithm,key_size,passphrase_required FROM desktop_ssh_keys WHERE id=?`, keyID.Int64).Scan(&k.Name, &k.PublicKey, &enc, &k.Fingerprint, &k.Algorithm, &k.KeySize, &k.PassphraseRequired)
			if err != nil {
				return nil, err
			}
			k.PrivateKey, err = decryptDesktopCredential(enc, "desktop_ssh_keys", k.Fingerprint, "private_key")
			if err != nil {
				return nil, err
			}
			p.Credential.Key = &k
		}
	case "ai_config":
		var c syncdata.AIConfig
		var encrypted, updated string
		err := tx.QueryRow(`SELECT custom_enabled,custom_provider,custom_endpoint,custom_api_key,custom_models,updated_at FROM desktop_ai_config WHERE id=?`, v.SpaceID).Scan(&c.Enabled, &c.Provider, &c.Endpoint, &encrypted, &c.Models, &updated)
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		c.APIKey, err = decryptDesktopCredential(encrypted, "desktop_ai_config", v.SpaceID, "custom_api_key")
		if err != nil {
			return nil, err
		}
		p.AIConfig = &c
	case "ai_session":
		var title, model, messages, tasks, created, status, updated string
		err := tx.QueryRow(`SELECT title,model,messages_json,tasks_json,created_at,status,updated_at FROM desktop_ai_sessions WHERE id=?`, v.LocalID).Scan(&title, &model, &messages, &tasks, &created, &status, &updated)
		if err == sql.ErrNoRows {
			if v.ObservedRef != "" {
				p.Deleted = true
				return p, nil
			}
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if status == "running" || status == "waiting_confirmation" {
			return nil, errors.New("conversation is busy")
		}
		p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		c := &syncdata.Conversation{Title: title, Model: model}
		c.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		if err = json.Unmarshal([]byte(messages), &c.Messages); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(tasks), &c.Tasks); err != nil {
			return nil, err
		}
		syncdata.NormalizeConversation(c)
		for i := range c.Messages {
			refs := []aichatui.ServerReference{}
			for _, ref := range c.Messages[i].ServerReferences {
				var remoteID string
				if err = tx.QueryRow(`SELECT remote_id FROM desktop_sync_records WHERE kind='server' AND local_id=? AND space_id=?`, ref.ServerID, v.SpaceID).Scan(&remoteID); err == nil {
					ref.ServerID = remoteID
					refs = append(refs, ref)
				} else if err != sql.ErrNoRows {
					return nil, err
				}
			}
			c.Messages[i].ServerReferences = refs
		}
		for id, data := range syncdata.ExtractAttachments(c) {
			if err = s.putLocalObject(tx, v.SpaceID, "attachment", id, v.ID, data, false); err != nil {
				return nil, err
			}
		}
		p.Conversation = c
	}
	return p, nil
}
func (s *DesktopSyncService) applyLocalVault(tx *sql.Tx, v DesktopVaultState, p syncdata.VaultPayload) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	switch v.Kind {
	case "credential":
		var host, user, method string
		var port int
		if err := tx.QueryRow(`SELECT host,port,username,auth_method FROM desktop_servers WHERE id=?`, v.LocalID).Scan(&host, &port, &user, &method); err != nil {
			return err
		}
		c := p.Credential
		if syncdata.JSON(syncdata.Connection{Host: host, Port: port, Username: user, AuthMethod: method}) != c.Connection {
			return errors.New("credential target changed; resolve connection settings first")
		}
		password, err := encryptDesktopCredential(c.Password, "desktop_servers", v.LocalID, "password")
		if err != nil {
			return err
		}
		var keyID *int64
		if k := c.Key; k != nil {
			if err = syncdata.ValidateKey(k); err != nil {
				return err
			}
			var id int64
			err = tx.QueryRow(`SELECT id FROM desktop_ssh_keys WHERE fingerprint=?`, k.Fingerprint).Scan(&id)
			if err == sql.ErrNoRows {
				enc, e := encryptDesktopCredential(k.PrivateKey, "desktop_ssh_keys", k.Fingerprint, "private_key")
				if e != nil {
					return e
				}
				result, e := tx.Exec(`INSERT INTO desktop_ssh_keys(name,public_key,fingerprint,algorithm,key_size,passphrase_required,private_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, k.Name, k.PublicKey, k.Fingerprint, k.Algorithm, k.KeySize, k.PassphraseRequired, enc, now, now)
				if e != nil {
					return e
				}
				id, e = result.LastInsertId()
				if e != nil {
					return e
				}
			} else if err != nil {
				return err
			}
			if k.PrivateKey != "" {
				encrypted, err := encryptDesktopCredential(k.PrivateKey, "desktop_ssh_keys", k.Fingerprint, "private_key")
				if err != nil {
					return err
				}
				if _, err = tx.Exec(`UPDATE desktop_ssh_keys SET private_key=?,passphrase_required=?,updated_at=? WHERE id=? AND private_key=''`, encrypted, k.PassphraseRequired, now, id); err != nil {
					return err
				}
			}
			keyID = &id
		}
		_, err = tx.Exec(`UPDATE desktop_servers SET password=?,ssh_key_id=?,updated_at=? WHERE id=?`, password, keyID, now, v.LocalID)
		return err
	case "ai_config":
		c := p.AIConfig
		enc, err := encryptDesktopCredential(c.APIKey, "desktop_ai_config", v.SpaceID, "custom_api_key")
		if err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO desktop_ai_config(id,use_system_config,custom_enabled,custom_provider,custom_endpoint,custom_api_key,custom_models,updated_at) VALUES(?,0,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET custom_enabled=excluded.custom_enabled,custom_provider=excluded.custom_provider,custom_endpoint=excluded.custom_endpoint,custom_api_key=excluded.custom_api_key,custom_models=excluded.custom_models,updated_at=excluded.updated_at`, v.SpaceID, c.Enabled, c.Provider, c.Endpoint, enc, c.Models, now)
		return err
	case "ai_session":
		if p.Deleted {
			_, err := tx.Exec(`DELETE FROM desktop_ai_sessions WHERE id=?`, v.LocalID)
			return err
		}
		c := p.Conversation
		syncdata.NormalizeConversation(c)
		if err := syncdata.HydrateAttachments(c, func(id string) (string, error) { return localObject(tx, v.SpaceID, id) }); err != nil {
			return err
		}
		for i := range c.Messages {
			refs := []aichatui.ServerReference{}
			for _, ref := range c.Messages[i].ServerReferences {
				var localID string
				err := tx.QueryRow(`SELECT m.local_id FROM desktop_sync_records m JOIN desktop_servers s ON s.id=m.local_id WHERE m.kind='server' AND m.space_id=? AND m.remote_id=?`, v.SpaceID, ref.ServerID).Scan(&localID)
				if err == nil {
					ref.ServerID = localID
					refs = append(refs, ref)
				} else if err != sql.ErrNoRows {
					return err
				}
			}
			c.Messages[i].ServerReferences = refs
		}
		created := c.CreatedAt.UTC().Format(time.RFC3339Nano)
		if c.CreatedAt.IsZero() {
			created = now
		}
		_, err := tx.Exec(`INSERT INTO desktop_ai_sessions(id,config_space_id,title,custom_title,model,permission_mode,scope_json,status,messages_json,tasks_json,created_at,updated_at) VALUES(?,?,?,1,?,'readonly','{}','idle',?,?,?,?) ON CONFLICT(id) DO UPDATE SET config_space_id=excluded.config_space_id,title=excluded.title,custom_title=1,model=excluded.model,permission_mode='readonly',scope_json='{}',status='idle',messages_json=excluded.messages_json,tasks_json=excluded.tasks_json,updated_at=excluded.updated_at`, v.LocalID, v.SpaceID, c.Title, c.Model, syncdata.JSON(c.Messages), syncdata.JSON(c.Tasks), created, now)
		return err
	}
	return errors.New("unknown sync payload kind")
}

// Explicit copy into this space; never read an old account's configuration as
// the configuration for a newly connected account.
func (s *DesktopSyncService) EnrollAIConfig(spaceID string) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	if !desktopAISyncMu.TryLock() {
		return errors.New("AI is busy")
	}
	defer desktopAISyncMu.Unlock()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var current string
	if err = tx.QueryRow(`SELECT space_id FROM desktop_sync_state WHERE id=1 AND token<>''`).Scan(&current); err != nil {
		return err
	}
	if current != spaceID {
		return errors.New("sync account changed")
	}
	var c syncdata.AIConfig
	var encrypted string
	err = tx.QueryRow(`SELECT custom_enabled,custom_provider,custom_endpoint,custom_api_key,custom_models FROM desktop_ai_config WHERE id='local'`).Scan(&c.Enabled, &c.Provider, &c.Endpoint, &encrypted, &c.Models)
	if err != nil {
		return err
	}
	c.APIKey, err = decryptDesktopCredential(encrypted, "desktop_ai_config", "local", "custom_api_key")
	if err != nil {
		return err
	}
	v := DesktopVaultState{SpaceID: spaceID, Kind: "ai_config", ID: syncdata.AIConfigID}
	if err = s.applyLocalVault(tx, v, syncdata.VaultPayload{Kind: "ai_config", AIConfig: &c}); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *DesktopSyncService) EnrollSession(spaceID, localID string) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	if !desktopAISyncMu.TryLock() {
		return errors.New("AI is busy")
	}
	defer desktopAISyncMu.Unlock()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var current string
	if err = tx.QueryRow(`SELECT space_id FROM desktop_sync_state WHERE id=1 AND token<>''`).Scan(&current); err != nil {
		return err
	}
	if current != spaceID {
		return errors.New("sync account changed")
	}
	var old string
	err = tx.QueryRow(`SELECT space_id FROM desktop_sync_vault WHERE kind='ai_session' AND local_id=? LIMIT 1`, localID).Scan(&old)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if old == spaceID {
		return errors.New("already enrolled")
	}
	var status string
	if err = tx.QueryRow(`SELECT status FROM desktop_ai_sessions WHERE id=?`, localID).Scan(&status); err != nil {
		return err
	}
	if status == "running" || status == "waiting_confirmation" {
		return errors.New("conversation is busy")
	}
	if old != "" {
		// Resolve references in the source space, then filter them in the destination.
		source := DesktopVaultState{SpaceID: old, Kind: "ai_session", ID: uuid.NewString(), LocalID: localID}
		payload, err := s.captureLocalVault(tx, source)
		if err != nil {
			return err
		}
		if payload == nil {
			return errors.New("conversation unavailable")
		}
		if err = syncdata.HydrateAttachments(payload.Conversation, func(id string) (string, error) { return localObject(tx, old, id) }); err != nil {
			return err
		}
		for id, data := range syncdata.ExtractAttachments(payload.Conversation) {
			if err = s.putLocalObject(tx, spaceID, "attachment", id, source.ID, data, false); err != nil {
				return err
			}
		}
		for i := range payload.Conversation.Messages {
			payload.Conversation.Messages[i].ServerReferences = []aichatui.ServerReference{}
		}
		localID = uuid.NewString()
		if err = s.applyLocalVault(tx, DesktopVaultState{SpaceID: spaceID, Kind: "ai_session", ID: source.ID, LocalID: localID}, *payload); err != nil {
			return err
		}
	}

	_, err = tx.Exec(`INSERT INTO desktop_sync_vault(space_id,kind,remote_id,local_id) VALUES(?,'ai_session',?,?)`, spaceID, uuid.NewString(), localID)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE desktop_ai_sessions SET config_space_id=? WHERE id=?`, spaceID, localID); err != nil {
		return err
	}
	return tx.Commit()
}
