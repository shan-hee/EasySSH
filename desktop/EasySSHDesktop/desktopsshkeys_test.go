package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/pem"
	"path/filepath"
	"strings"
	"testing"

	crypto "github.com/easyssh/shared/secretcrypto"
	"golang.org/x/crypto/ssh"
)

// Tests use a temporary database and an in-memory root, never the OS keyring.
func newSSHKeyTestService(t *testing.T) *DesktopServerService {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "keys.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := configureDesktopDatabase(db); err != nil {
		t.Fatal(err)
	}
	e, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	desktopCredentialVault.Lock()
	previous := desktopCredentialVault.encryptor
	desktopCredentialVault.encryptor = e
	desktopCredentialVault.Unlock()
	t.Cleanup(func() {
		desktopCredentialVault.Lock()
		desktopCredentialVault.encryptor = previous
		desktopCredentialVault.Unlock()
	})
	return &DesktopServerService{db: db}
}

func TestDesktopSSHKeyReuseEncryptionAndReferences(t *testing.T) {
	svc := newSSHKeyTestService(t)
	_, raw, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKeyWithPassphrase(raw, "test", []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	material := strings.TrimSpace(string(pem.EncodeToMemory(block)))
	input := DesktopSSHKeyImport{Name: "protected", PrivateKey: material, Passphrase: "secret"}
	first, err := svc.ImportSSHKey(input)
	if err != nil {
		t.Fatal(err)
	}
	plainBlock, err := ssh.MarshalPrivateKey(raw, "test")
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.ImportSSHKey(DesktopSSHKeyImport{Name: "duplicate", PrivateKey: string(pem.EncodeToMemory(plainBlock))})
	if err != nil || first.ID != second.ID || !second.PassphraseRequired {
		t.Fatalf("duplicate import changed protected key: %v", err)
	}
	var stored string
	if err := svc.db.QueryRow("SELECT private_key FROM desktop_ssh_keys WHERE id = ?", first.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !crypto.HasEncryptedPrefix(stored) {
		t.Fatal("private key stored without encryption")
	}
	resolved, err := svc.resolveSSHKey(&first.ID)
	if err != nil || resolved != material {
		t.Fatalf("private key changed: %v", err)
	}
	if _, err := decryptDesktopCredential(stored, "desktop_ssh_keys", "another-fingerprint", "private_key"); err == nil {
		t.Fatal("accepted substituted private key")
	}
	if _, err := svc.db.Exec("INSERT INTO desktop_servers (id, host, username, ssh_key_id, created_at, updated_at) VALUES ('connection', 'example.test', 'user', ?, '', '')", first.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteSSHKey(first.ID); err == nil {
		t.Fatal("deleted referenced key")
	}
	if _, err := svc.db.Exec("UPDATE desktop_servers SET ssh_key_id = NULL"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.db.Exec("UPDATE desktop_ssh_keys SET private_key = '', passphrase_required = 0 WHERE id = ?", first.ID); err != nil {
		t.Fatal(err)
	}
	completed, err := svc.ImportSSHKey(input)
	if err != nil || completed.ID != first.ID || !completed.PassphraseRequired {
		t.Fatalf("metadata completion failed: %v", err)
	}
	resolved, err = svc.resolveSSHKey(&first.ID)
	if err != nil || resolved != material {
		t.Fatalf("completed material changed: %v", err)
	}
	if err := svc.DeleteSSHKey(first.ID); err != nil {
		t.Fatal(err)
	}
}
