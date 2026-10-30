package sshkey_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"github.com/easyssh/server/internal/testutil"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sshkey"
	"github.com/easyssh/server/internal/storage/schema"
	"github.com/easyssh/shared/protocol"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
	"github.com/easyssh/shared/syncdata"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"
)

type keyActivityAuthority struct {
	testutil.AccessPolicy
}

func (keyActivityAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}

func keyActivityFixture(t *testing.T) (*gorm.DB, *crypto.Encryptor, context.Context) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	raw.SetMaxOpenConns(1)
	t.Cleanup(func() { raw.Close() })
	if err := schema.Initialize(context.Background(), raw, "sqlite"); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("PRAGMA foreign_keys=ON").Error; err != nil {
		t.Fatal(err)
	}
	encryptor, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}, time.Now().Add(time.Hour), keyActivityAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return db, encryptor, access.WithScope(context.Background(), scope)
}

func keyActivityMaterial(t *testing.T) syncdata.KeyMaterial {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	phrase := "activity-test-passphrase"
	block, err := ssh.MarshalPrivateKeyWithPassphrase(privateKey, "fixture", []byte(phrase))
	if err != nil {
		t.Fatal(err)
	}
	material := strings.TrimSpace(string(pem.EncodeToMemory(block)))
	metadata, err := sshutil.InspectPrivateKey(material, phrase)
	if err != nil {
		t.Fatal(err)
	}
	return syncdata.KeyMaterial{ID: uuid.NewString(), Name: "fixture", PrivateKey: material, SavedPassphrase: phrase, PublicKey: metadata.PublicKey, Fingerprint: metadata.Fingerprint, Algorithm: metadata.Algorithm, KeySize: metadata.KeySize, PassphraseRequired: metadata.PassphraseRequired}
}

