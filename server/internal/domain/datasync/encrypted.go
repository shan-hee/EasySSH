package datasync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/easyssh/shared/synccrypto"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// EncryptedStore has no encryptor and no business projection. Only routing and
// authenticated envelope metadata are visible to this service.
type EncryptedStore struct{ DB *gorm.DB }
type EncryptedSpace struct {
	UserID        uuid.UUID `gorm:"type:char(36);primaryKey"`
	Space         string    `gorm:"size:64;not null;uniqueIndex"`
	ManifestHash  string    `gorm:"size:64;not null"`
	Revision      uint32    `gorm:"not null"`
	WriteRevision uint64    `gorm:"not null"`
}

func (EncryptedSpace) TableName() string { return "encrypted_spaces" }

type EncryptedManifest struct {
	UserID   uuid.UUID `gorm:"type:char(36);primaryKey"`
	Hash     string    `gorm:"size:64;primaryKey"`
	Revision uint32    `gorm:"not null"`
	Payload  Document  `gorm:"not null"`
}

func (EncryptedManifest) TableName() string { return "encrypted_manifests" }

type EncryptedObject struct {
	UserID     uuid.UUID `gorm:"type:char(36);primaryKey"`
	ID         string    `gorm:"size:64;primaryKey"`
	Scope      string    `gorm:"size:20;not null"`
	DocumentID string    `gorm:"size:64;not null"`
	Payload    Document  `gorm:"not null"`
	Size       int64     `gorm:"not null"`
	CreatedAt  time.Time `gorm:"not null"`
}

func (EncryptedObject) TableName() string { return "encrypted_objects" }

type EncryptedHead struct {
	UserID     uuid.UUID `gorm:"type:char(36);primaryKey" json:"-"`
	Scope      string    `gorm:"size:20;primaryKey" json:"scope"`
	DocumentID string    `gorm:"size:64;primaryKey" json:"document"`
	ObjectID   string    `gorm:"size:64;primaryKey" json:"object"`
}

func (EncryptedHead) TableName() string { return "encrypted_heads" }

type RelayRoute struct {
	ID     uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	UserID uuid.UUID `gorm:"type:char(36);primaryKey" json:"-"`
	Host   string    `gorm:"size:255;not null" json:"host"`
	Port   int       `gorm:"not null" json:"port"`
}

func (RelayRoute) TableName() string { return "relay_routes" }

func (s *EncryptedStore) Chain(ctx context.Context, owner uuid.UUID, after uint32) ([]synccrypto.Manifest, error) {
	var rows []EncryptedManifest
	if err := s.DB.WithContext(ctx).Where("user_id = ? AND revision > ?", owner, after).Order("revision ASC").Limit(4097).Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) > 4096 {
		return nil, errors.New("manifest history limit reached")
	}
	result := make([]synccrypto.Manifest, 0, len(rows))
	for _, row := range rows {
		var m synccrypto.Manifest
		if err := json.Unmarshal([]byte(row.Payload), &m); err != nil {
			return nil, err
		}
		result = append(result, m)
	}
	return result, nil
}

func loadManifest(tx *gorm.DB, owner uuid.UUID, hash string) (synccrypto.Manifest, error) {
	var row EncryptedManifest
	var result synccrypto.Manifest
	if err := tx.First(&row, "user_id = ? AND hash = ?", owner, hash).Error; err != nil {
		return result, err
	}
	err := json.Unmarshal([]byte(row.Payload), &result)
	return result, err
}

func (s *EncryptedStore) PublishManifest(ctx context.Context, owner uuid.UUID, m synccrypto.Manifest) error {
	if err := m.Verify(); err != nil {
		return err
	}
	if m.Revision > 4096 {
		return errors.New("manifest history limit reached")
	}
	payload, err := json.Marshal(m)
	if err != nil || len(payload) > 8<<20 {
		return synccrypto.ErrInvalid
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var space EncryptedSpace
		err := tx.First(&space, "user_id = ?", owner).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if m.Revision != 1 {
				return synccrypto.ErrStale
			}
			space = EncryptedSpace{UserID: owner, Space: m.Space, ManifestHash: m.Hash(), Revision: m.Revision}
			if err := tx.Create(&space).Error; err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else {
			if space.ManifestHash == m.Hash() {
				return nil
			}
			previous, err := loadManifest(tx, owner, space.ManifestHash)
			if err != nil {
				return err
			}
			if err := m.Follows(previous); err != nil {
				return err
			}
			updated := tx.Model(&EncryptedSpace{}).Where("user_id = ? AND manifest_hash = ?", owner, previous.Hash()).Updates(map[string]any{"manifest_hash": m.Hash(), "revision": m.Revision, "write_revision": gorm.Expr("write_revision + 1")})
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return synccrypto.ErrStale
			}
		}
		var historyBytes int64
		if err := tx.Model(&EncryptedManifest{}).Select("COALESCE(SUM(LENGTH(payload)),0)").Where("user_id = ?", owner).Scan(&historyBytes).Error; err != nil {
			return err
		}
		if historyBytes+int64(len(payload)) > 8<<20 {
			return errors.New("manifest history exceeds 8 MiB")
		}
		return tx.Create(&EncryptedManifest{UserID: owner, Hash: m.Hash(), Revision: m.Revision, Payload: Document(payload)}).Error
	})
}

