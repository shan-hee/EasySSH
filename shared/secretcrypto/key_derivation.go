package crypto

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"

	"golang.org/x/crypto/hkdf"
)

// DeriveKey 使用 HKDF-SHA256 从部署根密钥派生用途隔离的子密钥。
func DeriveKey(encodedRootKey, purpose string, length int) ([]byte, error) {
	rootKey, err := base64.StdEncoding.DecodeString(encodedRootKey)
	if err != nil {
		return nil, fmt.Errorf("decode root key: %w", err)
	}
	if len(rootKey) != 32 {
		return nil, fmt.Errorf("root key must contain 32 bytes")
	}
	return deriveKey(rootKey, purpose, length)
}

func (e *Encryptor) DeriveKey(purpose string, length int) ([]byte, error) {
	if e == nil {
		return nil, fmt.Errorf("encryptor is unavailable")
	}
	return deriveKey(e.key, purpose, length)
}

func deriveKey(rootKey []byte, purpose string, length int) ([]byte, error) {
	if len(rootKey) != 32 {
		return nil, fmt.Errorf("root key must contain 32 bytes")
	}
	if purpose == "" || length < 1 {
		return nil, fmt.Errorf("key derivation purpose and length are required")
	}
	derived := make([]byte, length)
	reader := hkdf.New(sha256.New, rootKey, nil, []byte("EasySSH/"+purpose))
	if _, err := io.ReadFull(reader, derived); err != nil {
		return nil, fmt.Errorf("derive %s key: %w", purpose, err)
	}
	return derived, nil
}
