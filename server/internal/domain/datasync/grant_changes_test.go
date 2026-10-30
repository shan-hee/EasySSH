package datasync

import (
	"errors"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/grant"
	servermodel "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestSyncPasswordRotationPreservesSharesAndRemovalReportsCommittedChanges(t *testing.T) {
	s := newSyncTestService(t)
	owner := uuid.New()
	ctx := syncActivityContext(t, owner)
	if err := s.DB.AutoMigrate(&servermodel.Server{}, &grant.Grant{}, &grant.Resource{}); err != nil {
		t.Fatal(err)
	}
	row := servermodel.Server{ID: uuid.New(), Host: "host.test", Name: "host", Port: 22, Username: "owner", Auth: servermodel.ServerAuth{AuthMethod: servermodel.AuthMethodPassword}}
	secret, err := s.Encryptor.EncryptSecret("before", row.CredentialAAD("password"))
	if err != nil {
		t.Fatal(err)
	}
	row.Auth.Password = secret
	if err := s.DB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	liveID := uuid.New()
	for i, id := range []uuid.UUID{liveID, uuid.New(), uuid.New()} {
		g := grant.Grant{ID: id, PublicID: id.String(), SecretHash: id.String(), Name: "share", Version: 1}
		past := time.Now().Add(-time.Hour)
		if i == 1 {
			g.RevokedAt = &past
		}
		if i == 2 {
			g.ExpiresAt = &past
		}
		if err := s.DB.Create(&g).Error; err != nil {
			t.Fatal(err)
		}
		if err := s.DB.Create(&grant.Resource{GrantID: id, ServerID: row.ID, ApprovedConnectionRevision: row.ConnectionRevision, Actions: []protocol.Action{protocol.FilesRead}}).Error; err != nil {
			t.Fatal(err)
		}
	}
	before, err := captureSyncGrantResources(s.DB, []uuid.UUID{row.ID})
	if err != nil || len(before) != 1 || before[0].GrantID != liveID {
		t.Fatalf("inactive shares leaked into affected list: %+v %v", before, err)
	}
	payload := syncdata.VaultPayload{Kind: "credential", Credential: &syncdata.Credential{Password: "before", Connection: syncdata.JSON(connectionSnapshot(row))}}
	apply := func(password string) []protocol.SyncAffectedGrant {
		t.Helper()
		payload.Credential.Password = password
		var changes []protocol.SyncAffectedGrant
		err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := s.applyVault(tx, owner, "credential", row.ID.String(), payload); err != nil {
				return err
			}
			var err error
			changes, err = resolveSyncGrantChanges(tx, before)
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		return changes
	}
	if changes := apply("before"); len(changes) != 0 {
		t.Fatal("equivalent password paused share", changes)
	}
	if changes := apply("after"); len(changes) != 0 {
		t.Fatal("password rotation paused existing share", changes)
	}
	before, err = captureSyncGrantResources(s.DB, []uuid.UUID{row.ID})
	if err != nil {
		t.Fatal(err)
	}
	if changes := apply("after"); len(changes) != 0 {
		t.Fatal("repeating synchronized value changed revision", changes)
	}
	rollback := errors.New("rollback")
	err = s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().Delete(&servermodel.Server{}, "id=?", row.ID).Error; err != nil {
			return err
		}
		changes, err := resolveSyncGrantChanges(tx, before)
		if err != nil || len(changes) != 1 || changes[0].Reason != "resource_deleted" || changes[0].ServerName != row.Name {
			t.Fatalf("deletion lost resource snapshot: %+v %v", changes, err)
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	if changes, err := resolveSyncGrantChanges(s.DB, before); err != nil || len(changes) != 0 {
		t.Fatalf("rolled-back removal reported as committed: %+v %v", changes, err)
	}
}
