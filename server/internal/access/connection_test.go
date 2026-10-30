package access

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"testing"
	"time"
)

type connectionTestAuthority struct {
	authorizeFunc
	runtime *Runtime
}

func (a connectionTestAuthority) Authorize(context.Context, protocol.Actor, Requirement) error {
	return nil
}
func (a connectionTestAuthority) OpenWork(ctx context.Context, scope Scope, kind WorkKind, requirements ...Requirement) (*Lease, error) {
	return a.runtime.Reserve(ctx, scope, kind, 1, requirements...)
}

func TestConnectionChildrenShareQuotaAndPrimaryCloseCancelsThem(t *testing.T) {
	runtime := NewRuntime()
	defer runtime.Close()
	scope := visitorScope(t, connectionTestAuthority{runtime: runtime})
	ctx := WithScope(context.Background(), scope)
	info, err := runtime.CreateConnection(ctx, scope, "server", protocol.TerminalConnection)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := runtime.Connection(ctx, scope, info.ID, "server")
	if err != nil {
		t.Fatal(err)
	}
	bound, done := connection.Bind(ctx)
	defer done()
	terminal, err := OpenStream(bound, Requirement{Action: protocol.TerminalConnect, ServerID: "server"})
	if err != nil {
		t.Fatal(err)
	}
	monitor, err := OpenStream(bound, Requirement{Action: protocol.MonitorRead, ServerID: "server"})
	if err != nil {
		t.Fatal(err)
	}
	defer monitor.Close(nil)
	if _, err := runtime.CreateConnection(ctx, scope, "server", protocol.FilesConnection); !errors.Is(err, ErrCapacity) {
		t.Fatalf("second independent connection bypassed quota: %v", err)
	}
	if _, err := OpenStream(bound, Requirement{Action: protocol.TerminalConnect, ServerID: "server"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("duplicate primary accepted: %v", err)
	}
	terminal.Close(nil)
	select {
	case <-monitor.Context().Done():
	case <-time.After(time.Second):
		t.Fatal("primary close left child alive")
	}
	if _, err := runtime.CreateConnection(ctx, scope, "server", protocol.FilesConnection); err != nil {
		t.Fatalf("primary close did not free quota: %v", err)
	}
}
func TestConnectionIDDoesNotAuthorizeOtherActorOrResource(t *testing.T) {
	runtime := NewRuntime()
	defer runtime.Close()
	authority := connectionTestAuthority{runtime: runtime}
	scope := visitorScope(t, authority)
	ctx := WithScope(context.Background(), scope)
	info, err := runtime.CreateConnection(ctx, scope, "server", protocol.FilesConnection)
	if err != nil {
		t.Fatal(err)
	}
	other, err := NewScope(protocol.Actor{Kind: protocol.Visitor, ID: "other", SessionID: "other", GrantID: "grant"}, time.Now().Add(time.Hour), authority)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.Connection(ctx, other, info.ID, "server"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-actor attach accepted: %v", err)
	}
	if _, err := runtime.Connection(ctx, scope, info.ID, "other-server"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-resource attach accepted: %v", err)
	}
	connection, err := runtime.Connection(ctx, scope, info.ID, "server")
	if err != nil {
		t.Fatal(err)
	}
	bound, done := connection.Bind(ctx)
	defer done()
	if _, err := OpenStream(bound, Requirement{Action: protocol.TerminalConnect, ServerID: "server"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("file session became terminal: %v", err)
	}
	runtime.Invalidate("grant", "", "", ErrRevoked)
	if _, err := runtime.Connection(ctx, scope, info.ID, "server"); err == nil {
		t.Fatal("revoked connection remained attachable")
	}
}