func (s *EncryptedStore) PutObject(ctx context.Context, owner uuid.UUID, object synccrypto.Object) error {
	payload, err := json.Marshal(object)
	if err != nil || len(payload) > 12<<20 {
		return synccrypto.ErrInvalid
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize quota, head updates and revocation against the same owner row.
		lock := tx.Model(&EncryptedSpace{}).Where("user_id = ?", owner).UpdateColumn("write_revision", gorm.Expr("write_revision + 1"))
		if lock.Error != nil {
			return lock.Error
		}
		if lock.RowsAffected != 1 {
			return synccrypto.ErrUnauthorized
		}
		var existing EncryptedObject
		err := tx.First(&existing, "user_id = ? AND id = ?", owner, object.ID).Error
		if err == nil {
			if string(existing.Payload) != string(payload) {
				return errors.New("immutable object ID collision")
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var space EncryptedSpace
		if err := tx.First(&space, "user_id = ?", owner).Error; err != nil {
			return err
		}
		if object.Space != space.Space || object.Manifest != space.ManifestHash {
			return synccrypto.ErrStale
		}
		manifest, err := loadManifest(tx, owner, space.ManifestHash)
		if err != nil {
			return err
		}
		if err := object.Verify(manifest); err != nil {
			return err
		}
		if len(object.Parents) > 0 {
			var parents int64
			if err := tx.Model(&EncryptedObject{}).Where("user_id = ? AND id IN ? AND scope = ? AND document_id = ?", owner, object.Parents, object.Scope, object.Document).Count(&parents).Error; err != nil {
				return err
			}
			if parents != int64(len(object.Parents)) {
				return errors.New("missing encrypted object parents")
			}
		}
		var used int64
		if err := tx.Model(&EncryptedObject{}).Select("COALESCE(SUM(size),0)").Where("user_id = ?", owner).Scan(&used).Error; err != nil {
			return err
		}
		if used+int64(len(payload)) > 2<<30 {
			return errors.New("encrypted storage exceeds 2 GiB")
		}
		if err := tx.Create(&EncryptedObject{UserID: owner, ID: object.ID, Scope: string(object.Scope), DocumentID: object.Document, Payload: Document(payload), Size: int64(len(payload)), CreatedAt: time.Now().UTC()}).Error; err != nil {
			return err
		}
		if len(object.Parents) > 0 {
			if err := tx.Where("user_id = ? AND scope = ? AND document_id = ? AND object_id IN ?", owner, object.Scope, object.Document, object.Parents).Delete(&EncryptedHead{}).Error; err != nil {
				return err
			}
		}
		var heads int64
		if err := tx.Model(&EncryptedHead{}).Where("user_id = ? AND scope = ? AND document_id = ?", owner, object.Scope, object.Document).Count(&heads).Error; err != nil {
			return err
		}
		if heads >= 64 {
			return errors.New("too many concurrent heads; merge before uploading")
		}
		return tx.Create(&EncryptedHead{UserID: owner, Scope: string(object.Scope), DocumentID: object.Document, ObjectID: object.ID}).Error
	})
}

func (s *EncryptedStore) Heads(ctx context.Context, owner uuid.UUID) ([]EncryptedHead, error) {
	result := []EncryptedHead{}
	err := s.DB.WithContext(ctx).Where("user_id = ?", owner).Order("scope,document_id,object_id").Limit(20001).Find(&result).Error
	if len(result) > 20000 {
		return nil, errors.New("too many encrypted document heads")
	}
	return result, err
}
func (s *EncryptedStore) Object(ctx context.Context, owner uuid.UUID, id string) (synccrypto.Object, error) {
	var row EncryptedObject
	var result synccrypto.Object
	if err := s.DB.WithContext(ctx).First(&row, "user_id = ? AND id = ?", owner, id).Error; err != nil {
		return result, err
	}
	err := json.Unmarshal([]byte(row.Payload), &result)
	return result, err
}
func (s *EncryptedStore) SaveRoute(ctx context.Context, owner uuid.UUID, route RelayRoute) error {
	if route.ID == uuid.Nil || route.Host == "" || len(route.Host) > 255 || route.Port < 1 || route.Port > 65535 {
		return fmt.Errorf("invalid relay route")
	}
	route.UserID = owner
	return s.DB.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "id"}}, DoUpdates: clause.AssignmentColumns([]string{"host", "port"})}).Create(&route).Error
}
