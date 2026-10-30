package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/easyssh/shared/aichatui"
	sharedconfig "github.com/easyssh/shared/aiconfig"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"slices"
)

func (s *DesktopSyncService) captureLocalVault(tx *sql.Tx, v DesktopVaultState) (*syncdata.VaultPayload, error) {
	p := &syncdata.VaultPayload{Kind: v.Kind, Source: "desktop"}
	switch v.Kind {
	case "credential":
		var host, user, method, encrypted, updated string
		var port int
		var keyID sql.NullString
		err := tx.QueryRow(`SELECT host,port,username,auth_method,password,ssh_key_id,updated_at FROM desktop_server_details WHERE id=?`, v.LocalID).Scan(&host, &port, &user, &method, &encrypted, &keyID, &updated)
		if err == sql.ErrNoRows {
			return nil, errors.New("credential target no longer exists")
		}
		if err != nil {
			return nil, err
		}
		p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		if encrypted == "" && !keyID.Valid && v.ObservedRef == "" {
			return nil, nil
		}
		password, err := decryptDesktopCredential(encrypted, "desktop_server_auth", v.LocalID, "password")
		if err != nil {
			return nil, err
		}
		p.Credential = &syncdata.Credential{Connection: syncdata.JSON(syncdata.Connection{Host: host, Port: port, Username: user, AuthMethod: method}), Password: password}
		if keyID.Valid {
			var k syncdata.KeyMaterial
			var enc, phrase string
			err = tx.QueryRow(`SELECT id,name,public_key,private_key,fingerprint,algorithm,key_size,passphrase_required,saved_passphrase FROM desktop_ssh_keys WHERE id=?`, keyID.String).Scan(&k.ID, &k.Name, &k.PublicKey, &enc, &k.Fingerprint, &k.Algorithm, &k.KeySize, &k.PassphraseRequired, &phrase)
			if err != nil {
				return nil, err
			}
			k.PrivateKey, err = decryptDesktopCredential(enc, "desktop_ssh_keys", k.ID, "private_key")
			if err != nil {
				return nil, err
			}
			k.SavedPassphrase, err = decryptDesktopCredential(phrase, "desktop_ssh_keys", k.ID, "saved_passphrase")
			if err != nil {
				return nil, err
			}
			p.Credential.Key = &k
			connection := syncdata.Connection{Host: host, Port: port, Username: user, AuthMethod: method, Key: &syncdata.KeyReference{ID: k.ID, Name: k.Name, PublicKey: k.PublicKey, Fingerprint: k.Fingerprint, Algorithm: k.Algorithm, KeySize: k.KeySize}}
			p.Credential.Connection = syncdata.JSON(connection)
		}
	case "ai_config":
		var c protocol.AIConfigValue
		var encrypted, updated, models string
		err := tx.QueryRow(`SELECT enabled,provider,endpoint,api_key,models,updated_at FROM desktop_ai_config WHERE id=?`, v.SpaceID).Scan(&c.Enabled, &c.Provider, &c.Endpoint, &encrypted, &models, &updated)
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
		c.APIKey, err = decryptDesktopCredential(encrypted, "desktop_ai_config", v.SpaceID, "api_key")
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(models), &c.Models); err != nil {
			return nil, err
		}
		p.AIConfig = &c
	case "ai_session":
		record, err := loadDesktopAISession(tx, v.LocalID)
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
		if record.Status == DesktopAISessionRunning || record.Status == DesktopAISessionWaitingConfirmation {
			return nil, errors.New("conversation is busy")
		}
		p.UpdatedAt, _ = time.Parse(time.RFC3339Nano, record.UpdatedAt)
		// An empty sync title means automatic naming on both clients.
		title := ""
		if record.CustomTitle {
			title = record.Title
		}
		c := &syncdata.Conversation{Title: strings.TrimSpace(title), Model: record.Model,
			Messages: toAichatUIMessages(record.Messages), Tasks: toAichatUITasks(record.Tasks)}
		c.CreatedAt, _ = time.Parse(time.RFC3339Nano, record.CreatedAt)
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
func (s *DesktopSyncService) applyLocalVault(tx *sql.Tx, v DesktopVaultState, p syncdata.VaultPayload, source string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	switch v.Kind {
	case "credential":
		var host, user, method string
		var port int
		if err := tx.QueryRow(`SELECT host,port,username,auth_method FROM desktop_server_details WHERE id=?`, v.LocalID).Scan(&host, &port, &user, &method); err != nil {
			return err
		}
		c := p.Credential
		binding := syncdata.Connection{Host: host, Port: port, Username: user, AuthMethod: method}
		var ref syncdata.KeyReference
		err := tx.QueryRow(`SELECT k.id,k.name,k.public_key,k.fingerprint,k.algorithm,k.key_size FROM desktop_server_auth a JOIN desktop_ssh_keys k ON k.id=a.ssh_key_id WHERE a.server_id=?`, v.LocalID).Scan(&ref.ID, &ref.Name, &ref.PublicKey, &ref.Fingerprint, &ref.Algorithm, &ref.KeySize)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if err == nil {
			binding.Key = &ref
		}
		if !syncdata.SameConnection(syncdata.JSON(binding), c.Connection) {
			return errors.New("credential target changed; resolve connection settings first")
		}
		var priorPassword, name, serverHost string
		var priorKey sql.NullString
		if err := tx.QueryRow(`SELECT s.name,s.host,a.password,a.ssh_key_id FROM desktop_servers s JOIN desktop_server_auth a ON a.server_id=s.id WHERE s.id=?`, v.LocalID).Scan(&name, &serverHost, &priorPassword, &priorKey); err != nil {
			return err
		}
		priorPassword, err = decryptDesktopCredential(priorPassword, "desktop_server_auth", v.LocalID, "password")
		if err != nil {
			return err
		}
		password, err := encryptDesktopCredential(c.Password, "desktop_server_auth", v.LocalID, "password")
		if err != nil {
			return err
		}
		var keyID *string
		if k := c.Key; k != nil {
			id, err := mergeDesktopSyncKey(tx, k)
			if err != nil {
				return err
			}
			keyID = &id
		}

		var priorFingerprint string
		if err = tx.QueryRow(`SELECT COALESCE(k.fingerprint,'') FROM desktop_server_auth a LEFT JOIN desktop_ssh_keys k ON k.id=a.ssh_key_id WHERE a.server_id=?`, v.LocalID).Scan(&priorFingerprint); err != nil {
			return err
		}
		nextFingerprint := ""
		if c.Key != nil {
			nextFingerprint = c.Key.Fingerprint
		}
		delta := 0
		if priorFingerprint != nextFingerprint {
			delta = 1
		}
		fields := []string{}
		if priorPassword != c.Password {
			fields = append(fields, "password")
		}
		if !desktopSameSSHKey(desktopSSHKeyID(priorKey), keyID) {
			fields = append(fields, "ssh_key_id")
		}
		if len(fields) == 0 {
			return nil
		}
		if _, err = tx.Exec(`UPDATE desktop_server_auth SET password=?,ssh_key_id=? WHERE server_id=?`, password, keyID, v.LocalID); err != nil {
			return err
		}
		_, err = tx.Exec(`UPDATE desktop_servers SET updated_at=?,connection_revision=connection_revision+? WHERE id=?`, now, delta, v.LocalID)
		if err != nil {
			return err
		}
		if name == "" {
			name = serverHost
		}
		return recordDesktopConfiguration(tx, "server_credentials_updated", "server", v.LocalID, name, source, fields, nil)
	case "ai_config":
		c := p.AIConfig
		input, err := sharedconfig.NormalizeInput(protocol.AIConfigInput{Enabled: c.Enabled, Provider: c.Provider, Endpoint: c.Endpoint, APIKey: &c.APIKey, Models: c.Models}, protocol.AIConfigInput{})
		if err != nil {
			return err
		}
		current, err := loadDesktopAIConfig(tx, v.SpaceID)
		if err != nil {
			return err
		}
		fields := []string{}
		for _, f := range []struct {
			name    string
			changed bool
		}{
			{"enabled", current.Enabled != input.Enabled}, {"provider", current.Provider != input.Provider},
			{"endpoint", current.Endpoint != input.Endpoint}, {"api_key", current.APIKey != *input.APIKey},
			{"models", !slices.Equal(current.Models, input.Models)},
		} {
			if f.changed {
				fields = append(fields, f.name)
			}
		}
		if len(fields) == 0 && current.Stored {
			return nil
		}
		enc, err := encryptDesktopCredential(*input.APIKey, "desktop_ai_config", v.SpaceID, "api_key")
		if err != nil {
			return err
		}
		models, err := json.Marshal(input.Models)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO desktop_ai_config(id,enabled,provider,endpoint,api_key,models,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,provider=excluded.provider,endpoint=excluded.endpoint,api_key=excluded.api_key,models=excluded.models,updated_at=excluded.updated_at`, v.SpaceID, input.Enabled, input.Provider, input.Endpoint, enc, string(models), now)
		if err != nil {
			return err
		}
		return recordDesktopConfiguration(tx, "ai_config_updated", "ai_config", v.SpaceID, "AI 配置", source, fields, nil)
	case "ai_session":
		if p.Deleted {
			return deleteDesktopAISession(context.Background(), tx, v.LocalID)
		}
		c := p.Conversation
		syncdata.NormalizeConversation(c)
		if err := syncdata.HydrateAttachments(c, func(id string) (string, error) { return localObject(tx, v.SpaceID, id) }); err != nil {
			return err
		}
		title := strings.TrimSpace(c.Title)
		customTitle := title != ""
		for i := range c.Messages {
			if title == "" && c.Messages[i].Role == "user" {
				title = aichatui.SessionTitleFromContent(c.Messages[i].Content)
			}
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
		created := c.CreatedAt.UTC().Format(desktopAITimeLayout)
		if c.CreatedAt.IsZero() {
			created = now
		}
		record := desktopAISessionRecord{
			ID: v.LocalID, ConfigSpaceID: v.SpaceID, Title: title, CustomTitle: customTitle,
			Model: c.Model, PermissionMode: DesktopAIPermissionReadonly, Status: DesktopAISessionIdle,
			CreatedAt: created, UpdatedAt: time.Now().UTC().Format(desktopAITimeLayout),
			Messages: fromAichatUIMessages(c.Messages), Tasks: fromAichatUITasks(c.Tasks),
		}
		// An imported conversation cannot grant automatic execution authority,
		// even when the sender omits its external-content markers.
		for i := range record.Messages {
			record.Messages[i].ExternalContent = true
		}
		// Sync imports only public history; no native execution provenance enters
		// the shared write path. Existing execution facts remain independent.
		if err := saveDesktopAISession(context.Background(), tx, record); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE desktop_ai_sessions SET config_space_id=? WHERE id=?`, v.SpaceID, v.LocalID)
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
	local, err := loadDesktopAIConfig(tx, "local")
	if err != nil {
		return err
	}
	c := protocol.AIConfigValue{Enabled: local.Enabled, Provider: local.Provider, Endpoint: local.Endpoint, APIKey: local.APIKey, Models: append([]string{}, local.Models...)}
	v := DesktopVaultState{SpaceID: spaceID, Kind: "ai_config", ID: syncdata.AIConfigID}
	if err = s.applyLocalVault(tx, v, syncdata.VaultPayload{Kind: "ai_config", AIConfig: &c}, "manual"); err != nil {
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
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
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
		if err = s.applyLocalVault(tx, DesktopVaultState{SpaceID: spaceID, Kind: "ai_session", ID: source.ID, LocalID: localID}, *payload, "manual"); err != nil {
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
	var title string
	if err = tx.QueryRow(`SELECT title FROM desktop_ai_sessions WHERE id=?`, localID).Scan(&title); err != nil {
		return err
	}
	if err = recordDesktopConfiguration(tx, "ai_session_sync_enrolled", "ai_session", localID, title, "manual", []string{"sync_space_id"}, nil); err != nil {
		return err
	}
	return tx.Commit()
}
