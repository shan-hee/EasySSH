package server

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type groupAuthority struct {
	testutil.AccessPolicy
}

func (groupAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func groupContext(t *testing.T, visitor bool) context.Context {
	t.Helper()
	actor := protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}
	if visitor {
		actor.Kind = protocol.Visitor
		actor.ID = actor.SessionID
		actor.GrantID = uuid.NewString()
	}
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), groupAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}

func TestGroupRenameAndDeletePreserveServerIdentity(t *testing.T) {
	repo, db := newServerTestRepository(t)
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	raw.SetMaxOpenConns(1)
	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		t.Fatal(err)
	}
	ctx := groupContext(t, false)
	groups := NewGroupService(db)
	group, err := groups.Create(ctx, protocol.ServerGroupInput{Name: "production"})
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.MustParse(group.ID)
	row := &Server{ID: uuid.New(), Host: "host", Username: "owner", GroupID: &id, Auth: ServerAuth{AuthMethod: AuthMethodPassword, Password: "opaque-secret"}}
	if err := repo.Create(ctx, row); err != nil {
		t.Fatal(err)
	}
	revision := row.ConnectionRevision
	if _, err := groups.Update(ctx, id, protocol.ServerGroupInput{Name: "renamed", SortOrder: 3}); err != nil {
		t.Fatal(err)
	}
	got, err := repo.FindByID(ctx, row.ID)
	if err != nil || got.Group != "renamed" || got.GroupID == nil || *got.GroupID != id || got.ConnectionRevision != revision {
		t.Fatalf("rename changed identity: %+v %v", got, err)
	}
	if err := groups.Delete(ctx, id); err != nil {
		t.Fatal(err)
	}
	got, err = repo.FindByID(ctx, row.ID)
	if err != nil || got.GroupID != nil || got.Group != "" || got.Auth.Password != "opaque-secret" || got.ConnectionRevision != revision {
		t.Fatalf("delete removed connection or trust: %+v %v", got, err)
	}
	invalid := uuid.New()
	got.GroupID = &invalid
	if err := repo.Update(ctx, got); !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("dangling group: %v", err)
	}
	var facts []operationrecord.OperationRecord
	if err := db.Where("action IN ?", []string{"server_group_create", "server_group_update", "server_group_delete"}).Find(&facts).Error; err != nil || len(facts) != 3 {
		t.Fatalf("missing group facts: %d %v", len(facts), err)
	}
	for _, fact := range facts {
		if fact.Action == "server_group_create" {
			continue
		}
		var snapshot operationrecord.Resource
		if err := db.First(&snapshot, "record_id=? AND server_id=?", fact.ID, row.ID).Error; err != nil {
			t.Fatalf("group mutation lost affected server: %v", err)
		}
	}
}

func TestGroupMutationRollsBackWhenActivityCannotBeSaved(t *testing.T) {
	for _, action := range []string{"create", "update", "delete"} {
		t.Run(action, func(t *testing.T) {
			_, db := newServerTestRepository(t)
			ctx := groupContext(t, false)
			service := NewGroupService(db)
			group, err := service.Create(ctx, protocol.ServerGroupInput{Name: "before", SortOrder: 1})
			if err != nil {
				t.Fatal(err)
			}
			id := uuid.MustParse(group.ID)
			if err := db.Exec(`CREATE TRIGGER reject_group_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
				t.Fatal(err)
			}
			switch action {
			case "create":
				_, err = service.Create(ctx, protocol.ServerGroupInput{Name: "new"})
			case "update":
				_, err = service.Update(ctx, id, protocol.ServerGroupInput{Name: "after", SortOrder: 2})
			case "delete":
				err = service.Delete(ctx, id)
			}
			if err == nil {
				t.Fatal("group mutation succeeded without activity")
			}
			var rows []ServerGroup
			if err := db.Find(&rows).Error; err != nil || len(rows) != 1 || rows[0].Public() != group {
				t.Fatalf("group mutation was not rolled back: %+v %v", rows, err)
			}
		})
	}
}

func TestVisitorCannotMaintainGroups(t *testing.T) {
	_, db := newServerTestRepository(t)
	service := NewGroupService(db)
	ctx := groupContext(t, true)
	if _, err := service.Create(ctx, protocol.ServerGroupInput{Name: "forbidden"}); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("create: %v", err)
	}
	if _, err := service.List(ctx, 1, 20); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("list: %v", err)
	}
	if err := service.Delete(ctx, uuid.New()); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("delete: %v", err)
	}
}

func TestSyncGroupRetainsUUIDAndRollsBackWithResource(t *testing.T) {
	_, db := newServerTestRepository(t)
	ref := protocol.ServerGroup{ID: uuid.NewString(), Name: "shared", SortOrder: 7}
	failure := errors.New("later resource write failed")
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := SaveSyncGroup(tx, ref); err != nil {
			return err
		}
		return failure
	})
	if !errors.Is(err, failure) {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&ServerGroup{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("orphan group committed: %d %v", count, err)
	}
	if err := SaveSyncGroup(db, ref); err != nil {
		t.Fatal(err)
	}
	ref.Name = "renamed"
	if err := SaveSyncGroup(db, ref); err != nil {
		t.Fatal(err)
	}
	var row ServerGroup
	if err := db.First(&row, "id=?", ref.ID).Error; err != nil || row.Name != "renamed" {
		t.Fatalf("rename replaced identity: %+v %v", row, err)
	}
}
