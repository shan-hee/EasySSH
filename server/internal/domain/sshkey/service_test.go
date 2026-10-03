package sshkey_test

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"

	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sshkey"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"
)

func TestImportKeyReuseOwnershipAndDeletion(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := db.AutoMigrate(&serverdomain.Server{}); err != nil {
		t.Fatal(err)
	}
	e, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	svc := sshkey.NewService(sshkey.NewRepository(db), e)
	owner, other := uuid.New(), uuid.New()
	_, raw, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKeyWithPassphrase(raw, "test", []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	material := strings.TrimSpace(string(pem.EncodeToMemory(block)))
	first, err := svc.ImportKeyPair(&sshkey.ImportSSHKeyRequest{Name: "one", PrivateKey: material, Passphrase: "secret"}, owner)
	if err != nil {
		t.Fatal(err)
	}
	plainBlock, err := ssh.MarshalPrivateKey(raw, "test")
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.ImportKeyPair(&sshkey.ImportSSHKeyRequest{Name: "two", PrivateKey: string(pem.EncodeToMemory(plainBlock))}, owner)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || !second.PassphraseRequired {
		t.Fatal("duplicate import replaced the protected key")
	}
	saved, err := svc.GetKey(first.ID, owner)
	if err != nil {
		t.Fatal(err)
	}
	decrypted, err := e.DecryptSecret(saved.PrivateKey, saved.PrivateKeyAAD())
	if err != nil || decrypted != material {
		t.Fatalf("stored material changed: %v", err)
	}
	encoded, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "private_key") {
		t.Fatal("private key leaked in response")
	}
	if _, err := svc.GetKey(first.ID, other); err == nil {
		t.Fatal("cross-owner access permitted")
	}
	foreign, err := svc.ImportKeyPair(&sshkey.ImportSSHKeyRequest{Name: "foreign", PrivateKey: material, Passphrase: "secret"}, other)
	if err != nil || foreign.ID == first.ID {
		t.Fatalf("owners share an entry: %v", err)
	}
	connection := serverdomain.Server{ID: uuid.New(), UserID: owner, Host: "example.test", Username: "user", AuthMethod: serverdomain.AuthMethodKey, SSHKeyID: &first.ID}
	if err := db.Create(&connection).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteKey(first.ID, owner); err == nil {
		t.Fatal("deleted referenced key")
	}
	if err := db.Model(&connection).Update("ssh_key_id", nil).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(saved).Updates(map[string]any{"private_key": "", "passphrase_required": false}).Error; err != nil {
		t.Fatal(err)
	}
	completed, err := svc.ImportKeyPair(&sshkey.ImportSSHKeyRequest{Name: "complete", PrivateKey: material, Passphrase: "secret"}, owner)
	if err != nil || completed.ID != first.ID || !completed.PassphraseRequired {
		t.Fatalf("metadata completion failed: %v", err)
	}
	saved, err = svc.GetKey(first.ID, owner)
	if err != nil || !crypto.HasEncryptedPrefix(saved.PrivateKey) {
		t.Fatalf("missing encrypted material: %v", err)
	}
	if err := svc.DeleteKey(first.ID, owner); err != nil {
		t.Fatal(err)
	}
}
