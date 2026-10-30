package sshkey

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository defines the interface for SSH key persistence operations
type Repository interface {
	Create(ctx context.Context, key *SSHKey, action string) error
	FindByID(ctx context.Context, id uuid.UUID) (*SSHKey, error)
	List(ctx context.Context) ([]SSHKey, error)
	Delete(ctx context.Context, id uuid.UUID) error
	References(ctx context.Context, id uuid.UUID) ([]protocol.SSHKeyReference, error)
	SetPassphrase(ctx context.Context, key *SSHKey, encrypted string) error
}

type repository struct {
	db        *gorm.DB
	encryptor *crypto.Encryptor
}

// NewRepository creates a new SSH key repository
func NewRepository(db *gorm.DB, encryptor *crypto.Encryptor) Repository {
	return &repository{db: db, encryptor: encryptor}
}

// Create creates a new SSH key record
func (r *repository) Create(ctx context.Context, key *SSHKey, action string) error {
	if action != "ssh_key_generate" && action != "ssh_key_import" {
		return errors.New("invalid SSH key creation action")
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inserted := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "fingerprint"}}, DoNothing: true}).Create(key)
		if inserted.Error != nil {
			return inserted.Error
		}
		var saved SSHKey
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("fingerprint = ?", key.Fingerprint).First(&saved).Error; err != nil {
			return err
		}
		fields := []string{}
		if saved.ID == key.ID && inserted.RowsAffected > 0 {
			fields = append(fields, "created")
		}
		if saved.PrivateKey == "" && key.PrivateKey != "" {
			material, err := r.encryptor.DecryptSecret(key.PrivateKey, key.PrivateKeyAAD())
			if err != nil {
				return err
			}
			phrase, err := r.encryptor.DecryptSecret(key.SavedPassphrase, key.PassphraseAAD())
			if err != nil {
				return err
			}
			saved.PrivateKey, err = r.encryptor.EncryptSecret(material, saved.PrivateKeyAAD())
			if err != nil {
				return err
			}
			saved.SavedPassphrase, err = r.encryptor.EncryptSecret(phrase, saved.PassphraseAAD())
			if err != nil {
				return err
			}
			saved.PassphraseRequired = key.PassphraseRequired
			if err := tx.Model(&SSHKey{}).Where("id = ? AND private_key = ?", saved.ID, "").Updates(map[string]any{"private_key": saved.PrivateKey, "saved_passphrase": saved.SavedPassphrase, "passphrase_required": saved.PassphraseRequired}).Error; err != nil {
				return err
			}
			fields = append(fields, "private_key", "saved_passphrase", "passphrase_required")
		}
		if len(fields) > 0 {
			if err := recordKeyConfiguration(tx, action, saved, "manual", fields); err != nil {
				return err
			}
		}
		*key = saved
		return nil
	})
}

// FindByID finds an SSH key by ID and user ID
func (r *repository) FindByID(ctx context.Context, id uuid.UUID) (*SSHKey, error) {
	var key SSHKey
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&key).Error
	if err != nil {
		return nil, err
	}
	return &key, nil
}

// List reads instance-owned key records.
func (r *repository) List(ctx context.Context) ([]SSHKey, error) {
	keys := []SSHKey{}
	err := r.db.WithContext(ctx).Order("created_at DESC").Find(&keys).Error
	return keys, err
}

// Delete checks references inside the same transaction; the FK remains the
// final guard against concurrent assignment.
func (r *repository) Delete(ctx context.Context, id uuid.UUID) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var owned SSHKey
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&owned).Error; err != nil {
			return err
		}
		references, err := keyReferences(tx, id)
		if err != nil {
			return err
		}
		if len(references) > 0 {
			return &InUseError{References: references}
		}
		result := tx.Where("id = ?", id).Delete(&SSHKey{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return recordKeyConfiguration(tx, "ssh_key_delete", owned, "manual", []string{"deleted"})
	})
}

func (r *repository) SetPassphrase(ctx context.Context, key *SSHKey, encrypted string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current SSHKey
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id=?", key.ID).Error; err != nil {
			return err
		}
		if current.PrivateKey != key.PrivateKey || current.SavedPassphrase != key.SavedPassphrase {
			return errors.New("key changed; reload before saving its passphrase")
		}
		previous, err := r.encryptor.DecryptSecret(current.SavedPassphrase, current.PassphraseAAD())
		if err != nil {
			return err
		}
		next, err := r.encryptor.DecryptSecret(encrypted, current.PassphraseAAD())
		if err != nil {
			return err
		}
		if previous == next {
			return nil
		}
		if err := tx.Model(&current).Update("saved_passphrase", encrypted).Error; err != nil {
			return err
		}
		return recordKeyConfiguration(tx, "ssh_key_passphrase_update", current, "manual", []string{"saved_passphrase"})
	})
}

func keyReferences(db *gorm.DB, id uuid.UUID) ([]protocol.SSHKeyReference, error) {
	items := make([]protocol.SSHKeyReference, 0)
	err := db.Table("server_auth a").Select("s.id, COALESCE(NULLIF(s.name,''),s.host) AS name").Joins("JOIN servers s ON s.id=a.server_id").Where("a.ssh_key_id=?", id).Order("s.name, s.id").Scan(&items).Error
	return items, err
}

func (r *repository) References(ctx context.Context, id uuid.UUID) ([]protocol.SSHKeyReference, error) {
	var items []protocol.SSHKeyReference
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var key SSHKey
		if err := tx.Select("id").First(&key, "id=?", id).Error; err != nil {
			return err
		}
		var err error
		items, err = keyReferences(tx, id)
		return err
	})
	return items, err
}

type InUseError struct{ References []protocol.SSHKeyReference }

func (*InUseError) Error() string {
	return "SSH key is in use; detach or replace it on the referenced servers first"
}
