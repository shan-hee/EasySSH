package instanceactivation

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMigrationHeartbeatCannotExtendHardDeadlineOrReopenPhase(t *testing.T) {
	t.Setenv("EASYSSH_MIGRATION_TIMEOUT", "1m")
	s := &supervisor{token: "migration-secret"}
	server := httptest.NewServer(s)
	defer server.Close()
	client := &Client{address: server.URL, token: s.token}
	ctx := context.Background()
	if err := client.Migration(ctx, "backup"); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	s.migrationStarted = time.Now().Add(-2 * time.Minute)
	s.mu.Unlock()
	if err := client.Migration(ctx, "migrating"); err != nil {
		t.Fatal(err)
	}
	child := &childProcess{done: make(chan error, 1)}
	waitCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if err := s.awaitReady(waitCtx, child, false); err == nil || !strings.Contains(err.Error(), "migration deadline") {
		t.Fatalf("heartbeat extended hard deadline: %v", err)
	}
	if err := client.Migration(ctx, ""); err != nil {
		t.Fatal(err)
	}
	if err := client.Migration(ctx, "backup"); err == nil {
		t.Fatal("reopened completed migration phase")
	}
}

func TestMigrationHeartbeatRequiresLauncherToken(t *testing.T) {
	s := &supervisor{token: "correct"}
	server := httptest.NewServer(s)
	defer server.Close()
	client := &Client{address: server.URL, token: "wrong"}
	if err := client.Migration(context.Background(), "backup"); err == nil {
		t.Fatal("unauthenticated migration heartbeat accepted")
	}
	if !s.migrationStarted.IsZero() {
		t.Fatal("unauthenticated heartbeat changed startup deadline")
	}
}
