package access

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"github.com/easyssh/shared/protocol"
	"sync"
	"time"
)

const ConnectionIdleTimeout = 90 * time.Second

func connectionAction(m protocol.ConnectionMode) protocol.Action {
	switch m {
	case protocol.TerminalConnection:
		return protocol.TerminalConnect
	case protocol.FilesConnection:
		return protocol.FilesList
	case protocol.MonitorConnection:
		return protocol.MonitorRead
	case protocol.DockerConnection:
		return protocol.DockerRead
	}
	return ""
}

type LogicalConnection struct {
	info     protocol.ConnectionInfo
	lease    *Lease
	mu       sync.Mutex
	lastSeen time.Time
	primary  bool
}

// CreateConnection reserves quota before exposing the ID. Its lifetime is
// independent of the create request. Unclaimed sessions are reaped after 90s.
func (r *Runtime) CreateConnection(ctx context.Context, scope Scope, serverID string, mode protocol.ConnectionMode) (protocol.ConnectionInfo, error) {
	if err := ctx.Err(); err != nil {
		return protocol.ConnectionInfo{}, err
	}
	if serverID == "" || connectionAction(mode) == "" {
		return protocol.ConnectionInfo{}, ErrForbidden
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return protocol.ConnectionInfo{}, err
	}
	lease, err := scope.OpenWork(context.WithoutCancel(ctx), Connection, Requirement{Action: connectionAction(mode), ServerID: serverID})
	if err != nil {
		return protocol.ConnectionInfo{}, err
	}
	if err := ctx.Err(); err != nil {
		lease.Close(err)
		return protocol.ConnectionInfo{}, err
	}
	info := protocol.ConnectionInfo{ID: hex.EncodeToString(random[:]), ServerID: serverID, Mode: mode, HeartbeatSeconds: 30}
	logical := &LogicalConnection{info: info, lease: lease, lastSeen: time.Now()}
	r.mu.Lock()
	if r.closed || lease.Context().Err() != nil {
		r.mu.Unlock()
		lease.Close(ErrRevoked)
		return protocol.ConnectionInfo{}, ErrRevoked
	}
	r.connections[info.ID] = logical
	r.mu.Unlock()
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		defer func() { r.mu.Lock(); delete(r.connections, info.ID); r.mu.Unlock() }()
		for {
			select {
			case <-lease.Context().Done():
				return
			case now := <-ticker.C:
				logical.mu.Lock()
				idle := !logical.primary && now.Sub(logical.lastSeen) >= ConnectionIdleTimeout
				// Cancel while holding the same lock as touch/primary claim.
				if idle {
					lease.Close(ErrExpired)
				}
				logical.mu.Unlock()
				if idle {
					return
				}
			}
		}
	}()
	return info, nil
}

// Connection verifies the exact authenticated actor. An ID is a selector, never
// authority, and cannot be shared between browser sessions or servers.
func (r *Runtime) Connection(ctx context.Context, scope Scope, id, serverID string) (*LogicalConnection, error) {
	r.mu.Lock()
	logical := r.connections[id]
	r.mu.Unlock()
	if logical == nil || logical.lease.scope.Actor() != scope.Actor() || serverID != "" && logical.info.ServerID != serverID {
		return nil, ErrForbidden
	}
	if err := logical.lease.check(ctx); err != nil {
		logical.lease.Close(err)
		return nil, err
	}
	logical.mu.Lock()
	defer logical.mu.Unlock()
	if logical.lease.Context().Err() != nil {
		return nil, ErrRevoked
	}
	logical.lastSeen = time.Now()
	return logical, nil
}

func (c *LogicalConnection) Info() protocol.ConnectionInfo { return c.info }
func (c *LogicalConnection) Close()                        { c.lease.Close(ErrRevoked) }

type connectionKey struct{}

// Bind keeps an HTTP request and its independently checked work below the
// logical session's cancellation tree, without closing the session on response.
func (c *LogicalConnection) Bind(ctx context.Context) (context.Context, func()) {
	bound, cancel := context.WithCancelCause(context.WithValue(ctx, connectionKey{}, c))
	stop := context.AfterFunc(c.lease.Context(), func() { cancel(context.Cause(c.lease.Context())) })
	if c.lease.Context().Err() != nil {
		cancel(context.Cause(c.lease.Context()))
	}
	return bound, func() { stop(); cancel(context.Canceled) }
}

func ConnectionFromContext(ctx context.Context) *LogicalConnection {
	c, _ := ctx.Value(connectionKey{}).(*LogicalConnection)
	if c == nil || c.lease.scope.Actor() != Current(ctx).Actor() {
		return nil
	}
	return c
}

type StreamLease struct {
	*Lease
	connection *LogicalConnection
	primary    bool
	once       sync.Once
}

func (l *StreamLease) Close(reason error) {
	l.once.Do(func() {
		l.Lease.Close(reason)
		if l.primary {
			l.connection.Close()
		}
	})
}

// OpenStream allows one primary terminal/monitor per resource session. Monitor
// streams attached to terminals or files are children and consume no new slot.
func OpenStream(ctx context.Context, req Requirement) (*StreamLease, error) {
	c := ConnectionFromContext(ctx)
	if c == nil || req.ServerID != c.info.ServerID {
		return nil, ErrForbidden
	}
	if req.Action != protocol.MonitorRead && req.Action != protocol.TerminalConnect {
		return nil, ErrForbidden
	}
	if req.Action == protocol.TerminalConnect && c.info.Mode != protocol.TerminalConnection {
		return nil, ErrForbidden
	}
	primary := req.Action == connectionAction(c.info.Mode) && c.info.Mode != protocol.FilesConnection
	c.mu.Lock()
	if c.lease.Context().Err() != nil || primary && c.primary {
		c.mu.Unlock()
		return nil, ErrForbidden
	}
	if primary {
		c.primary = true
	}
	c.mu.Unlock()
	lease, err := Current(ctx).OpenWork(ctx, Task, req)
	if err != nil {
		if primary {
			c.Close()
		}
		return nil, err
	}
	return &StreamLease{Lease: lease, connection: c, primary: primary}, nil
}
