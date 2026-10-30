package auth

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestKnownLoginDeviceUpsertKeepsIdentity(t *testing.T) {
	s, _, owner, _, _ := ownerActivityFixture(t)
	repo := NewKnownLoginDeviceRepository(s.db)
	ctx := context.Background()
	first := &KnownLoginDevice{OwnerID: owner.ID, DeviceFingerprint: "browser", LastIPAddress: "192.0.2.1"}
	if err := repo.Upsert(ctx, first); err != nil {
		t.Fatal(err)
	}
	second := &KnownLoginDevice{OwnerID: owner.ID, DeviceFingerprint: "browser", LastIPAddress: "192.0.2.2", LastUsed: time.Now().Add(time.Minute)}
	if err := repo.Upsert(ctx, second); err != nil {
		t.Fatal(err)
	}
	rows, err := repo.ListByOwner(ctx, owner.ID)
	if err != nil || len(rows) != 1 {
		t.Fatalf("devices = %v, error = %v", rows, err)
	}
	if rows[0].ID != first.ID || rows[0].LastIPAddress != second.LastIPAddress {
		t.Fatalf("upsert changed identity or lost latest observation: %+v", rows[0])
	}
	// The database key, rather than a preceding read, rejects duplicate inserts.
	duplicate := &KnownLoginDevice{OwnerID: owner.ID, DeviceFingerprint: "browser"}
	if err := s.db.Create(duplicate).Error; err == nil {
		t.Fatal("duplicate owner/fingerprint accepted")
	}
	other, err := repo.FindByOwnerAndFingerprint(ctx, uuid.New(), "browser")
	if err != nil || other != nil {
		t.Fatalf("observation crossed owner boundary: %v, %v", other, err)
	}
}

func TestLoginDetectionReusesObservedBrowser(t *testing.T) {
	s, _, owner, _, _ := ownerActivityFixture(t)
	repo := NewKnownLoginDeviceRepository(s.db)
	detector := NewLoginDetectionService(repo, s.repo, nil, nil)
	ctx := context.Background()
	first := &Session{OwnerID: owner.ID, IPAddress: "192.0.2.1"}
	if err := detector.RecordLogin(ctx, owner.ID, first, "browser"); err != nil {
		t.Fatal(err)
	}
	if !first.IsNewDevice || first.IsNewLocation {
		t.Fatalf("unexpected first observation: %+v", first)
	}
	second := &Session{OwnerID: owner.ID, IPAddress: "192.0.2.2"}
	if err := detector.RecordLogin(ctx, owner.ID, second, "browser"); err != nil {
		t.Fatal(err)
	}
	if second.IsNewDevice || second.IsNewLocation {
		t.Fatal("known browser or unavailable GeoIP treated as new")
	}
	if err := detector.RecordLogin(ctx, owner.ID, &Session{}, ""); err != nil {
		t.Fatal(err)
	}
	rows, err := repo.ListByOwner(ctx, owner.ID)
	if err != nil || len(rows) != 1 {
		t.Fatalf("empty fingerprint created a device: %v, %v", rows, err)
	}
}
