package sshkey

import (
	"errors"
	"strings"

	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Alias struct {
	AliasID     uuid.UUID `gorm:"type:char(36);primaryKey"`
	CanonicalID uuid.UUID `gorm:"type:char(36);not null"`
	Fingerprint string    `gorm:"size:100;not null"`
}

func (Alias) TableName() string { return "ssh_key_aliases" }

// MergeSyncKey is called within the configuration/vault transaction. Canonical
// IDs converge by UUID byte order. Both secret fields move together, and the
// foreign key cascades references without changing connection semantics.
func MergeSyncKey(tx *gorm.DB, encryptor *crypto.Encryptor, input *syncdata.KeyMaterial) (*SSHKey, error) {
	if err := syncdata.ValidateKey(input); err != nil {
		return nil, err
	}
	incoming, err := uuid.Parse(input.ID)
	if err != nil {
		return nil, err
	}
	var collision SSHKey
	err = tx.First(&collision, "id=?", incoming).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err == nil && collision.Fingerprint != input.Fingerprint {
		return nil, errors.New("key ID already identifies another public key")
	}
	var alias Alias
	err = tx.First(&alias, "alias_id=?", incoming).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err == nil && alias.Fingerprint != input.Fingerprint {
		return nil, errors.New("key alias identifies another public key")
	}
	var current SSHKey
	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "fingerprint=?", input.Fingerprint).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		current = SSHKey{ID: incoming, Name: input.Name, PublicKey: input.PublicKey, Fingerprint: input.Fingerprint, Algorithm: input.Algorithm, KeySize: input.KeySize, PassphraseRequired: input.PassphraseRequired}
		current.PrivateKey, err = encryptor.EncryptSecret(input.PrivateKey, current.PrivateKeyAAD())
		if err != nil {
			return nil, err
		}
		current.SavedPassphrase, err = encryptor.EncryptSecret(input.SavedPassphrase, current.PassphraseAAD())
		if err != nil {
			return nil, err
		}
		if err = tx.Create(&current).Error; err != nil {
			return nil, err
		}
		if err = recordKeyConfiguration(tx, "ssh_key_import", current, "automation", []string{"created"}); err != nil {
			return nil, err
		}
		return &current, nil
	}
	original := current.ID
	canonical := current.ID
	if strings.Compare(incoming.String(), canonical.String()) < 0 {
		canonical = incoming
	}
	fields := []string{}
	if canonical != original {
		fields = append(fields, "id")
	}
	if current.PrivateKey == "" && input.PrivateKey != "" {
		fields = append(fields, "private_key", "saved_passphrase", "passphrase_required")
	}
	if canonical != original || current.PrivateKey == "" && input.PrivateKey != "" {
		material, err := encryptor.DecryptSecret(current.PrivateKey, current.PrivateKeyAAD())
		if err != nil {
			return nil, err
		}
		phrase, err := encryptor.DecryptSecret(current.SavedPassphrase, current.PassphraseAAD())
		if err != nil {
			return nil, err
		}
		if material == "" && input.PrivateKey != "" {
			material, phrase = input.PrivateKey, input.SavedPassphrase
			current.PassphraseRequired = input.PassphraseRequired
		}
		current.ID = canonical
		current.PrivateKey, err = encryptor.EncryptSecret(material, current.PrivateKeyAAD())
		if err != nil {
			return nil, err
		}
		current.SavedPassphrase, err = encryptor.EncryptSecret(phrase, current.PassphraseAAD())
		if err != nil {
			return nil, err
		}
		if err = tx.Model(&SSHKey{}).Where("id=?", original).Updates(map[string]any{"id": canonical, "private_key": current.PrivateKey, "saved_passphrase": current.SavedPassphrase, "passphrase_required": current.PassphraseRequired}).Error; err != nil {
			return nil, err
		}
	}

	for _, id := range []uuid.UUID{original, incoming} {
		if id == canonical {
			continue
		}
		row := Alias{AliasID: id, CanonicalID: canonical, Fingerprint: current.Fingerprint}
		if err = tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "alias_id"}}, DoUpdates: clause.AssignmentColumns([]string{"canonical_id"})}).Create(&row).Error; err != nil {
			return nil, err
		}
	}
	if len(fields) > 0 {
		if err = recordKeyConfiguration(tx, "ssh_key_import", current, "automation", fields); err != nil {
			return nil, err
		}
	}
	return &current, nil
}
