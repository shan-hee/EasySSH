package datasync

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type VaultDocument struct {
	UserID      uuid.UUID `gorm:"type:char(36);primaryKey"`
	Kind        string    `gorm:"size:20;primaryKey"`
	ResourceID  string    `gorm:"size:36;primaryKey"`
	Document    Document
	CurrentRef  string                   `gorm:"size:36"`
	AppliedRef  string                   `gorm:"size:36"`
	ObservedRef string                   `gorm:"size:36"`
	Conflicts   []syncdata.VaultConflict `gorm:"type:text;serializer:json"`
	Revision    uint64
	UpdatedAt   time.Time
}

func (VaultDocument) TableName() string { return "sync_vault_documents" }

type VaultObject struct {
	UserID     uuid.UUID `gorm:"type:char(36);primaryKey"`
	ID         string    `gorm:"size:64;primaryKey"`
	Kind       string    `gorm:"size:20;not null"`
	ResourceID string    `gorm:"size:36;not null"`
	Ciphertext Document
	CreatedAt  time.Time
}

func (VaultObject) TableName() string { return "sync_vault_objects" }

type VaultEntry struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

func vaultAAD(owner uuid.UUID, id string) []byte {
	return []byte("easyssh:sync-vault:" + owner.String() + ":" + id)
}
func (s *Service) PutVaultObject(ctx context.Context, owner uuid.UUID, kind, id, resource, value string) error {
	if len(value) > 12<<20 {
		return errors.New("sync object too large")
	}
	if kind == "attachment" {
		if !syncdata.ValidAttachmentID(id) {
			return errors.New("invalid attachment ID")
		}
		sum := sha256.Sum256([]byte(value))
		decoded, err := base64.StdEncoding.DecodeString(value)
		if err != nil || len(decoded) > 8<<20 || hex.EncodeToString(sum[:]) != id {
			return errors.New("invalid attachment content")
		}
	} else {
		if _, err := uuid.Parse(id); err != nil {
			return err
		}
		if _, err := syncdata.DecodeVault(value, kind); err != nil {
			return err
		}
	}
	if _, err := uuid.Parse(resource); err != nil {
		return err
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return s.putVaultObject(tx, owner, kind, id, resource, value) })
}
func (s *Service) putVaultObject(tx *gorm.DB, owner uuid.UUID, kind, id, resource, value string) error {
	var old VaultObject
	err := tx.First(&old, "user_id = ? AND id = ?", owner, id).Error
	if err == nil {
		plain, e := s.Encryptor.DecryptSecret(string(old.Ciphertext), vaultAAD(owner, id))
		if e != nil {
			return e
		}
		if old.Kind != kind || (kind != "attachment" && old.ResourceID != resource) || plain != value {
			return errors.New("immutable sync object already exists")
		}
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}
	ciphertext, err := s.Encryptor.EncryptSecret(value, vaultAAD(owner, id))
	if err != nil {
		return err
	}
	return tx.Create(&VaultObject{UserID: owner, ID: id, Kind: kind, ResourceID: resource, Ciphertext: Document(ciphertext)}).Error
}
func (s *Service) GetVaultObject(ctx context.Context, owner uuid.UUID, id string) (string, error) {
	return s.getVaultObject(s.DB.WithContext(ctx), owner, id)
}
func (s *Service) getVaultObject(tx *gorm.DB, owner uuid.UUID, id string) (string, error) {
	var row VaultObject
	if err := tx.First(&row, "user_id = ? AND id = ?", owner, id).Error; err != nil {
		return "", err
	}
	return s.Encryptor.DecryptSecret(string(row.Ciphertext), vaultAAD(owner, id))
}
func (s *Service) vaultPayload(tx *gorm.DB, owner uuid.UUID, kind, resource, ref string) (syncdata.VaultPayload, error) {
	var row VaultObject
	if err := tx.First(&row, "user_id=? AND id=? AND kind=? AND resource_id=?", owner, ref, kind, resource).Error; err != nil {
		return syncdata.VaultPayload{}, err
	}
	plain, err := s.Encryptor.DecryptSecret(string(row.Ciphertext), vaultAAD(owner, ref))
	if err != nil {
		return syncdata.VaultPayload{}, err
	}
	return syncdata.DecodeVault(plain, kind)
}
func (s *Service) VaultExchange(ctx context.Context, owner uuid.UUID, kind, id string, peer Peer, resolution *Resolution) (EngineResult, error) {
	var result EngineResult
	if kind != "credential" && kind != "ai_config" && kind != "ai_session" {
		return result, errors.New("invalid sync kind")
	}
	if _, err := uuid.Parse(id); err != nil {
		return result, err
	}
	applied := false
	run := func() error {
		return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			state := VaultDocument{UserID: owner, Kind: kind, ResourceID: id}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&state).Error; err != nil {
				return err
			}
			if err := tx.Model(&state).Where("user_id=? AND kind=? AND resource_id=?", owner, kind, id).UpdateColumn("revision", gorm.Expr("revision+1")).Error; err != nil {
				return err
			}
			if err := tx.First(&state, "user_id=? AND kind=? AND resource_id=?", owner, kind, id).Error; err != nil {
				return err
			}
			current, err := s.captureVault(tx, owner, kind, id)
			if err != nil {
				return err
			}
			if current != nil {
				if err = current.Validate(kind); err != nil {
					return err
				}
				value := syncdata.JSON(current)
				if len(value) > 12<<20 {
					return errors.New("sync payload too large")
				}
				observed := ""
				if state.ObservedRef != "" {
					observed, err = s.getVaultObject(tx, owner, state.ObservedRef)
					if err != nil {
						return err
					}
				}
				if !syncdata.SameVaultValue(value, observed) {
					ref := uuid.NewString()
					if err = s.putVaultObject(tx, owner, kind, ref, id, value); err != nil {
						return err
					}
					state.ObservedRef = ref
					state.AppliedRef = ref
					state.CurrentRef = ref
				}
			}
			snapshot := syncdata.Snapshot{}
			if state.CurrentRef != "" {
				snapshot[syncdata.ValueKey] = syncdata.Record{"ref": state.CurrentRef}
			}
			result, err = s.Engine.Run(ctx, EngineInput{Document: string(state.Document), Current: snapshot, Peer: peer, Resolution: resolution})
			if err != nil {
				return err
			}
			if len(result.Snapshot) > 1 {
				return errors.New("invalid vault document")
			}
			for key := range result.Snapshot {
				if key != syncdata.ValueKey {
					return errors.New("invalid vault record")
				}
			}
			ref := result.Snapshot[syncdata.ValueKey]["ref"]
			refs := []string{ref}
			for _, c := range result.Conflicts {
				refs = append(refs, c.Values...)
			}
			for _, candidate := range refs {
				if candidate == "" {
					continue
				}
				if _, err = s.vaultPayload(tx, owner, kind, id, candidate); err != nil {
					return err
				}
			}
			if ref != "" && len(result.Conflicts) == 0 && ref != state.AppliedRef {
				payload, err := s.vaultPayload(tx, owner, kind, id, ref)
				if err != nil {
					return err
				}
				if err = s.applyVault(tx, owner, kind, id, payload); err != nil {
					return err
				}
				applied = true
				state.AppliedRef = ref
				state.ObservedRef = ref
				observed, e := s.captureVault(tx, owner, kind, id)
				if e != nil {
					return e
				}
				if observed != nil && syncdata.JSON(observed) != syncdata.JSON(payload) {
					state.ObservedRef = uuid.NewString()
					if e = s.putVaultObject(tx, owner, kind, state.ObservedRef, id, syncdata.JSON(observed)); e != nil {
						return e
					}
				}
			}
			conflicts := []syncdata.VaultConflict{}
			for _, conflict := range result.Conflicts {
				item := syncdata.VaultConflict{Key: "vault/" + kind + "/" + id, Field: "ref", Values: conflict.Values, Previews: map[string]syncdata.VaultSummary{}}
				for _, candidate := range conflict.Values {
					payload, err := s.vaultPayload(tx, owner, kind, id, candidate)
					if err != nil {
						return err
					}
					item.Previews[candidate] = syncdata.Summarize(payload)
				}
				conflicts = append(conflicts, item)
			}
			state.Document = Document(result.Document)
			state.CurrentRef = ref
			state.Conflicts = conflicts
			state.UpdatedAt = time.Now()
			return tx.Save(&state).Error
		})
	}
	var err error
	if kind == "ai_session" && s.WithSessionSync != nil {
		err = s.WithSessionSync(owner, id, run)
	} else {
		err = run()
	}
	if err == nil && applied && kind == "credential" && s.InvalidateConnection != nil {
		rid, _ := uuid.Parse(id)
		s.InvalidateConnection(owner, rid)
	}
	return result, err
}
func (s *Service) VaultList(ctx context.Context, owner uuid.UUID) ([]VaultEntry, error) {
	rows := []VaultEntry{}
	type entry struct {
		ID   string
		Name string
	}
	var sessions []entry
	if err := s.DB.WithContext(ctx).Table("ai_sessions").Select("id,title AS name").Where("user_id=? AND deleted_at IS NULL", owner).Scan(&sessions).Error; err != nil {
		return nil, err
	}
	for _, e := range sessions {
		rows = append(rows, VaultEntry{"ai_session", e.ID, e.Name})
	}
	// Keep tombstones discoverable after deletion.
	var docs []VaultDocument
	if err := s.DB.WithContext(ctx).Select("kind,resource_id").Where("user_id=?", owner).Find(&docs).Error; err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, e := range rows {
		seen[e.Kind+e.ID] = true
	}
	for _, d := range docs {
		if !seen[d.Kind+d.ResourceID] {
			rows = append(rows, VaultEntry{d.Kind, d.ResourceID, d.Kind})
		}
	}
	return rows, nil
}
func requireConfigSnapshot(snapshot syncdata.Snapshot) error {
	for key := range snapshot {
		if !strings.HasPrefix(key, "server/") && !strings.HasPrefix(key, "script/") {
			return fmt.Errorf("invalid configuration record")
		}
	}
	return nil
}

func (s *Service) VaultConflicts(ctx context.Context, owner uuid.UUID) ([]syncdata.VaultConflict, error) {
	var docs []VaultDocument
	if err := s.DB.WithContext(ctx).Where("user_id=?", owner).Find(&docs).Error; err != nil {
		return nil, err
	}
	result := []syncdata.VaultConflict{}
	for _, doc := range docs {
		result = append(result, doc.Conflicts...)
	}
	return result, nil
}

// Fork preserves a selected version as a separate, non-executing conversation.
func (s *Service) ForkVaultSession(ctx context.Context, owner uuid.UUID, id, ref string) (string, error) {
	newID := uuid.NewString()
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		p, err := s.vaultPayload(tx, owner, "ai_session", id, ref)
		if err != nil {
			return err
		}
		if p.Deleted {
			return errors.New("deleted conversation cannot be copied")
		}
		return s.applyVault(tx, owner, "ai_session", newID, p)
	})
	return newID, err
}
