package sshkey

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"strings"

	"github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
)

var ErrInvalidImport = errors.New("invalid SSH key import")

// Service defines the interface for SSH key business logic
type Service interface {
	GenerateKeyPair(ctx context.Context, scope access.Scope, req *protocol.SSHKeyGenerateInput) (*protocol.SSHKeyCreated, error)
	ImportKeyPair(ctx context.Context, scope access.Scope, req *protocol.SSHKeyImportInput) (*protocol.SSHKey, error)
	GetKey(ctx context.Context, scope access.Scope, keyID uuid.UUID) (*SSHKey, error)
	ListKeys(ctx context.Context, scope access.Scope) ([]SSHKey, error)
	DeleteKey(ctx context.Context, scope access.Scope, keyID uuid.UUID) error
	KeyReferences(ctx context.Context, scope access.Scope, keyID uuid.UUID) (protocol.SSHKeyReferences, error)
	SetPassphrase(ctx context.Context, scope access.Scope, keyID uuid.UUID, passphrase string, save bool) error
}

type service struct {
	repo      Repository
	encryptor *crypto.Encryptor
}

// NewService creates a new SSH key service
func NewService(repo Repository, encryptor *crypto.Encryptor) Service {
	return &service{
		repo:      repo,
		encryptor: encryptor,
	}
}

// GenerateKeyPair generates a new SSH key pair
func (s *service) GenerateKeyPair(ctx context.Context, scope access.Scope, req *protocol.SSHKeyGenerateInput) (*protocol.SSHKeyCreated, error) {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return nil, err
	}
	if req == nil || strings.TrimSpace(req.Name) == "" || len(req.Name) > 100 {
		return nil, fmt.Errorf("%w: key name is required (maximum 100 bytes)", ErrInvalidImport)
	}
	var privateKey interface{}
	var err error
	var keySize int

	switch req.Algorithm {
	case "rsa":
		keySize = req.KeySize
		if keySize == 0 {
			keySize = 2048 // 默认2048位
		}
		if keySize < 2048 || keySize > 4096 {
			return nil, fmt.Errorf("%w: RSA key size must be between 2048 and 4096", ErrInvalidImport)
		}
		privateKey, err = rsa.GenerateKey(rand.Reader, keySize)
		if err != nil {
			return nil, fmt.Errorf("failed to generate RSA key: %w", err)
		}
	case "ed25519":
		keySize = 0
		_, privateKey, err = ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, fmt.Errorf("failed to generate ED25519 key: %w", err)
		}
	default:
		return nil, fmt.Errorf("%w: unsupported algorithm, must be rsa or ed25519", ErrInvalidImport)
	}

	// 将私钥转换为PEM格式
	privateKeyPEM, err := encodePrivateKeyToPEM(privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to encode private key: %w", err)
	}

	result, err := s.importKeyPair(ctx, scope, &protocol.SSHKeyImportInput{Name: req.Name, PrivateKey: privateKeyPEM}, "ssh_key_generate")
	if err != nil {
		return nil, err
	}
	return &protocol.SSHKeyCreated{ID: result.ID, Name: result.Name, CreatedAt: result.CreatedAt,
		PublicKey: result.PublicKey, PrivateKey: privateKeyPEM, Fingerprint: result.Fingerprint,
		Algorithm: result.Algorithm, KeySize: result.KeySize, PassphraseRequired: result.PassphraseRequired}, nil
}

// ImportKeyPair preserves the original key's passphrase protection.
func (s *service) ImportKeyPair(ctx context.Context, scope access.Scope, req *protocol.SSHKeyImportInput) (*protocol.SSHKey, error) {
	return s.importKeyPair(ctx, scope, req, "ssh_key_import")
}

