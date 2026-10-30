package app

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"github.com/easyssh/shared/protocol"
	"strings"
	"testing"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

func TestInlineKeyAndServerRollBackWhenConfigurationEventFails(t *testing.T) {
	s := newSSHKeyTestService(t)
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKey(key, "test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`CREATE TRIGGER reject_server_activity BEFORE INSERT ON activity_logs WHEN NEW.action='server_created' BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	_, err = s.Create(protocol.ServerCreate{Host: "example.test", Username: "owner", AuthMethod: protocol.ServerAuthMethod("key"), PrivateKey: string(pem.EncodeToMemory(block))})
	if err == nil {
		t.Fatal("configuration committed without its activity")
	}
	for _, table := range []string{"desktop_servers", "desktop_server_auth", "desktop_ssh_keys", "desktop_configuration_events", "activity_logs"} {
		var count int
		if err = s.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("partial creation remained in %s: %d %v", table, count, err)
		}
	}
}

func TestServerActivityTracksActualChangesAndKeepsDeletedName(t *testing.T) {
	s := newSSHKeyTestService(t)
	input := protocol.ServerCreate{Name: "original", Host: "example.test", Username: "owner", AuthMethod: protocol.ServerAuthMethod("password"), Password: "secret-not-for-activity"}
	server, err := s.Create(input)
	if err != nil {
		t.Fatal(err)
	}
	update := protocol.ServerUpdate{Password: &input.Password}
	if _, err = s.Update(server.ID.String(), update); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM desktop_configuration_events`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("no-op inflated configuration volume: %d %v", count, err)
	}
	input.Name = "renamed"
	update.Name = &input.Name
	if _, err = s.Update(server.ID.String(), update); err != nil {
		t.Fatal(err)
	}
	if err = s.Delete(server.ID.String()); err != nil {
		t.Fatal(err)
	}
	rows, err := s.db.Query(`SELECT action,server_name,detail FROM activity_logs ORDER BY created_at,id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	names := map[string]string{}
	for rows.Next() {
		var action, name, detail string
		if err = rows.Scan(&action, &name, &detail); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(detail, input.Password) || strings.Contains(detail, "BEGIN OPENSSH") {
			t.Fatal("secret material entered activity")
		}
		names[action] = name
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if names["server_created"] != "original" || names["server_updated"] != "renamed" || names["server_deleted"] != "renamed" {
		t.Fatalf("historical names were replaced: %+v", names)
	}
	if err = rows.Close(); err != nil {
		t.Fatal(err)
	}
	activity := &ActivityLogService{db: s.db}
	var createdActivityID string
	if err = s.db.QueryRow(`SELECT id FROM activity_logs WHERE action='server_created'`).Scan(&createdActivityID); err != nil {
		t.Fatal(err)
	}
	deletedDetail, err := activity.GetById(createdActivityID)
	if err != nil || len(deletedDetail.Resources) != 1 || !deletedDetail.Resources[0].Deleted || deletedDetail.Resources[0].Name != "original" {
		t.Fatalf("deleted resource marker or name missing: %+v %v", deletedDetail.Resources, err)
	}
	if _, err = activity.Clear(""); err != nil {
		t.Fatal(err)
	}
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM desktop_configuration_events`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("source events escaped activity retention: %d %v", count, err)
	}
}

func TestConfigurationFailureKeepsStoredAndTemporaryCredential(t *testing.T) {
	s := newSSHKeyTestService(t)
	s.temporaryCredentials = map[string]desktopTemporaryCredential{}
	input := protocol.ServerCreate{Name: "server", Host: "example.test", Username: "owner", AuthMethod: protocol.ServerAuthMethod("password"), Password: "old-secret"}
	server, err := s.Create(input)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := s.getByIDRaw(server.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	s.setTemporaryCredential(server.ID.String(), *server.ConnectionRevision, snapshot.credentialDigest(), DesktopSSHCredential{AuthMethod: DesktopServerAuthPassword, Password: "temporary-secret"})
	if _, err = s.db.Exec(`CREATE TRIGGER reject_configuration_source BEFORE INSERT ON desktop_configuration_events WHEN NEW.action='server_updated' BEGIN SELECT RAISE(ABORT,'source unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	input.Password = "new-secret"
	update := protocol.ServerUpdate{Password: &input.Password}
	if _, err = s.Update(server.ID.String(), update); err == nil {
		t.Fatal("failed source write committed credential")
	}
	current, err := s.getByIDRaw(server.ID.String())
	if err != nil || current.Password != "old-secret" {
		t.Fatal("credential changed despite transaction rollback")
	}
	if credential, ok := s.getTemporaryCredential(server.ID.String(), current.connectionRevision, current.credentialDigest()); !ok || credential.Password != "temporary-secret" {
		t.Fatal("temporary credential invalidated before commit")
	}
	var count int
	if err = s.db.QueryRow(`SELECT COUNT(*) FROM activity_logs WHERE action='server_updated'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("projection survived rejected source event")
	}
}

func TestDuplicateKeyImportDoesNotManufactureConfigurationEvent(t *testing.T) {
	s := newSSHKeyTestService(t)
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKey(key, "test")
	if err != nil {
		t.Fatal(err)
	}
	input := protocol.SSHKeyImportInput{Name: "key", PrivateKey: string(pem.EncodeToMemory(block))}
	if _, err = s.ImportSSHKey(input); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ImportSSHKey(input); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.QueryRowContext(context.Background(), `SELECT COUNT(*) FROM desktop_configuration_events WHERE resource_kind='ssh_key'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate import manufactured activity: %d %v", count, err)
	}
}

func TestSyncEnrollmentActivityFailureRollsBackCopiedResource(t *testing.T) {
	s := newDesktopSyncTestService(t)
	first, second := uuid.NewString(), uuid.NewString()
	server, err := s.servers.Create(protocol.ServerCreate{Name: "shared definition", Host: "example.test", Username: "owner", AuthMethod: protocol.ServerAuthMethod("password"), Password: "not-copied"})
	if err != nil {
		t.Fatal(err)
	}
	activateSyncTestSpace(t, s, first)
	if err = s.Enroll(first, []string{"server/" + server.ID.String()}); err != nil {
		t.Fatal(err)
	}
	activateSyncTestSpace(t, s, second)
	before, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.servers.db.Exec(`CREATE TRIGGER reject_enrollment BEFORE INSERT ON desktop_configuration_events WHEN NEW.action='server_sync_enrolled' BEGIN SELECT RAISE(ABORT,'unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err = s.Enroll(second, []string{"server/" + server.ID.String()}); err == nil {
		t.Fatal("enrollment survived event failure")
	}
	var count int
	if err = s.servers.db.QueryRow(`SELECT COUNT(*) FROM desktop_servers`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("copy escaped rollback: %d %v", count, err)
	}
	after, err := s.Load()
	if err != nil || after.Revision != before.Revision || after.Hash != before.Hash {
		t.Fatalf("enrollment changed sync state despite rollback: %v", err)
	}
}

func TestSyncToggleNoOpAndActivityFailurePreserveRevision(t *testing.T) {
	s := newDesktopSyncTestService(t)
	activateSyncTestSpace(t, s, uuid.NewString())
	before, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SetEnabled(true); err != nil {
		t.Fatal(err)
	}
	if _, err = s.servers.db.Exec(`CREATE TRIGGER reject_sync_toggle BEFORE INSERT ON desktop_configuration_events WHEN NEW.action='sync_enabled_changed' BEGIN SELECT RAISE(ABORT,'unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err = s.SetEnabled(false); err == nil {
		t.Fatal("sync toggle survived event failure")
	}
	after, err := s.Load()
	if err != nil || !after.Enabled || after.Revision != before.Revision {
		t.Fatalf("no-op or failed toggle changed revision: %+v %v", after, err)
	}
}
