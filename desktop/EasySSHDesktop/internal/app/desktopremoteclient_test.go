package app

import (
	"context"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type remoteRoundTripFunc func(*http.Request) (*http.Response, error)

func (f remoteRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDesktopShareLinkAcceptsOnlyExplicitShareOrigins(t *testing.T) {
	id := "11111111-1111-4111-8111-111111111111"
	secret := strings.Repeat("A", 43)
	for _, origin := range []string{"https://example.com", "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"} {
		link, err := parseDesktopShareLink(origin + "/share/" + id + "#" + secret)
		if err != nil || link.origin != origin || link.publicID != id {
			t.Fatalf("valid origin failed: %q %v", origin, err)
		}
	}
	for _, raw := range []string{
		"http://example.com/share/" + id + "#" + secret,
		"https://user:pass@example.com/share/" + id + "#" + secret,
		"https://example.com/share/" + id + "?exec=cmd#" + secret,
		"file:///share/" + id + "#" + secret,
		"https://example.com/%73hare/" + id + "#" + secret,
		"https://example.com/share/" + id + "#short",
	} {
		if _, err := parseDesktopShareLink(raw); err == nil {
			t.Fatalf("unsafe share accepted: %q", raw)
		}
	}
}

func TestRemoteClientNeverForwardsAccessOnRedirect(t *testing.T) {
	client, err := newDesktopRemoteClient("https://source.example")
	if err != nil {
		t.Fatal(err)
	}
	client.token, client.sessionID = "local-secret", "11111111-1111-4111-8111-111111111111"
	calls := 0
	client.http.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "source.example" || r.Header.Get("Authorization") != "Access local-secret" || r.Header.Get("Cookie") != "" {
			t.Fatalf("unexpected request target or credentials")
		}
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://other.example/steal"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	_, err = client.currentContext(context.Background())
	if err == nil || err.Error() != "remote_redirect_rejected" || calls != 1 {
		t.Fatalf("redirect: %v, requests %d", err, calls)
	}
}

func TestRemoteContextCannotClaimOwnerAuthority(t *testing.T) {
	id := "11111111-1111-4111-8111-111111111111"
	value := protocol.AccessContext{ProtocolVersion: protocol.AccessVersion, Actor: protocol.Actor{Kind: protocol.Owner, ID: id, SessionID: id}, ExpiresAt: time.Now().Add(time.Hour), MaxConnections: 1, DefaultContent: "terminal"}
	if err := validateRemoteContext(value); err == nil {
		t.Fatal("source promoted a remote workspace to owner")
	}
	value.Actor = protocol.Actor{Kind: protocol.Visitor, ID: id, SessionID: id, GrantID: id}
	if err := validateRemoteContext(value); err != nil {
		t.Fatalf("visitor rejected: %v", err)
	}
	for _, mode := range []string{"vnc", "rdp"} {
		value.DefaultContent = mode
		if err := validateRemoteContext(value); err != nil {
			t.Fatalf("remote desktop share rejected: %s %v", mode, err)
		}
	}
	value.ProtocolVersion++
	if err := validateRemoteContext(value); err == nil || err.Error() != "protocol_mismatch" {
		t.Fatalf("unsupported protocol accepted: %v", err)
	}
}
