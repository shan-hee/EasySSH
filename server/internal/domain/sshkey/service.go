package sshkey

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"

	"github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
)

var ErrInvalidImport = errors.New("invalid SSH key import")

// Service defines the interface for SSH key business logic
type Service interface {
	GenerateKeyPair(req *CreateSSHKeyRequest, userID uuid.UUID) (*SSHKeyResponse, error)
	ImportKeyPair(req *ImportSSHKeyRequest, userID uuid.UUID) (*SSHKeyResponse, error)
	GetKey(keyID uint, userID uuid.UUID) (*SSHKey, error)
	GetUserKeys(userID uuid.UUID) ([]SSHKey, error)
	DeleteKey(keyID uint, userID uuid.UUID) error
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
func (s *service) GenerateKeyPair(req *CreateSSHKeyRequest, userID uuid.UUID) (*SSHKeyResponse, error) {
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
			return nil, errors.New("RSA key size must be between 2048 and 4096")
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
		return nil, errors.New("unsupported algorithm, must be rsa or ed25519")
	}

	// 将私钥转换为PEM格式
	privateKeyPEM, err := encodePrivateKeyToPEM(privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to encode private key: %w", err)
	}

	result, err := s.ImportKeyPair(&ImportSSHKeyRequest{Name: req.Name, PrivateKey: privateKeyPEM}, userID)
	if err != nil {
		return nil, err
	}
	result.PrivateKey = privateKeyPEM
	return result, nil
}

// ImportKeyPair preserves the original key's passphrase protection.
func (s *service) ImportKeyPair(req *ImportSSHKeyRequest, userID uuid.UUID) (*SSHKeyResponse, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, fmt.Errorf("%w: key name is required", ErrInvalidImport)
	}
	material := strings.TrimSpace(req.PrivateKey)
	metadata, err := sshutil.InspectPrivateKey(material, req.Passphrase)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidImport, err)
	}
	key := &SSHKey{
		UserID: userID, Name: name, PublicKey: metadata.PublicKey,
		Fingerprint: metadata.Fingerprint, Algorithm: metadata.Algorithm,
		KeySize: metadata.KeySize, PassphraseRequired: metadata.PassphraseRequired,
	}
	key.PrivateKey, err = s.encryptPrivateKey(key, material)
	if err != nil {
		return nil, err
	}
	if err = s.repo.Create(key); err != nil {
		return nil, err
	}
	return &SSHKeyResponse{
		ID: key.ID, CreatedAt: key.CreatedAt, UserID: key.UserID, Name: key.Name,
		PublicKey: key.PublicKey, Fingerprint: key.Fingerprint, Algorithm: key.Algorithm,
		KeySize: key.KeySize, PassphraseRequired: key.PassphraseRequired,
	}, nil
}

func (s *service) GetKey(keyID uint, userID uuid.UUID) (*SSHKey, error) {
	return s.repo.FindByID(keyID, userID)
}

// GetUserKeys retrieves all SSH keys for a user
func (s *service) GetUserKeys(userID uuid.UUID) ([]SSHKey, error) {
	return s.repo.FindByUserID(userID)
}

// DeleteKey deletes an SSH key
func (s *service) DeleteKey(keyID uint, userID uuid.UUID) error {
	return s.repo.Delete(keyID, userID)
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
