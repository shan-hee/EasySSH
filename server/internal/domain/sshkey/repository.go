package sshkey

import (
	"errors"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository defines the interface for SSH key persistence operations
type Repository interface {
	Create(key *SSHKey) error
	FindByID(id uint, userID uuid.UUID) (*SSHKey, error)
	FindByUserID(userID uuid.UUID) ([]SSHKey, error)
	Delete(id uint, userID uuid.UUID) error
}

type repository struct {
	db *gorm.DB
}

// NewRepository creates a new SSH key repository
func NewRepository(db *gorm.DB) Repository {
	return &repository{db: db}
}

// Create creates a new SSH key record
func (r *repository) Create(key *SSHKey) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "fingerprint"}}, DoNothing: true}).Create(key).Error; err != nil {
			return err
		}
		// A metadata-only restore can be completed by importing its private key.
		// Never replace material already used by other connections.
		if err := tx.Model(&SSHKey{}).Where("user_id = ? AND fingerprint = ? AND private_key = ?", key.UserID, key.Fingerprint, "").Updates(map[string]interface{}{"private_key": key.PrivateKey, "passphrase_required": key.PassphraseRequired}).Error; err != nil {
			return err
		}

		var saved SSHKey
		if err := tx.Where("user_id = ? AND fingerprint = ?", key.UserID, key.Fingerprint).First(&saved).Error; err != nil {
			return err
		}
		*key = saved
		return nil
	})
}

// FindByID finds an SSH key by ID and user ID
func (r *repository) FindByID(id uint, userID uuid.UUID) (*SSHKey, error) {
	var key SSHKey
	err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&key).Error
	if err != nil {
		return nil, err
	}
	return &key, nil
}

// FindByUserID finds all SSH keys for a specific user
func (r *repository) FindByUserID(userID uuid.UUID) ([]SSHKey, error) {
	keys := []SSHKey{}
	err := r.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&keys).Error
	return keys, err
}

// Delete deletes an SSH key by ID and user ID
func (r *repository) Delete(id uint, userID uuid.UUID) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var owned SSHKey
		if err := tx.Where("id = ? AND user_id = ?", id, userID).First(&owned).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Table("servers").Where("ssh_key_id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return errors.New("SSH key is in use; detach it from connections before deleting")
		}
		result := tx.Where("id = ? AND user_id = ?", id, userID).Delete(&SSHKey{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}
