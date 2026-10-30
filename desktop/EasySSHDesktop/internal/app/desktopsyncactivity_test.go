package app

import (
	"testing"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

func TestDesktopSyncEquivalentConfigurationDoesNotCreateActivity(t *testing.T) {
	s := newDesktopSyncTestService(t)
	space := uuid.NewString()
	activateSyncTestSpace(t, s, space)
	server, err := s.servers.Create(protocol.ServerCreate{Name: "server", Host: "host.test", Username: "owner", AuthMethod: "password", Password: "saved"})
	if err != nil {
		t.Fatal(err)
	}
	key := "server/" + server.ID.String()
	if err := s.Enroll(space, []string{key}); err != nil {
		t.Fatal(err)
	}
	before, err := s.servers.getByIDStored(server.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.servers.db.QueryRow("SELECT COUNT(*) FROM desktop_configuration_events").Scan(&count); err != nil {
		t.Fatal(err)
	}
	state, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	state.Snapshot[key]["connection"] = " \n" + state.Snapshot[key]["connection"] + "\n "
	state.Snapshot[key]["tags"] = "[ ]"
	delete(state.Snapshot[key], "description")
	delete(state.Snapshot[key], "group_id")
	if ok, err := s.Save(DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Snapshot: state.Snapshot}); err != nil || !ok {
		t.Fatal("equivalent save rejected", ok, err)
	}
	var afterCount int
	if err := s.servers.db.QueryRow("SELECT COUNT(*) FROM desktop_configuration_events").Scan(&afterCount); err != nil || count != afterCount {
		t.Fatal("formatting inflated configuration activity", count, afterCount, err)
	}
	after, err := s.servers.getByIDStored(server.ID.String())
	if err != nil || after.UpdatedAt != before.UpdatedAt || after.Password != before.Password || after.connectionRevision != before.connectionRevision {
		t.Fatal("equivalent configuration changed stored identity/credentials", err)
	}
}

func TestDesktopSyncNewServersDoNotCountInitialOrderTwice(t *testing.T) {
	s := newDesktopSyncTestService(t)
	space := uuid.NewString()
	activateSyncTestSpace(t, s, space)
	state, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{uuid.NewString(), uuid.NewString()}
	for _, id := range ids {
		state.Snapshot["server/"+id] = syncdata.Record{"name": "server", "connection": syncdata.JSON(syncdata.Connection{Host: "host.test", Port: 22, Username: "owner", AuthMethod: "password"}), "tags": "[]"}
	}
	state.Snapshot[syncdata.ServerOrderKey] = syncdata.Record{"ids": syncdata.JSON(ids)}
	if ok, err := s.Save(DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Snapshot: state.Snapshot}); err != nil || !ok {
		t.Fatal(ok, err)
	}
	var creates, reorders int
	if err := s.servers.db.QueryRow(`SELECT COUNT(*) FROM desktop_configuration_events WHERE action='server_created' AND source='automation'`).Scan(&creates); err != nil {
		t.Fatal(err)
	}
	if err := s.servers.db.QueryRow(`SELECT COUNT(*) FROM desktop_configuration_events WHERE action='servers_reordered'`).Scan(&reorders); err != nil || creates != 2 || reorders != 0 {
		t.Fatal("initial order counted as a second operation", creates, reorders, err)
	}
}

func TestDesktopSyncGroupDeletionRetainsMembersBeforeDetachment(t *testing.T) {
	s := newDesktopSyncTestService(t)
	space := uuid.NewString()
	activateSyncTestSpace(t, s, space)
	group, err := s.servers.CreateGroup(protocol.ServerGroupInput{Name: "group"})
	if err != nil {
		t.Fatal(err)
	}
	server, err := s.servers.Create(protocol.ServerCreate{Host: "unnamed.test", Username: "owner", AuthMethod: "password", GroupID: group.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Enroll(space, []string{"server/" + server.ID.String()}); err != nil {
		t.Fatal(err)
	}
	state, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	delete(state.Snapshot, "group/"+group.ID)
	state.Snapshot["server/"+server.ID.String()]["group_id"] = ""
	if _, err := s.servers.db.Exec(`CREATE TRIGGER reject_group_activity BEFORE INSERT ON desktop_configuration_events WHEN NEW.action='server_group_deleted' BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	input := DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Snapshot: state.Snapshot}
	if ok, err := s.Save(input); err == nil || ok {
		t.Fatal("group change committed without its fact")
	}
	stored, err := s.servers.getByIDStored(server.ID.String())
	if err != nil || stored.GroupID != group.ID {
		t.Fatal("failed sync detached member", err)
	}
	if _, err := s.servers.db.Exec("DROP TRIGGER reject_group_activity"); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.Save(input); err != nil || !ok {
		t.Fatal(ok, err)
	}
	var name string
	if err := s.servers.db.QueryRow(`SELECT r.name FROM desktop_configuration_events e JOIN desktop_activity_resources r ON r.activity_id=e.activity_id WHERE e.action='server_group_deleted' AND e.resource_id=? AND e.source='automation' AND r.server_id=?`, group.ID, server.ID.String()).Scan(&name); err != nil || name != "unnamed.test" {
		t.Fatal("deletion lost member snapshot", name, err)
	}
}
