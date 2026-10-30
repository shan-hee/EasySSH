// Package access carries authenticated execution authority inside the server.
// A Scope is issued by a host authenticator, never decoded from a client request.
package access

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"sync/atomic"
	"time"
)

var (
	ErrUnauthenticated = errors.New("authentication required")
	ErrForbidden       = errors.New("action is not permitted")
	ErrExpired         = errors.New("access has expired")
	ErrRevoked         = errors.New("access has been revoked")
	ErrResourceChanged = errors.New("resource requires owner confirmation")
	ErrCapacity        = errors.New("access capacity reached")
)

// Requirement identifies the execution target, not merely an HTTP path. A
// transfer has two requirements; an allowed script also carries its exact version.
type Requirement struct {
	Action        protocol.Action `json:"action"`
	ServerID      string          `json:"server_id,omitempty"`
	ScriptID      string          `json:"script_id,omitempty"`
	ScriptVersion string          `json:"script_version,omitempty"`
}

// Authorizer explicitly implements every access capability. Unsupported actions
// are denied by the policy itself; capabilities are never discovered by assertion.
// Session validation may be reused only within a bounded HTTP request.
type Authorizer interface {
	Authorize(context.Context, protocol.Actor, Requirement) error
	ResourceLister
	InteractiveAuthorizer
	WorkOpener
	UsageCharger
	ByteAllocator
}

type Scope struct {
	actor      protocol.Actor
	expiresAt  *atomic.Pointer[time.Time]
	authorizer Authorizer
}

func NewScope(actor protocol.Actor, expiresAt time.Time, authorizer Authorizer) (Scope, error) {
	if !actor.Valid() || authorizer == nil || expiresAt.IsZero() {
		return Scope{}, ErrUnauthenticated
	}
	if !time.Now().Before(expiresAt) {
		return Scope{}, ErrExpired
	}
	deadline := new(atomic.Pointer[time.Time])
	deadline.Store(&expiresAt)
	return Scope{actor: actor, expiresAt: deadline, authorizer: authorizer}, nil
}

func (s Scope) Actor() protocol.Actor { return s.actor }
func (s Scope) ExpiresAt() time.Time {
	if s.expiresAt == nil {
		return time.Time{}
	}
	return *s.expiresAt.Load()
}
func (s Scope) IsOwner() bool { return s.actor.Kind == protocol.Owner && s.authorizer != nil }

func (s Scope) Check(ctx context.Context, requirement Requirement) error {
	if s.authorizer == nil || !s.actor.Valid() {
		return ErrUnauthenticated
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !time.Now().Before(s.ExpiresAt()) {
		return ErrExpired
	}
	if !requirement.Action.Valid() || requirement.Action.Shareable() && requirement.ServerID == "" {
		return ErrForbidden
	}
	return s.authorizer.Authorize(ctx, s.actor, requirement)
}

func (s Scope) RequireOwner(ctx context.Context, action protocol.Action) error {
	if !s.IsOwner() {
		return ErrForbidden
	}
	return s.Check(ctx, Requirement{Action: action})
}

type scopeKey struct{}

func WithScope(ctx context.Context, scope Scope) context.Context {
	return context.WithValue(ctx, scopeKey{}, scope)
}

func FromContext(ctx context.Context) (Scope, error) {
	scope, ok := ctx.Value(scopeKey{}).(Scope)
	if !ok || scope.authorizer == nil {
		return Scope{}, ErrUnauthenticated
	}
	return scope, nil
}

// Current returns a zero scope when authentication is absent. Its checks always
// reject; no caller may replace it with an inferred owner or a client identity.
func Current(ctx context.Context) Scope { scope, _ := FromContext(ctx); return scope }

type ResourceLister interface {
	ServerIDs(context.Context, protocol.Actor) ([]string, error)
}

func (s Scope) ServerIDs(ctx context.Context) ([]string, error) {
	if err := s.Check(ctx, Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	ids, err := s.authorizer.ServerIDs(ctx, s.actor)
	if err != nil {
		return nil, err
	}
	if ids == nil && !s.IsOwner() {
		ids = []string{}
	}
	return ids, nil
}

// InteractiveAuthorizer controls challenge responses, separately from changing
// saved credentials or host trust. It is evaluated again for each challenge.
type InteractiveAuthorizer interface {
	AuthorizeInteractive(context.Context, protocol.Actor, string) error
}

func (s Scope) CheckInteractive(ctx context.Context, serverID string) error {
	if err := s.Check(ctx, Requirement{Action: protocol.WorkspaceRead, ServerID: serverID}); err != nil {
		return err
	}
	if s.IsOwner() {
		return nil
	}
	return s.authorizer.AuthorizeInteractive(ctx, s.actor, serverID)
}

// WorkOpener obtains limits from the authenticated host policy, never the client.
type WorkOpener interface {
	OpenWork(context.Context, Scope, WorkKind, ...Requirement) (*Lease, error)
}

func (s Scope) OpenWork(ctx context.Context, kind WorkKind, requirements ...Requirement) (*Lease, error) {
	if s.authorizer == nil {
		return nil, ErrForbidden
	}
	return s.authorizer.OpenWork(ctx, s, kind, requirements...)
}

type operationKey struct{}

// WithOperation carries a server-declared route operation. It does not grant
// authority; services still check this requirement against the issued scope.
func WithOperation(ctx context.Context, requirement Requirement) context.Context {
	return context.WithValue(ctx, operationKey{}, requirement)
}
func Operation(ctx context.Context) Requirement {
	req, _ := ctx.Value(operationKey{}).(Requirement)
	return req
}

// UsageCharger accounts for consumed quota across all sessions of a grant.
type UsageCharger interface {
	Charge(context.Context, Scope, Requirement, int64) error
}

func (s Scope) Charge(ctx context.Context, req Requirement, amount int64) error {
	if amount < 0 {
		return ErrForbidden
	}
	if err := s.Check(ctx, req); err != nil {
		return err
	}
	if s.IsOwner() {
		return nil
	}
	return s.authorizer.Charge(ctx, s, req, amount)
}
