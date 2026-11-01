package sshkey_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/security"
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
	if err := db.AutoMigrate(&serverdomain.Server{}, &serverdomain.ServerAuth{}, &serverdomain.ServerTag{}, &serverdomain.ServerGroup{}, &sshkey.SSHKey{}, &security.SecurityConfig{}, &auth.Owner{}, &auth.Session{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	e, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	svc := sshkey.NewService(sshkey.NewRepository(db, e), e)
	ctx := context.Background()
	owners, err := auth.NewService(db, e, access.NewRuntime())
	if err != nil {
		t.Fatal(err)
	}
	ownerRow, err := owners.Initialize(ctx, "fixture", "fixture@example.test", "Acceptance-2026-Only9")
	if err != nil {
		t.Fatal(err)
	}
	login, err := owners.Login(ctx, protocol.OwnerLoginInput{Email: ownerRow.Email, Password: "Acceptance-2026-Only9"}, auth.SessionInfo{})
	if err != nil {
		t.Fatal(err)
	}
	scope, _, err := owners.Authenticate(ctx, login.Token, "", false)
	if err != nil {
		t.Fatal(err)
	}
	_, raw, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKeyWithPassphrase(raw, "test", []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	material := strings.TrimSpace(string(pem.EncodeToMemory(block)))
	first, err := svc.ImportKeyPair(ctx, scope, &protocol.SSHKeyImportInput{Name: "one", PrivateKey: material, Passphrase: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	publicJSON, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	var publicFields map[string]json.RawMessage
	if err := json.Unmarshal(publicJSON, &publicFields); err != nil {
		t.Fatal(err)
	}
	if _, leaked := publicFields["private_key"]; leaked || !first.HasPrivateKey {
		t.Fatal("import response exposed private key or lost availability metadata")
	}
	plainBlock, err := ssh.MarshalPrivateKey(raw, "test")
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.ImportKeyPair(ctx, scope, &protocol.SSHKeyImportInput{Name: "two", PrivateKey: string(pem.EncodeToMemory(plainBlock))})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || !second.PassphraseRequired {
		t.Fatal("duplicate import replaced the protected key")
	}
	saved, err := svc.GetKey(ctx, scope, first.ID)
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
	if _, err := svc.GetKey(ctx, access.Scope{}, first.ID); err == nil {
		t.Fatal("unauthenticated credential access permitted")
	}
	connection := serverdomain.Server{ID: uuid.New(), Host: "example.test", Username: "user", Auth: serverdomain.ServerAuth{AuthMethod: serverdomain.AuthMethodKey, SSHKeyID: &first.ID}}
	if err := db.Create(&connection).Error; err != nil {
		t.Fatal(err)
	}
	references, err := svc.KeyReferences(ctx, scope, first.ID)
	if err != nil || references.KeyID != first.ID || len(references.References) != 1 || references.References[0].ID != connection.ID || references.References[0].Name != connection.Host {
		t.Fatalf("missing key references: %+v %v", references, err)
	}
	if _, err := svc.KeyReferences(ctx, access.Scope{}, first.ID); err == nil {
		t.Fatal("unauthenticated key references exposed")
	}
	if err := svc.DeleteKey(ctx, scope, first.ID); err == nil {
		t.Fatal("deleted referenced key")
	}
	if err := db.Model(&connection.Auth).Update("ssh_key_id", nil).Error; err != nil {
		t.Fatal(err)
	}
	if references, err := svc.KeyReferences(ctx, scope, first.ID); err != nil || references.References == nil || len(references.References) != 0 {
		t.Fatalf("detached key retained references: %+v %v", references, err)
	}
	if err := db.Model(saved).Updates(map[string]any{"private_key": "", "passphrase_required": false}).Error; err != nil {
		t.Fatal(err)
	}
	completed, err := svc.ImportKeyPair(ctx, scope, &protocol.SSHKeyImportInput{Name: "complete", PrivateKey: material, Passphrase: "secret"})
	if err != nil || completed.ID != first.ID || !completed.PassphraseRequired {
		t.Fatalf("metadata completion failed: %v", err)
	}
	saved, err = svc.GetKey(ctx, scope, first.ID)
	if err != nil || !strings.HasPrefix(saved.PrivateKey, "enc:v2:") {
		t.Fatalf("missing encrypted material: %v", err)
	}
	if err := svc.DeleteKey(ctx, scope, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.KeyReferences(ctx, scope, first.ID); err == nil {
		t.Fatal("deleted key reported as an unused existing key")
	}
}
