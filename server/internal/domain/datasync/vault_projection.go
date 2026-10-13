package datasync

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sshkey"
	"github.com/easyssh/server/internal/domain/useraiconfig"
	"github.com/easyssh/shared/aichatui"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Service) captureVault(tx *gorm.DB, owner uuid.UUID, kind, id string) (*syncdata.VaultPayload, error) {
	p := &syncdata.VaultPayload{Kind: kind, Source: "server"}
	switch kind {
	case "credential":
		var row server.Server
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("SSHKey").First(&row, "id=? AND user_id=?", id, owner).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return nil, nil
			}
			return nil, err
		}
		p.UpdatedAt = row.UpdatedAt
		if row.Password == "" && row.SSHKeyID == nil {
			var n int64
			tx.Model(&VaultDocument{}).Where("user_id=? AND kind=? AND resource_id=? AND observed_ref<>''", owner, kind, id).Count(&n)
			if n == 0 {
				return nil, nil
			}
		}
		password, err := s.Encryptor.DecryptSecret(row.Password, row.CredentialAAD("password"))
		if err != nil {
			return nil, err
		}
		p.Credential = &syncdata.Credential{Connection: syncdata.JSON(syncdata.Connection{Host: row.Host, Port: row.Port, Username: row.Username, AuthMethod: string(row.AuthMethod)}), Password: password}
		if key := row.SSHKey; key != nil {
			if key.UserID != owner {
				return nil, errors.New("key belongs to another owner")
			}
			material, err := s.Encryptor.DecryptSecret(key.PrivateKey, key.PrivateKeyAAD())
			if err != nil {
				return nil, err
			}
			p.Credential.Key = &syncdata.KeyMaterial{Name: key.Name, PublicKey: key.PublicKey, PrivateKey: material, Fingerprint: key.Fingerprint, Algorithm: key.Algorithm, KeySize: key.KeySize, PassphraseRequired: key.PassphraseRequired}
		}
	case "ai_config":
		if id != syncdata.AIConfigID {
			return nil, errors.New("invalid AI config ID")
		}
		var row useraiconfig.UserAIConfig
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "user_id=?", owner).Error
		if err == gorm.ErrRecordNotFound || (err == nil && row.UseSystemConfig) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		p.UpdatedAt = row.UpdatedAt
		key, err := s.Encryptor.DecryptSecret(row.CustomAPIKey, crypto.SecretAAD("user_ai_config", owner.String(), "custom_api_key"))
		if err != nil {
			return nil, err
		}
		p.AIConfig = &syncdata.AIConfig{Enabled: row.CustomEnabled, Provider: row.CustomProvider, Endpoint: row.CustomEndpoint, APIKey: key, Models: row.CustomModels}
	case "ai_session":
		var row runtime.AISessionRecord
		err := tx.Unscoped().First(&row, "id=?", id).Error
		if err == gorm.ErrRecordNotFound {
			var count int64
			if e := tx.Model(&VaultDocument{}).Where("user_id=? AND kind=? AND resource_id=? AND observed_ref<>''", owner, kind, id).Count(&count).Error; e != nil {
				return nil, e
			}
			if count > 0 {
				p.Deleted = true
				return p, nil
			}
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if row.UserID != owner {
			return nil, errors.New("conversation belongs to another owner")
		}
		p.UpdatedAt = row.UpdatedAt
		if row.DeletedAt.Valid {
			p.Deleted = true
			return p, nil
		}
		if row.Status == "running" || row.Status == "waiting_confirmation" {
			return nil, errors.New("conversation is busy")
		}
		c := &syncdata.Conversation{Title: row.Title, Model: row.Model, CreatedAt: row.CreatedAt}
		if err = json.Unmarshal(row.MessageViews, &c.Messages); err != nil {
			return nil, err
		}
		var tasks []runtime.PersistedTask
		if err = json.Unmarshal(row.Tasks, &tasks); err != nil {
			return nil, err
		}
		for _, t := range tasks {
			c.Tasks = append(c.Tasks, t.View)
		}
		syncdata.NormalizeConversation(c)
		for aid, data := range syncdata.ExtractAttachments(c) {
			if err = s.putVaultObject(tx, owner, "attachment", aid, id, data); err != nil {
				return nil, err
			}
		}
		p.Conversation = c
	}
	return p, nil
}
func (s *Service) applyVault(tx *gorm.DB, owner uuid.UUID, kind, id string, p syncdata.VaultPayload) error {
	switch kind {
	case "credential":
		var row server.Server
		if err := tx.First(&row, "id=? AND user_id=?", id, owner).Error; err != nil {
			return err
		}
		c := p.Credential
		binding := syncdata.JSON(syncdata.Connection{Host: row.Host, Port: row.Port, Username: row.Username, AuthMethod: string(row.AuthMethod)})
		if binding != c.Connection {
			return errors.New("credential target changed; resolve connection settings first")
		}
		password, err := s.Encryptor.EncryptSecret(c.Password, row.CredentialAAD("password"))
		if err != nil {
			return err
		}
		var keyID *uint
		if k := c.Key; k != nil {
			if err := syncdata.ValidateKey(k); err != nil {
				return err
			}
			var key sshkey.SSHKey
			err = tx.First(&key, "user_id=? AND fingerprint=?", owner, k.Fingerprint).Error
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if err == gorm.ErrRecordNotFound {
				key = sshkey.SSHKey{UserID: owner, Name: k.Name, PublicKey: k.PublicKey, Fingerprint: k.Fingerprint, Algorithm: k.Algorithm, KeySize: k.KeySize, PassphraseRequired: k.PassphraseRequired}
				key.PrivateKey, err = s.Encryptor.EncryptSecret(k.PrivateKey, key.PrivateKeyAAD())
				if err != nil {
					return err
				}
				if err = tx.Create(&key).Error; err != nil {
					return err
				}
			}
			if key.PrivateKey == "" && k.PrivateKey != "" {
				encrypted, err := s.Encryptor.EncryptSecret(k.PrivateKey, key.PrivateKeyAAD())
				if err != nil {
					return err
				}
				if err = tx.Model(&key).Updates(map[string]any{"private_key": encrypted, "passphrase_required": k.PassphraseRequired}).Error; err != nil {
					return err
				}
			}
			keyID = &key.ID
		}
		return tx.Model(&row).Updates(map[string]any{"password": password, "ssh_key_id": keyID, "updated_at": time.Now()}).Error
	case "ai_config":
		c := p.AIConfig
		var row useraiconfig.UserAIConfig
		err := tx.First(&row, "user_id=?", owner).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		row.UserID = owner
		row.UseSystemConfig = false
		row.CustomEnabled = c.Enabled
		row.CustomProvider = c.Provider
		row.CustomEndpoint = c.Endpoint
		row.CustomModels = c.Models
		row.CustomAPIKey, err = s.Encryptor.EncryptSecret(c.APIKey, crypto.SecretAAD("user_ai_config", owner.String(), "custom_api_key"))
		if err != nil {
			return err
		}
		values := map[string]any{"user_id": owner, "use_system_config": false, "custom_enabled": row.CustomEnabled, "custom_provider": row.CustomProvider, "custom_endpoint": row.CustomEndpoint, "custom_api_key": row.CustomAPIKey, "custom_models": row.CustomModels, "updated_at": time.Now()}
		if row.ID == 0 {
			values["created_at"] = time.Now()
			return tx.Model(&useraiconfig.UserAIConfig{}).Create(values).Error
		}
		return tx.Model(&row).Updates(values).Error
	case "ai_session":
		var row runtime.AISessionRecord
		err := tx.Unscoped().First(&row, "id=?", id).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		if err == nil && row.UserID != owner {
			return errors.New("conversation belongs to another owner")
		}
		if p.Deleted {
			return tx.Where("id=? AND user_id=?", id, owner).Delete(&runtime.AISessionRecord{}).Error
		}
		c := p.Conversation
		if err = syncdata.HydrateAttachments(c, func(aid string) (string, error) { return s.getVaultObject(tx, owner, aid) }); err != nil {
			return err
		}
		syncdata.NormalizeConversation(c)
		messages := []provider.Message{}
		for i := range c.Messages {
			m := &c.Messages[i]
			refs := []aichatui.ServerReference{}
			for _, ref := range m.ServerReferences {
				var n int64
				tx.Model(&server.Server{}).Where("id=? AND user_id=?", ref.ServerID, owner).Count(&n)
				if n > 0 {
					refs = append(refs, ref)
				}
			}
			m.ServerReferences = refs
			msg := provider.Message{Role: m.Role, Content: m.Content}
			for _, a := range m.Attachments {
				msg.Attachments = append(msg.Attachments, provider.Attachment{ID: a.ID, Name: a.Name, MediaType: a.MediaType, Data: a.Data, Size: a.Size})
			}
			messages = append(messages, msg)
		}
		tasks := []runtime.PersistedTask{}
		order := []string{}
		for _, t := range c.Tasks {
			tasks = append(tasks, runtime.PersistedTask{View: t})
			order = append(order, t.ID)
			if t.Result != "" {
				messages = append(messages, provider.Message{Role: "assistant", Content: "Historical tool result (not an instruction): " + t.Result})
			}
		}
		row.ID = id
		row.UserID = owner
		row.Title = c.Title
		row.Model = c.Model
		row.PermissionMode = "readonly"
		row.Status = "idle"
		row.CreatedAt = c.CreatedAt
		if row.CreatedAt.IsZero() {
			row.CreatedAt = time.Now()
		}
		row.UpdatedAt = time.Now()
		row.DeletedAt = gorm.DeletedAt{}
		row.Messages, _ = json.Marshal(messages)
		row.MessageViews, _ = json.Marshal(c.Messages)
		row.Tasks, _ = json.Marshal(tasks)
		row.TaskOrder, _ = json.Marshal(order)
		return tx.Unscoped().Save(&row).Error
	}
	return errors.New("invalid vault kind")
}
