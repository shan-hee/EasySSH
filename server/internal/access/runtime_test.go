package access

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type authorizeFunc func(context.Context, protocol.Actor, Requirement) error

func (f authorizeFunc) Authorize(ctx context.Context, a protocol.Actor, r Requirement) error {
	return f(ctx, a, r)
}

func visitorScope(t *testing.T, authorizer Authorizer) Scope {
	t.Helper()
	scope, err := NewScope(protocol.Actor{Kind: protocol.Visitor, ID: "session", SessionID: "session", GrantID: "grant"}, time.Now().Add(time.Hour), authorizer)
	if err != nil {
		t.Fatal(err)
	}
	return scope
}

func TestMissingScopeAndUnknownActionsFailClosed(t *testing.T) {
	if err := (Scope{}).Check(context.Background(), Requirement{Action: protocol.WorkspaceRead}); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("empty scope authorized: %v", err)
	}
	scope := visitorScope(t, authorizeFunc(func(context.Context, protocol.Actor, Requirement) error { return nil }))
	for _, req := range []Requirement{{Action: "invented"}, {Action: protocol.FilesRead}} {
		if err := scope.Check(context.Background(), req); !errors.Is(err, ErrForbidden) {
			t.Fatalf("invalid requirement authorized: %+v, %v", req, err)
		}
	}
	if err := scope.RequireOwner(context.Background(), protocol.OwnerManage); !errors.Is(err, ErrForbidden) {
		t.Fatal("a visitor was allowed to invoke an owner-only operation")
	}
}

func TestConcurrentReservationsRespectLogicalConnectionLimit(t *testing.T) {
	runtime := NewRuntime()
	defer runtime.Close()
	scope := visitorScope(t, authorizeFunc(func(context.Context, protocol.Actor, Requirement) error { return nil }))
	var successes atomic.Int64
	var wg sync.WaitGroup
	for range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := runtime.Reserve(context.Background(), scope, Connection, 3, Requirement{Action: protocol.TerminalConnect, ServerID: "one"})
			if err == nil {
				successes.Add(1)
			} else if !errors.Is(err, ErrCapacity) {
				t.Errorf("unexpected reservation error: %v", err)
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 3 {
		t.Fatalf("accepted %d connections with limit 3", successes.Load())
	}
	runtime.Invalidate("grant", "", "", ErrRevoked)
	if runtime.Busy("session") {
		t.Fatal("revocation leaked connection slots")
	}
}

func TestRevocationBetweenCheckAndRegistrationReleasesSlot(t *testing.T) {
	var calls atomic.Int64
	scope := visitorScope(t, authorizeFunc(func(context.Context, protocol.Actor, Requirement) error {
		if calls.Add(1) > 1 {
			return ErrRevoked
		}
		return nil
	}))
	runtime := NewRuntime()
	defer runtime.Close()
	_, err := runtime.Reserve(context.Background(), scope, Connection, 1, Requirement{Action: protocol.TerminalConnect, ServerID: "one"})
	if !errors.Is(err, ErrRevoked) || runtime.Busy("session") {
		t.Fatalf("revoked work survived registration: %v", err)
	}
}

func TestResourcePauseCancelsCrossServerWorkOnlyWhenAffected(t *testing.T) {
	runtime := NewRuntime()
	defer runtime.Close()
	scope := visitorScope(t, authorizeFunc(func(context.Context, protocol.Actor, Requirement) error { return nil }))
	transfer, err := runtime.Reserve(context.Background(), scope, Task, 0,
		Requirement{Action: protocol.FilesRead, ServerID: "source"}, Requirement{Action: protocol.FilesWrite, ServerID: "target"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := runtime.Reserve(context.Background(), scope, Connection, 4, Requirement{Action: protocol.TerminalConnect, ServerID: "other"})
	if err != nil {
		t.Fatal(err)
	}
	runtime.InvalidateVisitors("target", ErrResourceChanged)
	if !errors.Is(context.Cause(transfer.Context()), ErrResourceChanged) {
		t.Fatal("transfer continued after its target paused")
	}
	if other.Context().Err() != nil {
		t.Fatal("unrelated server connection was cancelled")
	}
}

func (authorizeFunc) ServerIDs(_ context.Context, actor protocol.Actor) ([]string, error) {
	if actor.Kind == protocol.Owner {
		return nil, nil
	}
	return nil, ErrForbidden
}
func (authorizeFunc) AuthorizeInteractive(context.Context, protocol.Actor, string) error {
	return ErrForbidden
}
func (authorizeFunc) OpenWork(context.Context, Scope, WorkKind, ...Requirement) (*Lease, error) {
	return nil, ErrForbidden
}
func (authorizeFunc) Charge(context.Context, Scope, Requirement, int64) error { return ErrForbidden }
func (authorizeFunc) CheckBytes(context.Context, Scope, Requirement, int64) error {
	return ErrForbidden
}
func (authorizeFunc) ReserveBytes(context.Context, Scope, Requirement, int) (int, func(int) error, error) {
	return 0, nil, ErrForbidden
}
