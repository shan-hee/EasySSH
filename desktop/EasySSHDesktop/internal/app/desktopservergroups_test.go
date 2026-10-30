package app

import (
	"github.com/easyssh/shared/protocol"
	"reflect"
	"testing"

	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

func TestDesktopGroupRenameDeleteAndTransaction(t *testing.T) {
	s := newSSHKeyTestService(t)
	group, err := s.CreateGroup(protocol.ServerGroupInput{Name: "production"})
	if err != nil {
		t.Fatal(err)
	}
	row, err := s.Create(protocol.ServerCreate{AuthMethod: protocol.ServerAuthMethod("password"), Name: "host", Host: "host", Username: "owner", GroupID: group.ID})
	if err != nil {
		t.Fatal(err)
	}
	before, err := s.getByIDStored(row.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateGroup(group.ID, protocol.ServerGroupInput{Name: "renamed", SortOrder: 8}); err != nil {
		t.Fatal(err)
	}
	got, err := s.getByIDStored(row.ID.String())
	if err != nil || got.GroupID != group.ID || got.Group != "renamed" || got.connectionRevision != before.connectionRevision {
		t.Fatalf("rename: %+v %v", got, err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_group_delete BEFORE INSERT ON desktop_configuration_events WHEN NEW.action='server_group_deleted' BEGIN SELECT RAISE(ABORT,'record unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteGroup(group.ID); err == nil {
		t.Fatal("deleted without activity")
	}
	got, err = s.getByIDStored(row.ID.String())
	if err != nil || got.GroupID != group.ID {
		t.Fatal("failed deletion detached server")
	}
	if _, err := s.db.Exec("DROP TRIGGER reject_group_delete"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteGroup(group.ID); err != nil {
		t.Fatal(err)
	}
	got, err = s.getByIDStored(row.ID.String())
	if err != nil || got.GroupID != "" || got.Group != "" || got.connectionRevision != before.connectionRevision {
		t.Fatalf("delete: %+v %v", got, err)
	}
	for _, action := range []string{"server_group_updated", "server_group_deleted"} {
		var name string
		if err := s.db.QueryRow(`SELECT r.name FROM desktop_configuration_events e JOIN desktop_activity_resources r ON r.activity_id=e.activity_id WHERE e.action=? AND e.resource_id=? AND r.server_id=?`, action, group.ID, row.ID.String()).Scan(&name); err != nil || name != "host" {
			t.Fatalf("group operation lost member snapshot: %s %q %v", action, name, err)
		}
	}
}

func TestDesktopGroupActivityListsOnlyChangedFields(t *testing.T) {
	s := newSSHKeyTestService(t)
	group, err := s.CreateGroup(protocol.ServerGroupInput{Name: "group", SortOrder: 3})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateGroup(group.ID, protocol.ServerGroupInput{Name: "renamed", SortOrder: 3}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateGroup(group.ID, protocol.ServerGroupInput{Name: "renamed", SortOrder: 3}); err != nil {
		t.Fatal(err)
	}
	var fields string
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*),MIN(changed_fields_json) FROM desktop_configuration_events WHERE action='server_group_updated' AND resource_id=?`, group.ID).Scan(&count, &fields); err != nil || count != 1 || fields != `["name"]` {
		t.Fatalf("group no-op or field list inflated activity: %d %s %v", count, fields, err)
	}
}

func TestDesktopGroupImportRetainsReferenceAndNativeBoundary(t *testing.T) {
	s := newSSHKeyTestService(t)
	ref := protocol.ServerGroup{ID: uuid.NewString(), Name: "remote metadata", SortOrder: 4}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	spaceID := uuid.NewString()
	if _, err := tx.Exec("INSERT INTO desktop_sync_spaces(id,instance_id,user_id,account_name,server_url) VALUES(?,?,?,?,?)", spaceID, uuid.NewString(), uuid.NewString(), "owner", "https://example.test"); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	ids := map[string]string{}
	if err := applyDesktopSyncGroups(tx, spaceID, syncdata.Snapshot{}, syncdata.Snapshot{"group/" + ref.ID: syncdata.GroupRecord(ref)}, ids); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if ids["group/"+ref.ID] != ref.ID {
		tx.Rollback()
		t.Fatal("replaced shared group identity")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	page, err := s.ListGroups(1, 20)
	if err != nil || page.Total != 0 {
		t.Fatalf("rolled back group still present: %+v %v", page, err)
	}
	typeInfo := reflect.TypeFor[DesktopServerService]()
	for _, method := range []string{"ListGroups", "CreateGroup", "UpdateGroup", "DeleteGroup"} {
		if desktopRemoteBindingAllowed(typeInfo.PkgPath() + "." + typeInfo.Name() + "." + method) {
			t.Fatal("remote workspace can alter local groups")
		}
	}
}
