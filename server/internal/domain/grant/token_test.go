package grant

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func TestAutomationTokenUsesGrantWithoutChangingLegacySessions(t *testing.T) {
	s, ctx, owner, input, otherServerID := grantActivityFixture(t)
	serverID := input.Resources[0].ServerID
	g, err := s.Create(ctx, owner, input)
	if err != nil {
		t.Fatal(err)
	}
	view, raw, err := s.CreateToken(ctx, owner, CreateTokenInput{Name: "agent", GrantID: g.Grant.ID, ExpiresAt: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	var sessions int64
	if err := s.db.Model(&Session{}).Count(&sessions).Error; err != nil || sessions != 0 {
		t.Fatalf("token changed legacy sessions: count=%d err=%v", sessions, err)
	}
	var stored AutomationToken
	if err := s.db.First(&stored, "session_id = ?", view.SessionID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.TokenHash == raw || stored.TokenHash != digest(raw) {
		t.Fatal("credential must be stored only as a digest")
	}
	if err := s.db.Model(&stored).Update("last_seen_at", time.Now().Add(-2*time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	scope, err := s.AuthenticateToken(ctx, raw)
	if err != nil {
		t.Fatalf("automation must survive visitor idle timeout: %v", err)
	}
	if scope.IsOwner() || scope.Actor().GrantID != g.Grant.ID.String() {
		t.Fatal("token must retain restricted grant authority")
	}
	if err := scope.Check(ctx, access.Requirement{Action: protocol.FilesList, ServerID: serverID.String()}); err != nil {
		t.Fatal(err)
	}
	if err := scope.Check(ctx, access.Requirement{Action: protocol.FilesWrite, ServerID: serverID.String()}); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("unexpected write permission: %v", err)
	}
	if err := scope.Check(ctx, access.Requirement{Action: protocol.FilesList, ServerID: otherServerID.String()}); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("unexpected access to another server: %v", err)
	}
	if _, err := s.Authenticate(ctx, "", raw, "", "", false); err == nil {
		t.Fatal("automation token accepted as a desktop credential")
	}
	if _, err := s.Restore(ctx, scope.Actor()); err != nil {
		t.Fatalf("durable job cannot restore credential: %v", err)
	}
	items, err := s.ListTokens(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(items)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || !items[0].Active || strings.Contains(string(encoded), raw) || strings.Contains(string(encoded), stored.TokenHash) {
		t.Fatal("invalid public token metadata")
	}
	lease, err := scope.OpenWork(ctx, access.Connection, access.Requirement{Action: protocol.FilesList, ServerID: serverID.String()})
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close(nil)
	if err := s.RevokeToken(ctx, owner, view.SessionID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-lease.Context().Done():
	default:
		t.Fatal("revocation did not interrupt running work")
	}
	if _, err := s.AuthenticateToken(ctx, raw); !errors.Is(err, access.ErrRevoked) {
		t.Fatalf("revoked token accepted: %v", err)
	}
	if _, err := s.Restore(ctx, scope.Actor()); !errors.Is(err, access.ErrRevoked) {
		t.Fatalf("revoked queued identity restored: %v", err)
	}
}

func TestAutomationTokenInvalidatedByGrantVersion(t *testing.T) {
	s, ctx, owner, input, _ := grantActivityFixture(t)
	g, err := s.Create(ctx, owner, input)
	if err != nil {
		t.Fatal(err)
	}
	_, raw, err := s.CreateToken(ctx, owner, CreateTokenInput{Name: "agent", GrantID: g.Grant.ID, ExpiresAt: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Update(ctx, owner, g.Grant.ID, g.Grant.Version, input); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AuthenticateToken(ctx, raw); !errors.Is(err, access.ErrRevoked) {
		t.Fatalf("old grant version remained usable: %v", err)
	}
	items, err := s.ListTokens(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Active {
		t.Fatal("invalidated token still shown as active")
	}
}

func TestInlineTokenAuthorizationIsAtomicAndNotAShare(t *testing.T) {
	s, ctx, owner, input, second := grantActivityFixture(t)
	input.Resources[0].Actions = []protocol.Action{protocol.FilesRead}
	input.Resources = append(input.Resources, protocol.GrantResourceInput{ServerID: second, Actions: []protocol.Action{protocol.MonitorRead}})
	view, raw, err := s.CreateToken(ctx, owner, CreateTokenInput{Name: "external agent", Authorization: &input, ExpiresAt: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	scope, err := s.AuthenticateToken(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	if err := scope.Check(ctx, access.Requirement{Action: protocol.FilesRead, ServerID: input.Resources[0].ServerID.String()}); err != nil {
		t.Fatal(err)
	}
	if err := scope.Check(ctx, access.Requirement{Action: protocol.TerminalConnect, ServerID: second.String()}); !errors.Is(err, access.ErrForbidden) {
		t.Fatal(err)
	}
	var g Grant
	if err := s.db.First(&g, "id = ?", view.GrantID).Error; err != nil {
		t.Fatal(err)
	}
	if g.Purpose != "automation" {
		t.Fatal("unexpected grant purpose")
	}
	if _, count, err := s.List(ctx, owner, 100, 0); err != nil || count != 0 {
		t.Fatalf("machine authorization listed as share: count=%d err=%v", count, err)
	}
	if _, err := s.RotateSecret(ctx, owner, g.ID); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("machine grant became a share link: %v", err)
	}
	var before int64
	if err := s.db.Model(&Grant{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	invalid := input
	invalid.Resources = []protocol.GrantResourceInput{{ServerID: uuid.New(), Actions: []protocol.Action{protocol.FilesRead}}}
	if _, _, err := s.CreateToken(ctx, owner, CreateTokenInput{Name: "invalid", Authorization: &invalid, ExpiresAt: time.Now().Add(time.Hour)}); err == nil {
		t.Fatal("missing server accepted")
	}
	var after int64
	if err := s.db.Model(&Grant{}).Count(&after).Error; err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("failed issuance left an orphan grant")
	}
}
