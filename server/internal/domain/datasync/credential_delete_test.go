package datasync

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	servermodel "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestConnectionDeletionRemovesOnlyItsCredentialHistory(t *testing.T) {
	for _, mode := range []string{"manual", "sync"} {
		t.Run(mode, func(t *testing.T) {
			s := newSyncTestService(t)
			if err := s.DB.AutoMigrate(&servermodel.Server{}, &servermodel.ServerAuth{}, &servermodel.ServerTag{}, &servermodel.ServerGroup{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
				t.Fatal(err)
			}
			owner, id, other := uuid.New(), uuid.New(), uuid.New()
			for _, target := range []uuid.UUID{id, other} {
				row := servermodel.Server{ID: target, Host: "host.test", Port: 22, Username: "owner", Auth: servermodel.ServerAuth{AuthMethod: servermodel.AuthMethodPassword}}
				if err := s.DB.Create(&row).Error; err != nil {
					t.Fatal(err)
				}
				if err := s.DB.Create(&VaultDocument{OwnerID: owner, Kind: "credential", ResourceID: target.String()}).Error; err != nil {
					t.Fatal(err)
				}
				for range 2 {
					if err := s.DB.Create(&VaultObject{OwnerID: owner, ID: uuid.NewString(), Kind: "credential", ResourceID: target.String(), Ciphertext: Document("stored-secret")}).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			// A conversation may use the same UUID; deletion is scoped to credential kind.
			if err := s.DB.Create(&VaultObject{OwnerID: owner, ID: uuid.NewString(), Kind: "ai_session", ResourceID: id.String(), Ciphertext: Document("conversation")}).Error; err != nil {
				t.Fatal(err)
			}
			failed := errors.New("later write failed")
			err := s.DB.Transaction(func(tx *gorm.DB) error {
				if err := servermodel.DeleteConfiguration(tx, id); err != nil {
					return err
				}
				return failed
			})
			if !errors.Is(err, failed) {
				t.Fatal(err)
			}
			var count int64
			if err := s.DB.Model(&VaultObject{}).Where("kind='credential' AND resource_id=?", id).Count(&count).Error; err != nil || count != 2 {
				t.Fatalf("rollback lost credentials: %d %v", count, err)
			}
			if mode == "manual" {
				runtime := access.NewRuntime()
				defer runtime.Close()
				scope, scopeErr := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: owner.String(), SessionID: uuid.NewString()}, time.Now().Add(time.Hour), credentialDeleteAuthority{})
				if scopeErr != nil {
					t.Fatal(scopeErr)
				}
				err = servermodel.NewRepository(s.DB, runtime).Delete(access.WithScope(context.Background(), scope), id)
			} else {
				err = s.DB.WithContext(syncActivityContext(t, owner)).Transaction(func(tx *gorm.DB) error {
					return apply(tx, s.Encryptor, syncdata.Snapshot{"server/" + id.String(): syncdata.Record{"connection": syncdata.JSON(syncdata.Connection{Host: "host.test", Port: 22, Username: "owner", AuthMethod: "password"})}}, syncdata.Snapshot{syncdata.ServerOrderKey: {"ids": "[]"}})
				})
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, table := range []string{"sync_vault_objects", "sync_vault_documents"} {
				if err := s.DB.Table(table).Where("kind='credential' AND resource_id=?", id).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("deleted target remains in %s: %d %v", table, count, err)
				}
			}
			if err := s.DB.Model(&VaultObject{}).Count(&count).Error; err != nil || count != 3 {
				t.Fatalf("unrelated data removed: %d %v", count, err)
			}
			input := syncdata.VaultPayload{Kind: "credential", Credential: &syncdata.Credential{Connection: syncdata.JSON(syncdata.Connection{Host: "host.test", Port: 22, Username: "owner", AuthMethod: "password"}), Password: "late-secret"}}
			if err := s.PutVaultObject(context.Background(), owner, "credential", uuid.NewString(), id.String(), syncdata.JSON(input)); !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("late credential accepted: %v", err)
			}
			if _, err := s.VaultExchange(context.Background(), owner, "credential", id.String(), Peer{}, nil); !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("deleted target exchange accepted: %v", err)
			}
		})
	}
}

type credentialDeleteAuthority struct {
	testutil.AccessPolicy
}

func (credentialDeleteAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
