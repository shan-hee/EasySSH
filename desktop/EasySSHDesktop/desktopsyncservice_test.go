package main

import (
	"testing"

	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

func newDesktopSyncTestService(t *testing.T) *DesktopSyncService {
	t.Helper()
	servers := newSSHKeyTestService(t)
	if err := configureDesktopScriptDatabase(servers.db); err != nil {
		t.Fatal(err)
	}
	if err := configureDesktopAIDatabase(servers.db); err != nil {
		t.Fatal(err)
	}
	return &DesktopSyncService{servers: servers, scripts: &DesktopScriptService{db: servers.db}, ai: &DesktopAIService{db: servers.db, serverService: servers}}
}
func activateSyncTestSpace(t *testing.T, s *DesktopSyncService, space string) {
	t.Helper()
	_, err := s.servers.db.Exec(`INSERT OR IGNORE INTO desktop_sync_spaces(id,instance_id,user_id,account_name,server_url) VALUES(?,?,?,?,?)`, space, uuid.NewString(), uuid.NewString(), "same display name", "https://example.test")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.servers.db.Exec(`UPDATE desktop_sync_state SET space_id=?,token='test',enabled=1,revision=revision+1 WHERE id=1`, space)
	if err != nil {
		t.Fatal(err)
	}
}

func TestDesktopSyncEnrollmentAndAccountIsolation(t *testing.T) {
	s := newDesktopSyncTestService(t)
	a, b := uuid.NewString(), uuid.NewString()
	localID := uuid.NewString()
	_, err := s.servers.db.Exec(`INSERT INTO desktop_servers(id,name,host,username,password,created_at,updated_at) VALUES(?,'local','example.test','user','local-secret','','')`, localID)
	if err != nil {
		t.Fatal(err)
	}
	activateSyncTestSpace(t, s, a)
	state, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Snapshot) != 0 {
		t.Fatal("login enrolled local data implicitly")
	}
	if err := s.Enroll(a, []string{"server/" + localID}); err != nil {
		t.Fatal(err)
	}
	old, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(old.Snapshot) != 1 {
		t.Fatal("explicit enrollment missing")
	}
	activateSyncTestSpace(t, s, b)
	current, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(current.Snapshot) != 0 {
		t.Fatal("new account inherited previous space data")
	}
	saved, err := s.Save(DesktopSyncSave{Revision: old.Revision, Hash: old.Hash, Document: "stale"})
	if err != nil || saved {
		t.Fatalf("accepted stale account response: %v", err)
	}
	if err := s.Enroll(a, []string{"server/" + localID}); err == nil {
		t.Fatal("accepted stale account selection")
	}
	if err := s.Enroll(b, []string{"server/" + localID}); err != nil {
		t.Fatal(err)
	}
	var owner, copyID, password string
	if err := s.servers.db.QueryRow(`SELECT space_id FROM desktop_sync_records WHERE local_id=?`, localID).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner != a {
		t.Fatal("migration reassigned original record")
	}
	if err := s.servers.db.QueryRow(`SELECT s.id,s.password FROM desktop_servers s JOIN desktop_sync_records m ON m.local_id=s.id WHERE m.space_id=?`, b).Scan(&copyID, &password); err != nil {
		t.Fatal(err)
	}
	if copyID == localID || password != "" {
		t.Fatal("cross-account copy reused record identity or credentials")
	}
}

func TestDesktopSyncRejectsChangesMadeDuringExchange(t *testing.T) {
	s := newDesktopSyncTestService(t)
	space, id := uuid.NewString(), uuid.NewString()
	activateSyncTestSpace(t, s, space)
	_, err := s.servers.db.Exec(`INSERT INTO desktop_scripts(id,name,content,language,created_at,updated_at) VALUES(?,'script','echo before','bash','','')`, id)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Enroll(space, []string{"script/" + id}); err != nil {
		t.Fatal(err)
	}
	state, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.servers.db.Exec(`UPDATE desktop_scripts SET content='echo edited' WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	saved, err := s.Save(DesktopSyncSave{Revision: state.Revision, Hash: state.Hash, Document: "stale", Snapshot: state.Snapshot})
	if err != nil || saved {
		t.Fatalf("overwrote concurrent local edit: %v", err)
	}
	var content string
	if err := s.servers.db.QueryRow(`SELECT content FROM desktop_scripts WHERE id=?`, id).Scan(&content); err != nil {
		t.Fatal(err)
	}
	if content != "echo edited" {
		t.Fatal("concurrent edit was lost")
	}
	if err := s.SetScopes(syncdata.SyncScopes{AIConfig: true}); err == nil {
		t.Fatal("enabled scope without device grant")
	}
}

func TestDesktopAISessionKeepsOriginalConfigurationSpace(t *testing.T) {
	s := newDesktopSyncTestService(t)
	a, b := uuid.NewString(), uuid.NewString()
	for space, key := range map[string]string{"local": "local-key", a: "account-a-key", b: "account-b-key"} {
		encrypted, err := encryptDesktopCredential(key, "desktop_ai_config", space, "custom_api_key")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.servers.db.Exec(`INSERT INTO desktop_ai_config(id,custom_api_key,updated_at) VALUES(?,?,'')`, space, encrypted); err != nil {
			t.Fatal(err)
		}
	}
	activateSyncTestSpace(t, s, a)
	for id, space := range map[string]string{"old-session": a, "local-session": "local"} {
		if _, err := s.servers.db.Exec(`INSERT INTO desktop_ai_sessions(id,config_space_id,created_at,updated_at) VALUES(?,?,'','')`, id, space); err != nil {
			t.Fatal(err)
		}
	}
	activateSyncTestSpace(t, s, b)
	for id, want := range map[string]string{"old-session": "account-a-key", "local-session": "local-key"} {
		config, err := s.ai.loadSessionConfig(id)
		if err != nil {
			t.Fatal(err)
		}
		if config.CustomAPIKey != want {
			t.Fatalf("%s used another account's API key", id)
		}
	}
	config, err := s.ai.loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if config.CustomAPIKey != "account-b-key" {
		t.Fatal("new sessions did not use current space")
	}
}
