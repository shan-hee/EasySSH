package sshkey

import (
	"crypto/ed25519"
	"crypto/md5"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"

	"github.com/easyssh/server/internal/pkg/crypto"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

// Service defines the interface for SSH key business logic
type Service interface {
	GenerateKeyPair(req *CreateSSHKeyRequest, userID uuid.UUID) (*SSHKeyResponse, error)
	ImportKeyPair(req *ImportSSHKeyRequest, userID uuid.UUID) (*SSHKeyResponse, error)
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
	var algorithm string
	var keySize int

	switch req.Algorithm {
	case "rsa":
		algorithm = "rsa"
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
		algorithm = "ed25519"
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

	// 生成公钥
	publicKey, err := generatePublicKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to generate public key: %w", err)
	}

	// 计算指纹
	fingerprint, err := calculateFingerprint(publicKey)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate fingerprint: %w", err)
	}

	// 保存到数据库
	sshKey := &SSHKey{
		UserID:      userID,
		Name:        req.Name,
		PublicKey:   publicKey,
		Fingerprint: fingerprint,
		Algorithm:   algorithm,
		KeySize:     keySize,
	}
	encryptedPrivateKey, err := s.encryptPrivateKey(sshKey, privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt private key: %w", err)
	}
	sshKey.PrivateKey = encryptedPrivateKey

	if err := s.repo.Create(sshKey); err != nil {
		return nil, fmt.Errorf("failed to save SSH key: %w", err)
	}

	// 返回响应（包含未加密的私钥，仅此一次）
	return &SSHKeyResponse{
		ID:          sshKey.ID,
		CreatedAt:   sshKey.CreatedAt,
		UserID:      sshKey.UserID,
		Name:        sshKey.Name,
		PublicKey:   sshKey.PublicKey,
		PrivateKey:  privateKeyPEM, // 返回原始私钥
		Fingerprint: sshKey.Fingerprint,
		Algorithm:   sshKey.Algorithm,
		KeySize:     sshKey.KeySize,
	}, nil
}

// ImportKeyPair imports an existing SSH key pair
func (s *service) ImportKeyPair(req *ImportSSHKeyRequest, userID uuid.UUID) (*SSHKeyResponse, error) {
	// 解析私钥
	privateKeyPEM := strings.TrimSpace(req.PrivateKey)

	// 验证私钥格式
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return nil, errors.New("invalid private key format: failed to decode PEM block")
	}

	// 尝试解析私钥
	var privateKey interface{}
	var err error
	var algorithm string
	var keySize int

	// 尝试解析为不同类型的私钥
	if strings.Contains(block.Type, "RSA") {
		privateKey, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			// 尝试PKCS8格式
			privateKey, err = x509.ParsePKCS8PrivateKey(block.Bytes)
			if err != nil {
				return nil, fmt.Errorf("failed to parse RSA private key: %w", err)
			}
		}
		if rsaKey, ok := privateKey.(*rsa.PrivateKey); ok {
			algorithm = "rsa"
			keySize = rsaKey.N.BitLen()
		}
	} else if strings.Contains(block.Type, "OPENSSH") || strings.Contains(block.Type, "PRIVATE KEY") {
		// 尝试解析为OpenSSH格式
		privateKey, err = ssh.ParseRawPrivateKey([]byte(privateKeyPEM))
		if err != nil {
			return nil, fmt.Errorf("failed to parse private key: %w", err)
		}

		// 确定算法类型
		switch key := privateKey.(type) {
		case *rsa.PrivateKey:
			algorithm = "rsa"
			keySize = key.N.BitLen()
		case *ed25519.PrivateKey:
			algorithm = "ed25519"
			keySize = 0
		default:
			return nil, errors.New("unsupported key type, only RSA and ED25519 are supported")
		}
	} else {
		return nil, errors.New("unsupported private key type")
	}

	// 生成公钥
	publicKey, err := generatePublicKey(privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to generate public key: %w", err)
	}

	// 计算指纹
	fingerprint, err := calculateFingerprint(publicKey)
	if err != nil {
		return nil, fmt.Errorf("failed to calculate fingerprint: %w", err)
	}

	// 保存到数据库
	sshKey := &SSHKey{
		UserID:      userID,
		Name:        req.Name,
		PublicKey:   publicKey,
		Fingerprint: fingerprint,
		Algorithm:   algorithm,
		KeySize:     keySize,
	}
	encryptedPrivateKey, err := s.encryptPrivateKey(sshKey, privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt private key: %w", err)
	}
	sshKey.PrivateKey = encryptedPrivateKey

	if err := s.repo.Create(sshKey); err != nil {
		return nil, fmt.Errorf("failed to save SSH key: %w", err)
	}

	// 返回响应（包含原始私钥，仅此一次）
	return &SSHKeyResponse{
		ID:          sshKey.ID,
		CreatedAt:   sshKey.CreatedAt,
		UserID:      sshKey.UserID,
		Name:        sshKey.Name,
		PublicKey:   sshKey.PublicKey,
		PrivateKey:  privateKeyPEM,
		Fingerprint: sshKey.Fingerprint,
		Algorithm:   sshKey.Algorithm,
		KeySize:     sshKey.KeySize,
	}, nil
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

func (s *service) decryptPrivateKey(key *SSHKey) (string, error) {
	if s.encryptor == nil {
		return "", errors.New("encryptor is required")
	}
	return s.encryptor.DecryptWithAAD(key.PrivateKey, key.PrivateKeyAAD())
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

// generatePublicKey generates an SSH public key from a private key
func generatePublicKey(privateKey interface{}) (string, error) {
	var publicKey ssh.PublicKey
	var err error

	switch key := privateKey.(type) {
	case *rsa.PrivateKey:
		publicKey, err = ssh.NewPublicKey(&key.PublicKey)
	case ed25519.PrivateKey:
		publicKey, err = ssh.NewPublicKey(key.Public())
	default:
		return "", errors.New("unsupported private key type")
	}

	if err != nil {
		return "", err
	}

	return string(ssh.MarshalAuthorizedKey(publicKey)), nil
}

// calculateFingerprint calculates the MD5 fingerprint of an SSH public key
func calculateFingerprint(publicKeyStr string) (string, error) {
	publicKeyStr = strings.TrimSpace(publicKeyStr)

	// 解析公钥
	publicKey, _, _, _, err := ssh.ParseAuthorizedKey([]byte(publicKeyStr))
	if err != nil {
		return "", err
	}

	// 计算MD5指纹
	hash := md5.Sum(publicKey.Marshal())

	// 格式化为 xx:xx:xx:xx:... 格式
	fingerprint := fmt.Sprintf("%02x", hash[0])
	for i := 1; i < len(hash); i++ {
		fingerprint += fmt.Sprintf(":%02x", hash[i])
	}

	return fingerprint, nil
}
