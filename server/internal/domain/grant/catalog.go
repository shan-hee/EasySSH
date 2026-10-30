package grant

import (
	"context"
	"encoding/base64"
	"errors"
	"github.com/easyssh/shared/protocol"

	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sshhostkey"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"
)

type ResourceCatalog struct{ encryptor *crypto.Encryptor }

func NewResourceCatalog(encryptor *crypto.Encryptor) *ResourceCatalog {
	return &ResourceCatalog{encryptor: encryptor}
}

func (c *ResourceCatalog) Resource(ctx context.Context, tx *gorm.DB, id uuid.UUID) (protocol.AccessResource, int64, error) {
	var row server.Server
	if err := tx.WithContext(ctx).Select("id", "name", "host", "port", "username", "connection_revision").First(&row, "id = ?", id).Error; err != nil {
		return protocol.AccessResource{}, 0, err
	}
	return protocol.AccessResource{ID: row.ID, Name: row.Name, Host: row.Host, Port: row.Port, Username: row.Username}, row.ConnectionRevision, nil
}

func (c *ResourceCatalog) Ready(ctx context.Context, tx *gorm.DB, id uuid.UUID, allowInteractive bool) error {
	var row server.Server
	if err := tx.WithContext(ctx).Preload("Auth.SSHKey").First(&row, "id = ?", id).Error; err != nil {
		return err
	}
	if !row.Auth.AuthMethod.IsValid() {
		return errors.New("authentication policy is invalid")
	}
	if row.Auth.AuthMethod.SupportsKeyboardInteractive() && !allowInteractive {
		return errors.New("interactive authentication requires explicit owner permission")
	}
	if c.encryptor == nil {
		return errors.New("instance credentials are unavailable")
	}
	if row.Auth.AuthMethod.RequiresPassword() {
		password, err := c.encryptor.DecryptSecret(row.Auth.Password, row.CredentialAAD("password"))
		if err != nil || password == "" {
			return errors.New("save a usable server password before sharing")
		}
	}
	if row.Auth.AuthMethod.RequiresPrivateKey() {
		if row.Auth.SSHKey == nil || row.Auth.SSHKey.PrivateKey == "" {
			return errors.New("server private key is unavailable")
		}
		key := row.Auth.SSHKey
		if key.PassphraseRequired && key.SavedPassphrase == "" {
			return errors.New("save the private key passphrase before sharing")
		}
		material, err := c.encryptor.DecryptSecret(key.PrivateKey, key.PrivateKeyAAD())
		if err != nil {
			return errors.New("server private key cannot be unlocked")
		}
		phrase, err := c.encryptor.DecryptSecret(key.SavedPassphrase, key.PassphraseAAD())
		if err != nil {
			return errors.New("server private key passphrase cannot be unlocked")
		}
		metadata, err := sshutil.InspectPrivateKey(material, phrase)
		if err != nil || metadata.Fingerprint != key.Fingerprint || metadata.PublicKey != key.PublicKey {
			return errors.New("server private key does not match its public identity")
		}
	}
	var trust []sshhostkey.SSHHostKey
	if err := tx.WithContext(ctx).Where("host = ? AND port = ? AND trust_status = ?", sshutil.NormalizeHost(row.Host), row.Port, "trusted").Find(&trust).Error; err != nil {
		return err
	}
	if len(trust) == 0 {
		return errors.New("confirm the server host key before sharing")
	}
	for _, record := range trust {
		if record.ConfirmedAt.IsZero() {
			return errors.New("confirm the server host key before sharing")
		}
		data, err := base64.StdEncoding.DecodeString(record.PublicKey)
		if err != nil {
			return errors.New("stored host trust is invalid")
		}
		key, err := ssh.ParsePublicKey(data)
		if err != nil || key.Type() != record.KeyType || ssh.FingerprintSHA256(key) != record.Fingerprint {
			return errors.New("stored host trust is invalid")
		}
	}
	return nil
}

func (c *ResourceCatalog) ScriptVersion(ctx context.Context, tx *gorm.DB, id uuid.UUID) (string, error) {
	var row script.Script
	if err := tx.WithContext(ctx).Select("id", "version").First(&row, "id = ?", id).Error; err != nil {
		return "", err
	}
	return row.Version, nil
}
