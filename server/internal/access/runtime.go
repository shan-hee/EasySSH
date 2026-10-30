package access

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"sync"
	"time"
)

type WorkKind string

const (
	Connection WorkKind = "connection"
	Task       WorkKind = "task"
)

// Runtime owns logical connections and running work, not pooled SSH channels.
// Each lease has one cancellation context; dependent streams share that lease.
type Runtime struct {
	mu          sync.Mutex
	leases      map[*Lease]struct{}
	connections map[string]*LogicalConnection
	closed      bool
}

func NewRuntime() *Runtime {
	return &Runtime{leases: make(map[*Lease]struct{}), connections: make(map[string]*LogicalConnection)}
}

type Lease struct {
	runtime       *Runtime
	scope         Scope
	kind          WorkKind
	requirements  []Requirement
	ctx           context.Context
	cancel        context.CancelCauseFunc
	once          sync.Once
	expiryChanged chan struct{}
}

func (l *Lease) Context() context.Context { return l.ctx }

// Close is idempotent. The caller must defer it even if dialing fails.
func (l *Lease) Close(reason error) {
	l.once.Do(func() {
		l.cancel(reason)
		l.runtime.mu.Lock()
		delete(l.runtime.leases, l)
		l.runtime.mu.Unlock()
	})
}

func (l *Lease) check(ctx context.Context) error {
	for _, req := range l.requirements {
		if err := l.scope.Check(ctx, req); err != nil {
			return err
		}
	}
	return nil
}

// Reserve atomically reserves a logical connection slot before network work.
// Scope is checked again after registration, closing the check/revoke race.
func (r *Runtime) Reserve(ctx context.Context, scope Scope, kind WorkKind, limit int, requirements ...Requirement) (*Lease, error) {
	if len(requirements) == 0 || kind != Connection && kind != Task {
		return nil, ErrForbidden
	}
	if scope.Actor().Kind == protocol.Visitor && kind == Connection && limit < 1 {
		return nil, ErrForbidden
	}
	leaseCtx, cancel := context.WithCancelCause(WithScope(ctx, scope))
	l := &Lease{runtime: r, scope: scope, kind: kind, requirements: append([]Requirement(nil), requirements...), ctx: leaseCtx, cancel: cancel, expiryChanged: make(chan struct{}, 1)}
	if err := l.check(ctx); err != nil {
		cancel(err)
		return nil, err
	}
	r.mu.Lock()
	count := 0
	for existing := range r.leases {
		if existing.scope.Actor() == scope.Actor() && existing.kind == Connection {
			count++
		}
	}
	if r.closed || kind == Connection && limit > 0 && count >= limit {
		r.mu.Unlock()
		cancel(ErrCapacity)
		return nil, ErrCapacity
	}
	r.leases[l] = struct{}{}
	r.mu.Unlock()
	if err := l.check(ctx); err != nil {
		l.Close(err)
		return nil, err
	}
	go l.watch()
	return l, nil
}

func (l *Lease) watch() {
	if l.scope.IsOwner() {
		timer := time.NewTimer(time.Until(l.scope.ExpiresAt()))
		defer timer.Stop()
		for {
			select {
			case <-l.ctx.Done():
				l.Close(context.Cause(l.ctx))
				return
			case <-l.expiryChanged:
				timer.Reset(time.Until(l.scope.ExpiresAt()))
			case <-timer.C:
				// Renewal and expiration use the same lock. A closed or
				// already expired lease cannot be revived by late activity.
				l.runtime.mu.Lock()
				remaining := time.Until(l.scope.ExpiresAt())
				if remaining <= 0 {
					l.cancel(ErrExpired)
				}
				l.runtime.mu.Unlock()
				if remaining <= 0 {
					l.Close(ErrExpired)
					return
				}
				timer.Reset(remaining)
			}
		}
	}
	// Visitor deadlines stay fixed and interrupt blocked permission checks.
	timer := time.AfterFunc(time.Until(l.scope.ExpiresAt()), func() { l.Close(ErrExpired) })
	defer timer.Stop()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-l.ctx.Done():
			l.Close(context.Cause(l.ctx))
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(l.ctx, 4*time.Second)
			err := l.check(ctx)
			cancel()
			if err != nil {
				l.Close(err)
				return
			}
		}
	}
}

