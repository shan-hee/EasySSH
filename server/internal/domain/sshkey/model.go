package sshkey

import (
	"github.com/easyssh/shared/protocol"
	crypto "github.com/easyssh/shared/secretcrypto"
	"gorm.io/gorm"
	"time"

	"github.com/google/uuid"
)

// SSHKey represents an SSH key pair owned by the instance
type SSHKey struct {
	ID                 uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	Name               string    `gorm:"type:varchar(100);not null" json:"name"`
	PublicKey          string    `gorm:"type:text;not null" json:"public_key"`
	PrivateKey         string    `gorm:"type:text;not null" json:"-"` // 加密存储，不在JSON响应中返回
	Fingerprint        string    `gorm:"type:varchar(100);not null;uniqueIndex:idx_ssh_key_fingerprint" json:"fingerprint"`
	Algorithm          string    `gorm:"type:varchar(20);not null" json:"algorithm"` // rsa, ed25519
	PassphraseRequired bool      `json:"passphrase_required"`
	SavedPassphrase    string    `gorm:"type:text" json:"-"`
	KeySize            int       `gorm:"default:0" json:"key_size"` // RSA密钥长度，ED25519为0
}

// TableName specifies the table name for SSHKey model
func (SSHKey) TableName() string {
	return "ssh_keys"
}

func (k *SSHKey) PrivateKeyAAD() []byte {
	return crypto.SecretAAD("ssh_keys", k.ID.String(), "private_key")
}

func (k *SSHKey) PassphraseAAD() []byte {
	return crypto.SecretAAD("ssh_keys", k.ID.String(), "saved_passphrase")
}
func (k *SSHKey) BeforeCreate(*gorm.DB) error {
	if k.ID == uuid.Nil {
		k.ID = uuid.New()
	}
	return nil
}
func (k SSHKey) Public() protocol.SSHKey {
	return protocol.SSHKey{ID: k.ID, Name: k.Name, PublicKey: k.PublicKey, Fingerprint: k.Fingerprint,
		Algorithm: k.Algorithm, KeySize: k.KeySize, PassphraseRequired: k.PassphraseRequired,
		HasPrivateKey: k.PrivateKey != "", HasSavedPassphrase: k.SavedPassphrase != "",
		CreatedAt: k.CreatedAt, UpdatedAt: k.UpdatedAt}
}
