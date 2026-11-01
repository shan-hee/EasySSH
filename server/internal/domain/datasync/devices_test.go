package datasync

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestDeviceScopesStayBoundToLiveOwnerDevice(t *testing.T) {
	s := newSyncTestService(t)
	if err := s.DB.AutoMigrate(&Device{}); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	device := Device{ID: uuid.New(), OwnerID: uuid.New(), Name: "desktop", TokenHash: "device-secret-hash", ExpiresAt: time.Now().UTC().Add(time.Hour), Scopes: syncdata.SyncScopes{Credentials: true}}
	if err := s.DB.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateDeviceScopes(ctx, uuid.New(), device.ID, syncdata.SyncScopes{}); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("foreign owner updated scope: %v", err)
	}
	updated, err := s.UpdateDeviceScopes(ctx, device.OwnerID, device.ID, syncdata.SyncScopes{Sessions: true})
	if err != nil || updated.Scopes.Credentials || !updated.Scopes.Sessions || updated.TokenHash != device.TokenHash || !updated.ExpiresAt.Equal(device.ExpiresAt) {
		t.Fatalf("scope update changed device identity: %+v %v", updated.Public(), err)
	}
	if _, err := s.UpdateDeviceScopes(ctx, device.OwnerID, device.ID, updated.Scopes); err != nil {
		t.Fatal("unchanged scope update failed", err)
	}
	if err := s.RevokeDevice(ctx, uuid.New(), device.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("foreign owner revoked device", err)
	}
	if err := s.RevokeDevice(ctx, device.OwnerID, device.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateDeviceScopes(ctx, device.OwnerID, device.ID, device.Scopes); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("scope update revived revoked device", err)
	}
	actor := protocol.Actor{Kind: protocol.Device, ID: device.OwnerID.String(), SessionID: device.ID.String()}
	if err := s.Authorize(ctx, actor, access.Requirement{Action: protocol.SyncRead}); !errors.Is(err, access.ErrUnauthenticated) {
		t.Fatal("revoked device still authenticated", err)
	}
	if err := s.DB.Model(&Device{}).Where("id=?", device.ID).Updates(map[string]any{"revoked": false, "expires_at": time.Now().UTC().Add(-time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateDeviceScopes(ctx, device.OwnerID, device.ID, device.Scopes); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("scope update revived expired device", err)
	}
}
