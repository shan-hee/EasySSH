package server

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

// Existing SQLite records may have been written using RFC3339 or a driver's
// timestamp format. A fresh snapshot must remain editable in either case.
func TestServerUpdateAcceptsStoredTimestampFormats(t *testing.T) {
	for _, timestamp := range []string{
		"2026-10-10T14:41:33.987876923+08:00",
		"2026-09-22T07:16:52.240147443Z",
		"2026-10-10 14:41:33.987876923+08:00",
		"2026-09-22 07:16:52.240147443+00:00",
	} {
		t.Run(timestamp, func(t *testing.T) {
			repo, db := newServerTestRepository(t)
			ctx := groupContext(t, false)
			jump := &Server{ID: uuid.New(), Host: "jump.test", Port: 22, Username: "owner", Auth: ServerAuth{AuthMethod: AuthMethodPassword}}
			target := &Server{ID: uuid.New(), Host: "target.test", Port: 22, Username: "owner", Auth: ServerAuth{AuthMethod: AuthMethodPassword}}
			for _, row := range []*Server{jump, target} {
				if err := repo.Create(ctx, row); err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Exec("UPDATE servers SET updated_at=? WHERE id=?", timestamp, target.ID).Error; err != nil {
				t.Fatal(err)
			}
			fresh, err := repo.FindByID(ctx, target.ID)
			if err != nil {
				t.Fatal(err)
			}
			fresh.JumpServerID = &jump.ID
			if err := repo.Update(ctx, fresh); err != nil {
				t.Fatalf("fresh owner edit rejected for stored timestamp %q: %v", timestamp, err)
			}
			saved, err := repo.FindByID(ctx, target.ID)
			if err != nil || saved.JumpServerID == nil || *saved.JumpServerID != jump.ID || saved.ConnectionRevision != target.ConnectionRevision+1 {
				t.Fatalf("jump association was not persisted: %v", err)
			}
		})
	}
}

func TestServerUpdateRejectsStaleTimestampAtSameConnectionRevision(t *testing.T) {
	repo, db := newServerTestRepository(t)
	ctx := groupContext(t, false)
	row := &Server{ID: uuid.New(), Host: "target.test", Port: 22, Username: "owner", Auth: ServerAuth{AuthMethod: AuthMethodPassword}}
	if err := repo.Create(ctx, row); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE servers SET updated_at=? WHERE id=?", "2026-09-22T07:16:52.240147443Z", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	stale, err := repo.FindByID(ctx, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("UPDATE servers SET name=?,updated_at=? WHERE id=?", "concurrent edit", "2026-09-22T07:16:52.240147444Z", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	stale.Name = "stale edit"
	if err := repo.Update(ctx, stale); !errors.Is(err, ErrServerUpdateConflict) {
		t.Fatalf("stale edit was not rejected: %v", err)
	}
	saved, err := repo.FindByID(ctx, row.ID)
	if err != nil || saved.Name != "concurrent edit" {
		t.Fatalf("concurrent edit was overwritten: %v", err)
	}
}
