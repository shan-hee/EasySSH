package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	BackupEnvelopeAlgorithm = "AES-256-GCM"
	BackupEnvelopeKDF       = "argon2id"
	BackupEnvelopeVersion   = "1"

	backupEnvelopeKDFVersion   = 19
	backupEnvelopeMemoryKiB    = 64 * 1024
	backupEnvelopeIterations   = 3
	backupEnvelopeParallelism  = 2
	backupEnvelopeKeyLength    = 32
	backupEnvelopeSaltByteSize = 16
)

type BackupKDFParams struct {
	Algorithm   string `json:"algorithm"`
	Version     int    `json:"version"`
	MemoryKiB   uint32 `json:"memory_kib"`
	Iterations  uint32 `json:"iterations"`
	Parallelism uint8  `json:"parallelism"`
	KeyLength   uint32 `json:"key_length"`
	Salt        string `json:"salt"`
}

type BackupEncryptedPayload struct {
	Algorithm  string          `json:"algorithm"`
	Version    string          `json:"version"`
	KDF        BackupKDFParams `json:"kdf"`
	Nonce      string          `json:"nonce"`
	Ciphertext string          `json:"ciphertext"`
}

func EncryptBackupJSON(payload interface{}, password string, aad []byte) (*BackupEncryptedPayload, error) {
	if strings.TrimSpace(password) == "" {
		return nil, errors.New("backup password is required")
	}

	plaintext, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize backup payload: %w", err)
	}

	params, key, err := deriveBackupKey(password)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	return &BackupEncryptedPayload{
		Algorithm:  BackupEnvelopeAlgorithm,
		Version:    BackupEnvelopeVersion,
		KDF:        params,
		Nonce:      base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(gcm.Seal(nil, nonce, plaintext, aad)),
	}, nil
}

func DecryptBackupJSON(envelope *BackupEncryptedPayload, password string, aad []byte, target interface{}) error {
	if envelope == nil {
		return errors.New("encrypted backup payload is missing")
	}
	if strings.TrimSpace(password) == "" {
		return errors.New("backup password is required")
	}
	if envelope.Algorithm != BackupEnvelopeAlgorithm {
		return fmt.Errorf("unsupported backup encryption algorithm: %s", envelope.Algorithm)
	}
	if envelope.Version != BackupEnvelopeVersion {
		return fmt.Errorf("unsupported backup envelope version: %s", envelope.Version)
	}
	if envelope.KDF.Algorithm != BackupEnvelopeKDF {
		return fmt.Errorf("unsupported backup kdf: %s", envelope.KDF.Algorithm)
	}

	key, err := deriveBackupKeyFromParams(password, envelope.KDF)
	if err != nil {
		return err
	}

	nonce, err := base64.StdEncoding.DecodeString(envelope.Nonce)
	if err != nil {
		return fmt.Errorf("failed to decode backup nonce: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		return fmt.Errorf("failed to decode backup ciphertext: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	if len(nonce) != gcm.NonceSize() {
		return errors.New("invalid backup nonce size")
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return errors.New("failed to decrypt backup payload")
	}
	if err := json.Unmarshal(plaintext, target); err != nil {
		return fmt.Errorf("failed to decode backup payload: %w", err)
	}
	return nil
}

func deriveBackupKey(password string) (BackupKDFParams, []byte, error) {
	salt := make([]byte, backupEnvelopeSaltByteSize)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return BackupKDFParams{}, nil, err
	}
	params := BackupKDFParams{
		Algorithm:   BackupEnvelopeKDF,
		Version:     backupEnvelopeKDFVersion,
		MemoryKiB:   backupEnvelopeMemoryKiB,
		Iterations:  backupEnvelopeIterations,
		Parallelism: backupEnvelopeParallelism,
		KeyLength:   backupEnvelopeKeyLength,
		Salt:        base64.StdEncoding.EncodeToString(salt),
	}
	key, err := deriveBackupKeyFromParams(password, params)
	return params, key, err
}

func deriveBackupKeyFromParams(password string, params BackupKDFParams) ([]byte, error) {
	if strings.TrimSpace(password) == "" {
		return nil, errors.New("backup password is required")
	}
	if params.Algorithm != BackupEnvelopeKDF ||
		params.Version != backupEnvelopeKDFVersion ||
		params.MemoryKiB != backupEnvelopeMemoryKiB ||
		params.Iterations != backupEnvelopeIterations ||
		params.Parallelism != backupEnvelopeParallelism ||
		params.KeyLength != backupEnvelopeKeyLength {
		return nil, errors.New("invalid backup kdf parameters")
	}
	salt, err := base64.StdEncoding.DecodeString(params.Salt)
	if err != nil {
		return nil, fmt.Errorf("failed to decode backup salt: %w", err)
	}
	if len(salt) != backupEnvelopeSaltByteSize {
		return nil, errors.New("invalid backup salt size")
	}
	return argon2.IDKey([]byte(password), salt, params.Iterations, params.MemoryKiB, params.Parallelism, params.KeyLength), nil
}