func TestKeyActivityCountsChangesAndRetainsReferencedResources(t *testing.T) {
	db, encryptor, ctx := keyActivityFixture(t)
	svc := sshkey.NewService(sshkey.NewRepository(db, encryptor), encryptor)
	scope, material := access.Current(ctx), keyActivityMaterial(t)
	input := &protocol.SSHKeyImportInput{Name: material.Name, PrivateKey: material.PrivateKey, Passphrase: material.SavedPassphrase}
	key, err := svc.ImportKeyPair(ctx, scope, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ImportKeyPair(ctx, scope, input); err != nil {
		t.Fatal(err)
	}
	server := serverdomain.Server{ID: uuid.New(), Name: "key target", Host: "host.test", Username: "owner", Auth: serverdomain.ServerAuth{AuthMethod: serverdomain.AuthMethodKey, SSHKeyID: &key.ID}}
	if err := db.Create(&server).Error; err != nil {
		t.Fatal(err)
	}
	for _, save := range []bool{true, true, false, false} {
		if err := svc.SetPassphrase(ctx, scope, key.ID, material.SavedPassphrase, save); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.DeleteKey(ctx, scope, key.ID); err == nil {
		t.Fatal("deleted referenced key")
	}
	if err := db.Model(&server.Auth).Update("ssh_key_id", nil).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteKey(ctx, scope, key.ID); err != nil {
		t.Fatal(err)
	}
	var facts []operationrecord.OperationRecord
	if err := db.Find(&facts).Error; err != nil {
		t.Fatal(err)
	}
	if len(facts) != 4 {
		t.Fatalf("duplicate import/passphrase save inflated activity: %d", len(facts))
	}
	for _, fact := range facts {
		if fact.Actor != scope.Actor() || fact.Status != operationrecord.StatusSuccess || fact.Source != "manual" {
			t.Fatalf("misattributed key activity: %+v", fact)
		}
		if strings.Contains(fact.DetailJSON, material.PrivateKey) || strings.Contains(fact.DetailJSON, material.SavedPassphrase) {
			t.Fatal("key secret entered activity detail")
		}
		if fact.Action == "ssh_key_passphrase_update" {
			var resource operationrecord.Resource
			if err := db.First(&resource, "record_id=? AND server_id=?", fact.ID, server.ID).Error; err != nil || resource.Name != server.Name {
				t.Fatalf("key activity lost target snapshot: %+v %v", resource, err)
			}
		}
	}
}

func TestKeyMutationsRollBackWithTheirActivity(t *testing.T) {
	for _, action := range []string{"generate", "import", "complete", "passphrase", "delete", "sync_create", "sync_complete"} {
		t.Run(action, func(t *testing.T) {
			db, encryptor, ctx := keyActivityFixture(t)
			svc := sshkey.NewService(sshkey.NewRepository(db, encryptor), encryptor)
			scope, material := access.Current(ctx), keyActivityMaterial(t)
			key, err := svc.ImportKeyPair(ctx, scope, &protocol.SSHKeyImportInput{Name: material.Name, PrivateKey: material.PrivateKey, Passphrase: material.SavedPassphrase})
			if err != nil {
				t.Fatal(err)
			}
			if action == "complete" || action == "sync_complete" {
				if err := db.Model(&sshkey.SSHKey{}).Where("id=?", key.ID).Updates(map[string]any{"private_key": "", "saved_passphrase": "", "passphrase_required": false}).Error; err != nil {
					t.Fatal(err)
				}
			}
			var before []sshkey.SSHKey
			if err := db.Order("id").Find(&before).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec(`CREATE TRIGGER reject_key_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
				t.Fatal(err)
			}
			switch action {
			case "generate":
				_, err = svc.GenerateKeyPair(ctx, scope, &protocol.SSHKeyGenerateInput{Name: "generated", Algorithm: "ed25519"})
			case "import", "complete":
				if action == "import" {
					material = keyActivityMaterial(t)
				}
				_, err = svc.ImportKeyPair(ctx, scope, &protocol.SSHKeyImportInput{Name: material.Name, PrivateKey: material.PrivateKey, Passphrase: material.SavedPassphrase})
			case "passphrase":
				err = svc.SetPassphrase(ctx, scope, key.ID, material.SavedPassphrase, true)
			case "delete":
				err = svc.DeleteKey(ctx, scope, key.ID)
			case "sync_create", "sync_complete":
				if action == "sync_create" {
					material = keyActivityMaterial(t)
				} else {
					material.ID = key.ID.String()
				}
				err = db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { _, err := sshkey.MergeSyncKey(tx, encryptor, &material); return err })
			}
			if err == nil {
				t.Fatal("key mutation committed without its activity")
			}
			var after []sshkey.SSHKey
			if err := db.Order("id").Find(&after).Error; err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("key mutation partially committed")
			}
			var count int64
			if err := db.Model(&operationrecord.OperationRecord{}).Count(&count).Error; err != nil || count != 1 {
				t.Fatalf("activity did not roll back: %d %v", count, err)
			}
		})
	}
}

func TestKeySyncCanonicalMergeCountsOnceAndKeepsReferences(t *testing.T) {
	db, encryptor, ctx := keyActivityFixture(t)
	actor := access.Current(ctx).Actor()
	actor.Kind = protocol.Device
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), keyActivityAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	ctx = access.WithScope(ctx, scope)
	material := keyActivityMaterial(t)
	material.ID = "ffffffff-ffff-4fff-bfff-ffffffffffff"
	merge := func() *sshkey.SSHKey {
		t.Helper()
		var key *sshkey.SSHKey
		if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var err error
			key, err = sshkey.MergeSyncKey(tx, encryptor, &material)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		return key
	}
	first := merge()
	server := serverdomain.Server{ID: uuid.New(), Name: "sync target", Host: "host.test", Username: "owner", Auth: serverdomain.ServerAuth{AuthMethod: serverdomain.AuthMethodKey, SSHKeyID: &first.ID}}
	if err := db.Create(&server).Error; err != nil {
		t.Fatal(err)
	}
	material.ID = "00000000-0000-4000-8000-000000000001"
	merged := merge()
	merge()
	var auth serverdomain.ServerAuth
	if err := db.First(&auth, "server_id=?", server.ID).Error; err != nil || auth.SSHKeyID == nil || *auth.SSHKeyID != merged.ID {
		t.Fatalf("canonical merge lost key reference: %+v %v", auth, err)
	}
	plain, err := encryptor.DecryptSecret(merged.PrivateKey, merged.PrivateKeyAAD())
	if err != nil || plain != material.PrivateKey {
		t.Fatal("canonical merge lost secret binding", err)
	}
	var facts []operationrecord.OperationRecord
	if err := db.Find(&facts).Error; err != nil || len(facts) != 2 {
		t.Fatalf("sync replay counted again: %d %v", len(facts), err)
	}
	for _, fact := range facts {
		if fact.Source != "automation" || fact.Actor != access.Current(ctx).Actor() {
			t.Fatal("sync activity misattributed")
		}
		var detail struct {
			ResourceID    string   `json:"resource_id"`
			ChangedFields []string `json:"changed_fields"`
		}
		if err := json.Unmarshal([]byte(fact.DetailJSON), &detail); err != nil {
			t.Fatal(err)
		}
		if detail.ResourceID == material.ID {
			if !reflect.DeepEqual(detail.ChangedFields, []string{"id"}) {
				t.Fatalf("identity normalization reported credential replacement: %+v", detail)
			}
			var snapshot operationrecord.Resource
			if err := db.First(&snapshot, "record_id=? AND server_id=?", fact.ID, server.ID).Error; err != nil {
				t.Fatal("sync merge lost affected server snapshot", err)
			}
		}
	}
}
