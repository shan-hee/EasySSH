package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestDesktopProxyUsesDatabaseAndRedactsPreferenceView(t *testing.T) {
	servers := newSSHKeyTestService(t)
	t.Setenv("EASYSSH_DESKTOP_DATA_DIR", t.TempDir())
	s := NewDesktopService(nil, servers.database)
	previous := desktopHTTPProxy.current.Load()
	t.Cleanup(func() { desktopHTTPProxy.current.Store(previous) })
	const secret = "proxy-test-secret"
	input := `{"mode":"manual","url":"http://proxy.test:8080","username":"test-user","password":"` + secret + `","passwordSet":true}`
	if err := s.SetPreference(desktopProxyPreferenceKey, input); err != nil {
		t.Fatal(err)
	}
	stored, err := readDesktopProxy(servers.db)
	if err != nil || stored.Password == "" || strings.Contains(stored.Password, secret) {
		t.Fatalf("proxy secret was not encrypted: %v", err)
	}
	plain, err := decryptDesktopProxyConfig(stored)
	if err != nil || plain.Password != secret {
		t.Fatalf("stored proxy secret cannot be restored: %v", err)
	}
	preferences, err := s.ListPreferences()
	if err != nil || strings.Contains(preferences[desktopProxyPreferenceKey], secret) || strings.Contains(preferences[desktopProxyPreferenceKey], stored.Password) {
		t.Fatalf("preference response exposed credential: %v", err)
	}
	var public desktopProxyConfig
	if err := json.Unmarshal([]byte(preferences[desktopProxyPreferenceKey]), &public); err != nil || !public.HasPassword || public.Password != "" {
		t.Fatalf("invalid public proxy view: %v", err)
	}
	if err := s.SetPreference("theme", "dark"); err != nil {
		t.Fatal(err)
	}
	filePreferences, err := readDesktopPreferences()
	if err != nil || filePreferences["theme"] != "dark" || filePreferences[desktopProxyPreferenceKey] != "" {
		t.Fatalf("proxy leaked into UI preferences: %v", err)
	}
	if err := s.SetPreference(desktopProxyPreferenceKey, preferences[desktopProxyPreferenceKey]); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPreference(desktopProxyPreferenceKey, input); err != nil {
		t.Fatal(err)
	}
	var count int
	var fields string
	if err := servers.db.QueryRow(`SELECT COUNT(*),MAX(changed_fields_json) FROM desktop_configuration_events WHERE action='network_proxy_updated'`).Scan(&count, &fields); err != nil || count != 1 || strings.Contains(fields, secret) || strings.Contains(fields, "proxy.test") {
		t.Fatalf("no-op inflated activity or exposed values: %d %s %v", count, fields, err)
	}
	current, err := readDesktopProxy(servers.db)
	if err != nil || current.Password != stored.Password {
		t.Fatal("no-op rewrote credential", err)
	}
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	if err := verifyDesktopSnapshotCredentials(context.Background(), servers.db, key); err != nil {
		t.Fatal("backup verification cannot restore proxy credential", err)
	}
	if err := s.RemovePreference(desktopProxyPreferenceKey); err != nil {
		t.Fatal(err)
	}
	current, err = readDesktopProxy(servers.db)
	if err != nil || current.Mode != "system" || current.Password != "" || current.Username != "" || current.URL != "" {
		t.Fatalf("reset retained proxy credentials: %+v %v", current, err)
	}
}

func TestDesktopProxyActivityFailureKeepsDatabaseAndRuntime(t *testing.T) {
	servers := newSSHKeyTestService(t)
	s := NewDesktopService(nil, servers.database)
	previous := desktopHTTPProxy.current.Load()
	t.Cleanup(func() { desktopHTTPProxy.current.Store(previous) })
	if err := s.SetPreference(desktopProxyPreferenceKey, `{"mode":"direct"}`); err != nil {
		t.Fatal(err)
	}
	transport := desktopHTTPProxy.current.Load()
	if _, err := servers.db.Exec(`CREATE TRIGGER reject_proxy_activity BEFORE INSERT ON activity_logs WHEN NEW.action='network_proxy_updated' BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPreference(desktopProxyPreferenceKey, `{"mode":"manual","url":"http://proxy.test:8080"}`); err == nil {
		t.Fatal("proxy saved without its activity")
	}
	stored, err := readDesktopProxy(servers.db)
	if err != nil || stored.Mode != "direct" || desktopHTTPProxy.current.Load() != transport {
		t.Fatalf("failed transaction changed database or running proxy: %+v %v", stored, err)
	}
}

func TestDesktopProxyDoesNotReusePasswordForDifferentDestination(t *testing.T) {
	previous := desktopProxyConfig{Mode: "manual", URL: "http://first.test:8080", Username: "owner", Password: "private"}
	for _, input := range []string{
		`{"mode":"manual","url":"http://second.test:8080","username":"owner"}`,
		`{"mode":"manual","url":"http://first.test:8080","username":"different"}`,
	} {
		config, err := prepareDesktopProxy(input, previous)
		if err != nil || config.Password != "" {
			t.Fatalf("retained old secret for different destination: %v", err)
		}
	}
}
