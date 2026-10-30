package app

import (
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/pem"
	"github.com/easyssh/shared/protocol"
	"path/filepath"
	"strings"
	"testing"

	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/google/uuid"
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
	input := protocol.SSHKeyImportInput{Name: "protected", PrivateKey: material, Passphrase: "secret"}
	first, err := svc.ImportSSHKey(input)
	if err != nil {
		t.Fatal(err)
	}
	plainBlock, err := ssh.MarshalPrivateKey(raw, "test")
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.ImportSSHKey(protocol.SSHKeyImportInput{Name: "duplicate", PrivateKey: string(pem.EncodeToMemory(plainBlock))})
	if err != nil || first.ID != second.ID || !second.PassphraseRequired {
		t.Fatalf("duplicate import changed protected key: %v", err)
	}
	var stored string
	if err := svc.db.QueryRow("SELECT private_key FROM desktop_ssh_keys WHERE id = ?", first.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stored, "enc:v2:") {
		t.Fatal("private key stored without encryption")
	}
	keyID := first.ID.String()
	resolved, err := svc.resolveSSHKey(&keyID)
	if err != nil || resolved != material {
		t.Fatalf("private key changed: %v", err)
	}
	if _, err := decryptDesktopCredential(stored, "desktop_ssh_keys", "another-key-id", "private_key"); err == nil {
		t.Fatal("accepted substituted private key")
	}
	connectionID := uuid.New()
	if _, err := svc.db.Exec("INSERT INTO desktop_servers (id, name, host, username, created_at, updated_at) VALUES (?, 'attached', 'example.test', 'user', '', '')", connectionID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.db.Exec("INSERT INTO desktop_server_auth(server_id,auth_method,ssh_key_id) VALUES(?,'key',?)", connectionID, first.ID); err != nil {
		t.Fatal(err)
	}
	references, err := svc.ListSSHKeyReferences(first.ID.String())
	if err != nil || references.KeyID != first.ID || len(references.References) != 1 || references.References[0].ID != connectionID || references.References[0].Name != "attached" {
		t.Fatalf("missing local key references: %+v %v", references, err)
	}
	keys, err := svc.ListSSHKeys()
	if err != nil || len(keys) != 1 || !keys[0].HasPrivateKey || keys[0].CreatedAt.IsZero() || keys[0].UpdatedAt.IsZero() {
		t.Fatalf("invalid generated key metadata: %+v %v", keys, err)
	}
	if err := svc.DeleteSSHKey(first.ID.String()); err == nil {
		t.Fatal("deleted referenced key")
	}
	if _, err := svc.db.Exec("UPDATE desktop_server_auth SET ssh_key_id = NULL"); err != nil {
		t.Fatal(err)
	}
	if references, err := svc.ListSSHKeyReferences(first.ID.String()); err != nil || references.References == nil || len(references.References) != 0 {
		t.Fatalf("detached local key retained references: %+v %v", references, err)
	}
	if _, err := svc.db.Exec("UPDATE desktop_ssh_keys SET private_key = '', passphrase_required = 0 WHERE id = ?", first.ID); err != nil {
		t.Fatal(err)
	}
	completed, err := svc.ImportSSHKey(input)
	if err != nil || completed.ID != first.ID || !completed.PassphraseRequired {
		t.Fatalf("metadata completion failed: %v", err)
	}
	resolved, err = svc.resolveSSHKey(&keyID)
	if err != nil || resolved != material {
		t.Fatalf("completed material changed: %v", err)
	}
	if err := svc.DeleteSSHKey(first.ID.String()); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ListSSHKeyReferences(first.ID.String()); err == nil {
		t.Fatal("deleted local key reported as an unused existing key")
	}
}