func (s *service) importKeyPair(ctx context.Context, scope access.Scope, req *protocol.SSHKeyImportInput, action string) (*protocol.SSHKey, error) {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return nil, err
	}
	if req == nil {
		return nil, ErrInvalidImport
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 100 {
		return nil, fmt.Errorf("%w: key name is required", ErrInvalidImport)
	}
	if len(req.PrivateKey) > 1<<20 || len(req.Passphrase) > 4096 {
		return nil, fmt.Errorf("%w: key material exceeds limit", ErrInvalidImport)
	}
	material := strings.TrimSpace(req.PrivateKey)
	metadata, err := sshutil.InspectPrivateKey(material, req.Passphrase)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidImport, err)
	}
	key := &SSHKey{
		ID: uuid.New(), Name: name, PublicKey: metadata.PublicKey,
		Fingerprint: metadata.Fingerprint, Algorithm: metadata.Algorithm,
		KeySize: metadata.KeySize, PassphraseRequired: metadata.PassphraseRequired,
	}
	key.PrivateKey, err = s.encryptPrivateKey(key, material)
	if err != nil {
		return nil, err
	}
	if req.SavePassphrase && metadata.PassphraseRequired {
		key.SavedPassphrase, err = s.encryptor.EncryptSecret(req.Passphrase, key.PassphraseAAD())
		if err != nil {
			return nil, err
		}
	}
	if err = s.repo.Create(access.WithScope(ctx, scope), key, action); err != nil {
		return nil, err
	}
	result := key.Public()
	return &result, nil
}

func (s *service) GetKey(ctx context.Context, scope access.Scope, keyID uuid.UUID) (*SSHKey, error) {
	if err := scope.RequireOwner(ctx, protocol.CredentialsRead); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, keyID)
}

// GetUserKeys retrieves all SSH keys for a user
func (s *service) ListKeys(ctx context.Context, scope access.Scope) ([]SSHKey, error) {
	if err := scope.RequireOwner(ctx, protocol.CredentialsRead); err != nil {
		return nil, err
	}
	return s.repo.List(ctx)
}

// DeleteKey deletes an SSH key
func (s *service) DeleteKey(ctx context.Context, scope access.Scope, keyID uuid.UUID) error {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	return s.repo.Delete(access.WithScope(ctx, scope), keyID)
}

func (s *service) KeyReferences(ctx context.Context, scope access.Scope, keyID uuid.UUID) (protocol.SSHKeyReferences, error) {
	if err := scope.RequireOwner(ctx, protocol.CredentialsRead); err != nil {
		return protocol.SSHKeyReferences{}, err
	}
	refs, err := s.repo.References(ctx, keyID)
	if err != nil {
		return protocol.SSHKeyReferences{}, err
	}
	return protocol.SSHKeyReferences{KeyID: keyID, References: refs}, nil
}

func (s *service) encryptPrivateKey(key *SSHKey, privateKeyPEM string) (string, error) {
	if s.encryptor == nil {
		return "", errors.New("encryptor is required")
	}
	return s.encryptor.EncryptWithAAD(privateKeyPEM, key.PrivateKeyAAD())
}

// encodePrivateKeyToPEM encodes a private key to PEM format
func encodePrivateKeyToPEM(privateKey interface{}) (string, error) {
	var pemBlock *pem.Block

	switch key := privateKey.(type) {
	case *rsa.PrivateKey:
		pemBlock = &pem.Block{
			Type:  "RSA PRIVATE KEY",
			Bytes: x509.MarshalPKCS1PrivateKey(key),
		}
	case ed25519.PrivateKey:
		bytes, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			return "", err
		}
		pemBlock = &pem.Block{
			Type:  "PRIVATE KEY",
			Bytes: bytes,
		}
	default:
		return "", errors.New("unsupported private key type")
	}

	return string(pem.EncodeToMemory(pemBlock)), nil
}

func (s *service) SetPassphrase(ctx context.Context, scope access.Scope, id uuid.UUID, phrase string, save bool) error {
	if err := scope.RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	key, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	encrypted := ""
	if save {
		material, err := s.encryptor.DecryptSecret(key.PrivateKey, key.PrivateKeyAAD())
		if err != nil {
			return err
		}
		metadata, err := sshutil.InspectPrivateKey(material, phrase)
		if err != nil {
			return fmt.Errorf("%w: invalid passphrase", ErrInvalidImport)
		}
		if metadata.Fingerprint != key.Fingerprint || !metadata.PassphraseRequired {
			return fmt.Errorf("%w: key does not require this passphrase", ErrInvalidImport)
		}
		encrypted, err = s.encryptor.EncryptSecret(phrase, key.PassphraseAAD())
		if err != nil {
			return err
		}
	}
	return s.repo.SetPassphrase(access.WithScope(ctx, scope), key, encrypted)
}
