package app

import (
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"testing"
)

func TestDesktopGroupEnrollmentCopiesDependenciesOncePerSpaceSelection(t *testing.T) {
	s := newDesktopSyncTestService(t)
	a, b := uuid.NewString(), uuid.NewString()
	activateSyncTestSpace(t, s, a)
	group, err := s.servers.CreateGroup(protocol.ServerGroupInput{Name: "production"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.servers.Create(protocol.ServerCreate{AuthMethod: protocol.ServerAuthMethod("password"), Name: "first", Host: "first.test", Username: "owner", GroupID: group.ID})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.servers.Create(protocol.ServerCreate{AuthMethod: protocol.ServerAuthMethod("password"), Name: "second", Host: "second.test", Username: "owner", GroupID: group.ID})
	if err != nil {
		t.Fatal(err)
	}
	keys := []string{"server/" + first.ID.String(), "group/" + group.ID, "server/" + second.ID.String()}
	if err := s.Enroll(a, keys); err != nil {
		t.Fatal(err)
	}
	activateSyncTestSpace(t, s, b)
	if err := s.Enroll(b, keys); err != nil {
		t.Fatal(err)
	}
	snapshot, _, err := desktopSyncSnapshot(s.servers.db, b)
	if err != nil {
		t.Fatal(err)
	}
	if err := syncdata.Validate(snapshot); err != nil {
		t.Fatal(err)
	}
	groups, servers := 0, 0
	var copiedGroup string
	for key, record := range snapshot {
		if len(key) > 6 && key[:6] == "group/" {
			groups++
			copiedGroup = key[6:]
		}
		if len(key) > 7 && key[:7] == "server/" {
			servers++
			if record["group_id"] == group.ID {
				t.Fatal("copied server retained source group")
			}
		}
	}
	if groups != 1 || servers != 2 || copiedGroup == group.ID {
		t.Fatalf("duplicate/missing group: %v", snapshot)
	}
	for _, id := range []string{first.ID.String(), second.ID.String()} {
		row, err := s.servers.getByIDStored(id)
		if err != nil || row.GroupID != group.ID {
			t.Fatal("source server rebound", err)
		}
	}
	if _, err := s.servers.UpdateGroup(copiedGroup, protocol.ServerGroupInput{Name: "copy only"}); err != nil {
		t.Fatal(err)
	}
	original, err := s.servers.getByIDStored(first.ID.String())
	if err != nil || original.Group != "production" {
		t.Fatal("copy rename crossed space", err)
	}
}

func TestDesktopSyncGroupCollisionDoesNotAdoptLocalGroup(t *testing.T) {
	s := newDesktopSyncTestService(t)
	space := uuid.NewString()
	activateSyncTestSpace(t, s, space)
	group, err := s.servers.CreateGroup(protocol.ServerGroupInput{Name: "local"})
	if err != nil {
		t.Fatal(err)
	}
	state, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	group.Name = "remote"
	state.Snapshot["group/"+group.ID] = syncdata.GroupRecord(group)
	if ok, err := s.save(DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Snapshot: state.Snapshot}); err == nil || ok {
		t.Fatal("unrelated group overwritten")
	}
	var name string
	if err := s.servers.db.QueryRow("SELECT name FROM desktop_server_groups WHERE id=?", group.ID).Scan(&name); err != nil || name != "local" {
		t.Fatal("collision changed local group", err)
	}
}

func TestDesktopSyncEmptyGroupAndDeletion(t *testing.T) {
	s := newDesktopSyncTestService(t)
	space := uuid.NewString()
	activateSyncTestSpace(t, s, space)
	group, err := s.servers.CreateGroup(protocol.ServerGroupInput{Name: "empty"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Enroll(space, []string{"group/" + group.ID}); err != nil {
		t.Fatal(err)
	}
	state, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if state.Snapshot["group/"+group.ID] == nil {
		t.Fatal("empty group absent")
	}
	delete(state.Snapshot, "group/"+group.ID)
	if ok, err := s.save(DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Snapshot: state.Snapshot}); err != nil || !ok {
		t.Fatalf("delete: %v %v", ok, err)
	}
	page, err := s.servers.ListGroups(1, 20)
	if err != nil || page.Total != 0 {
		t.Fatalf("empty group survived: %+v %v", page, err)
	}
}
