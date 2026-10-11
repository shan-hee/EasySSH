package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	secretcrypto "github.com/easyssh/shared/secretcrypto"
	"github.com/zalando/go-keyring"
)

var desktopCredentialVault struct {
	sync.Mutex
	encryptor *secretcrypto.Encryptor
}

// The root key only lives in the OS credential store (Credential Manager,
// Keychain or Secret Service). There is deliberately no plaintext file fallback.
func desktopCredentialEncryptor(create bool) (*secretcrypto.Encryptor, error) {
	desktopCredentialVault.Lock()
	defer desktopCredentialVault.Unlock()
	if desktopCredentialVault.encryptor != nil {
		return desktopCredentialVault.encryptor, nil
	}
	const service = "EasySSH Desktop"
	account, err := desktopCredentialAccount(desktopDataDir())
	if err != nil {
		return nil, err
	}
	encoded, err := keyring.Get(service, account)
	if errors.Is(err, keyring.ErrNotFound) && create {
		key := make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		encoded = base64.StdEncoding.EncodeToString(key)
		clear(key)
		if err = keyring.Set(service, account, encoded); err != nil {
			return nil, fmt.Errorf("store desktop encryption key in OS credential store: %w", err)
		}
	} else if err != nil {
		return nil, fmt.Errorf("unlock OS credential store to access saved credentials: %w", err)
	}
	desktopCredentialVault.encryptor, err = secretcrypto.NewEncryptor(encoded)
	return desktopCredentialVault.encryptor, err
}

func encryptDesktopCredential(value, table, id, column string) (string, error) {
	if value == "" {
		return "", nil
	}
	encryptor, err := desktopCredentialEncryptor(false)
	if err != nil {
		return "", err
	}
	return encryptor.EncryptWithAAD(value, secretcrypto.SecretAAD(table, id, column))
}

func decryptDesktopCredential(value, table, id, column string) (string, error) {
	if value == "" {
		return "", nil
	}
	encryptor, err := desktopCredentialEncryptor(false)
	if err != nil {
		return "", err
	}
	return encryptor.DecryptWithAAD(value, secretcrypto.SecretAAD(table, id, column))
}

// Called before any credential writes. Never replace a missing root key while
// the database still contains protected material.
func initializeDesktopCredentials(db *sql.DB) error {
	var hasSecrets bool
	if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM desktop_servers WHERE password <> '') OR EXISTS(SELECT 1 FROM desktop_ssh_keys WHERE private_key <> '') OR EXISTS(SELECT 1 FROM desktop_sync_state WHERE token <> '') OR EXISTS(SELECT 1 FROM desktop_ai_config WHERE custom_api_key <> '') OR EXISTS(SELECT 1 FROM desktop_sync_objects)`).Scan(&hasSecrets); err != nil {
		return err
	}
	_, err := desktopCredentialEncryptor(!hasSecrets)
	return err
}

// Old data directories continue using the original vault entry. Restored
// directories carry only an account identifier, never a plaintext key.
func desktopCredentialAccount(directory string) (string, error) {
	b, err := os.ReadFile(filepath.Join(directory, ".easyssh-key-account"))
	if os.IsNotExist(err) {
		return "credential-encryption-v1", nil
	}
	if err != nil {
		return "", err
	}
	value := strings.TrimSpace(string(b))
	suffix := strings.TrimPrefix(value, "credential-encryption-v1/")
	if suffix == value || len(suffix) != 64 {
		return "", errors.New("invalid desktop credential account")
	}
	if _, err := hex.DecodeString(suffix); err != nil {
		return "", err
	}
	return value, nil
}