// RefreshOwnerSession follows a successfully persisted HTTP session renewal.
// It never changes visitor or scheduled-owner leases, and adds no polling.
func (r *Runtime) RefreshOwnerSession(sessionID string, expiresAt time.Time) {
	if sessionID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	for l := range r.leases {
		actor := l.scope.Actor()
		if !l.scope.IsOwner() || actor.SessionID != sessionID || l.ctx.Err() != nil {
			continue
		}
		if !now.Before(l.scope.ExpiresAt()) || !now.Before(expiresAt) {
			l.cancel(ErrExpired)
			continue
		}
		l.scope.expiresAt.Store(&expiresAt)
		select {
		case l.expiryChanged <- struct{}{}:
		default:
		}
	}
}

// Invalidate cancels matching work after revocation has committed. Empty fields
// are wildcards. Resource invalidation also stops transfers that use that resource.
func (r *Runtime) Invalidate(grantID, sessionID, serverID string, reason error) {
	r.mu.Lock()
	var matches []*Lease
	for l := range r.leases {
		a := l.scope.Actor()
		if grantID != "" && a.GrantID != grantID || sessionID != "" && a.SessionID != sessionID {
			continue
		}
		matched := serverID == ""
		for _, req := range l.requirements {
			matched = matched || req.ServerID == serverID
		}
		if matched {
			matches = append(matches, l)
		}
	}
	r.mu.Unlock()
	for _, l := range matches {
		l.Close(reason)
	}
}

func (r *Runtime) Busy(sessionID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for l := range r.leases {
		if l.scope.Actor().SessionID == sessionID {
			return true
		}
	}
	return false
}

func (r *Runtime) InvalidateVisitors(serverID string, reason error) {
	r.mu.Lock()
	var matches []*Lease
	for l := range r.leases {
		if l.scope.Actor().Kind != protocol.Visitor {
			continue
		}
		for _, req := range l.requirements {
			if req.ServerID == serverID {
				matches = append(matches, l)
				break
			}
		}
	}
	r.mu.Unlock()
	for _, l := range matches {
		l.Close(reason)
	}
}

func (r *Runtime) InvalidateOwner(ownerID string, reason error) {
	r.mu.Lock()
	var matches []*Lease
	for l := range r.leases {
		if l.scope.Actor().Kind == protocol.Owner && l.scope.Actor().ID == ownerID {
			matches = append(matches, l)
		}
	}
	r.mu.Unlock()
	for _, l := range matches {
		l.Close(reason)
	}
}

func (r *Runtime) Close() {
	r.mu.Lock()
	r.closed = true
	r.mu.Unlock()
	r.Invalidate("", "", "", errors.New("runtime shutting down"))
}

// RevalidateResource is used after sync commits. A changed credential ID can
// denote the same public identity, so only the persisted policy decides whether
// running work ends. A different remote identity advances the connection
// revision; password/passphrase rotation and equivalent key-ID normalization do not.
func (r *Runtime) RevalidateResource(serverID string) {
	r.mu.Lock()
	var affected []*Lease
	for lease := range r.leases {
		if lease.scope.Actor().Kind != protocol.Visitor {
			continue
		}
		for _, req := range lease.requirements {
			if req.ServerID == serverID {
				affected = append(affected, lease)
				break
			}
		}
	}
	r.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, lease := range affected {
		if err := lease.check(ctx); err != nil {
			lease.Close(err)
		}
	}
}

// InvalidateScript cancels running attempts that reference edited/deleted code.
func (r *Runtime) InvalidateScript(scriptID string, reason error) {
	r.mu.Lock()
	var matches []*Lease
	for lease := range r.leases {
		for _, req := range lease.requirements {
			if req.ScriptID == scriptID {
				matches = append(matches, lease)
				break
			}
		}
	}
	r.mu.Unlock()
	for _, lease := range matches {
		lease.Close(reason)
	}
}
