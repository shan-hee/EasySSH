package datasync

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/provider"
	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/server/internal/domain/aiconfig"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sshkey"
	"github.com/easyssh/shared/aichatui"
	sharedconfig "github.com/easyssh/shared/aiconfig"
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
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Preload("Auth.SSHKey").First(&row, "id=?", id).Error; err != nil {
			return nil, err
		}
		p.UpdatedAt = row.UpdatedAt
		if row.Auth.Password == "" && row.Auth.SSHKeyID == nil {
			var n int64
			tx.Model(&VaultDocument{}).Where("owner_id=? AND kind=? AND resource_id=? AND observed_ref<>''", owner, kind, id).Count(&n)
			if n == 0 {
				return nil, nil
			}
		}
		password, err := s.Encryptor.DecryptSecret(row.Auth.Password, row.CredentialAAD("password"))
		if err != nil {
			return nil, err
		}
		p.Credential = &syncdata.Credential{Connection: syncdata.JSON(connectionSnapshot(row)), Password: password}
		if key := row.Auth.SSHKey; key != nil {
			material, err := s.Encryptor.DecryptSecret(key.PrivateKey, key.PrivateKeyAAD())
			if err != nil {
				return nil, err
			}
			phrase, err := s.Encryptor.DecryptSecret(key.SavedPassphrase, key.PassphraseAAD())
			if err != nil {
				return nil, err
			}
			p.Credential.Key = &syncdata.KeyMaterial{ID: key.ID.String(), SavedPassphrase: phrase, Name: key.Name, PublicKey: key.PublicKey, PrivateKey: material, Fingerprint: key.Fingerprint, Algorithm: key.Algorithm, KeySize: key.KeySize, PassphraseRequired: key.PassphraseRequired}
		}
	case "ai_config":
		if id != syncdata.AIConfigID {
			return nil, errors.New("invalid AI config ID")
		}
		var row aiconfig.Config
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, aiconfig.ConfigID).Error
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		p.UpdatedAt = row.UpdatedAt
		key, err := s.Encryptor.DecryptSecret(row.APIKey, aiconfig.APIKeyAAD())
		if err != nil {
			return nil, err
		}
		p.AIConfig = &protocol.AIConfigValue{Enabled: row.Enabled, Provider: row.Provider, Endpoint: row.Endpoint, APIKey: key, Models: append([]string{}, row.Models...)}
	case "ai_session":
		var row runtime.AISessionRecord
		err := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id=?", id).Error
		if err == gorm.ErrRecordNotFound {
			var count int64
			if e := tx.Model(&VaultDocument{}).Where("owner_id=? AND kind=? AND resource_id=? AND observed_ref<>''", owner, kind, id).Count(&count).Error; e != nil {
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
		if row.Actor.Kind != protocol.Owner || row.Actor.ID != owner.String() {
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
		snapshot, err := runtime.LoadSessionSnapshot(tx, row, s.Content)
		if err != nil {
			return nil, err
		}
		c := &syncdata.Conversation{Title: row.Title, Model: row.Model, CreatedAt: row.CreatedAt, Messages: snapshot.MessageViews}
		for _, task := range snapshot.Tasks {
			c.Tasks = append(c.Tasks, task.View)
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
		if err := tx.Preload("Auth.SSHKey").First(&row, "id=?", id).Error; err != nil {
			return err
		}
		c := p.Credential
		binding := syncdata.JSON(connectionSnapshot(row))
		if !syncdata.SameConnection(binding, c.Connection) {
			return errors.New("credential target changed; resolve connection settings first")
		}
		previousPassword, err := s.Encryptor.DecryptSecret(row.Auth.Password, row.CredentialAAD("password"))
		if err != nil {
			return err
		}
		password := row.Auth.Password
		if previousPassword != c.Password {
			password, err = s.Encryptor.EncryptSecret(c.Password, row.CredentialAAD("password"))
			if err != nil {
				return err
			}
		}
		var keyID *uuid.UUID
		if k := c.Key; k != nil {
			key, err := sshkey.MergeSyncKey(tx, s.Encryptor, k)
			if err != nil {
				return err
			}
			keyID = &key.ID
		}
		row.Auth.Password = password
		var previousKey server.ServerAuth
		if err := tx.Preload("SSHKey").First(&previousKey, "server_id=?", row.ID).Error; err != nil {
			return err
		}
		oldFingerprint := ""
		if previousKey.SSHKey != nil {
			oldFingerprint = previousKey.SSHKey.Fingerprint
		}
		nextFingerprint := ""
		if c.Key != nil {
			nextFingerprint = c.Key.Fingerprint
		}
		fields := []string{}
		if oldFingerprint != nextFingerprint {
			fields = append(fields, "ssh_key_id")
		}
		if previousPassword != c.Password {
			fields = append(fields, "password")
		}
		if oldFingerprint != nextFingerprint {
			if err := tx.Model(&server.Server{}).Where("id=?", row.ID).UpdateColumn("connection_revision", gorm.Expr("connection_revision + 1")).Error; err != nil {
				return err
			}
		}
		if len(fields) > 0 {
			if _, err := server.InvalidateJumpDependents(tx, row.ID); err != nil {
				return err
			}
		}
		row.Auth.SSHKeyID = keyID
		if err := row.SaveAuth(tx); err != nil {
			return err
		}
		if err := tx.Model(&row).Update("updated_at", time.Now().UTC()).Error; err != nil {
			return err
		}
		if len(fields) == 0 {
			return nil
		}
		return recordSyncConfiguration(tx, "server", row.ID.String(), row.Name, "update", fields,
			[]operationrecord.ResourceSnapshot{{ServerID: row.ID, Name: row.Name}})
	case "ai_config":
		c := p.AIConfig
		input, err := sharedconfig.NormalizeInput(protocol.AIConfigInput{Enabled: c.Enabled, Provider: c.Provider, Endpoint: c.Endpoint, APIKey: &c.APIKey, Models: c.Models}, protocol.AIConfigInput{})
		if err != nil {
			return err
		}
		key, err := s.Encryptor.EncryptSecret(*input.APIKey, aiconfig.APIKeyAAD())
		if err != nil {
			return err
		}
		return aiconfig.NewRepository(tx, s.Encryptor).Save(tx.Statement.Context, &aiconfig.Config{ID: aiconfig.ConfigID, Enabled: input.Enabled, Provider: input.Provider, Endpoint: input.Endpoint, APIKey: key, Models: input.Models})
	case "ai_session":
		var row runtime.AISessionRecord
		err := tx.Unscoped().Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id=?", id).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		if err == nil && (row.Actor.Kind != protocol.Owner || row.Actor.ID != owner.String()) {
			return errors.New("conversation belongs to another owner")
		}
		if p.Deleted {
			if errors.Is(err, gorm.ErrRecordNotFound) || row.DeletedAt.Valid {
				return nil
			}
			return runtime.NewGormSessionStore(tx, s.Content).Delete(tx.Statement.Context, row.Actor, id)
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
				tx.Model(&server.Server{}).Where("id=?", ref.ServerID).Count(&n)
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
		actor := row.Actor
		if !actor.Valid() {
			actor = protocol.Actor{Kind: protocol.Owner, ID: owner.String(), SessionID: "sync-import"}
		}
		created := c.CreatedAt
		if created.IsZero() {
			created = time.Now().UTC()
		}
		return runtime.ReplaceSyncedSession(tx, runtime.SessionSnapshot{
			ID: id, Actor: actor, Title: c.Title, Model: c.Model, CreatedAt: created, UpdatedAt: time.Now().UTC(),
			Messages: messages, MessageViews: c.Messages, Tasks: tasks, TaskOrder: order,
		}, s.Content)
	}
	return errors.New("invalid vault kind")
}
