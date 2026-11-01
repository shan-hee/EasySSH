package sshutil

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"

	"golang.org/x/crypto/ssh"
)

// Hop is one SSH endpoint, ordered from the externally reachable host to the target.
type Hop struct {
	Address string
	Config  *ssh.ClientConfig
}

// ErrForwardingDenied identifies rejection of a direct-tcpip channel by a jump
// host, separately from target authentication and ordinary network failures.
var ErrForwardingDenied = errors.New("SSH jump host denied TCP forwarding")

// DialRoute establishes a private transport for the complete route. Closing the
// returned target client closes every jump client as well; no hop is pooled on
// its own. The target address is resolved by the last jump host, not locally.
func DialRoute(ctx context.Context, hops []Hop) (*ssh.Client, error) {
	if len(hops) == 0 {
		return nil, errors.New("empty SSH route")
	}
	var client *ssh.Client
	for index, hop := range hops {
		var next *ssh.Client
		var err error
		if client == nil {
			next, err = DialContext(ctx, hop.Address, hop.Config)
		} else {
			parent := client
			// Closing the parent also unblocks an outstanding direct-tcpip request.
			canceled := make(chan struct{})
			stop := context.AfterFunc(ctx, func() { defer close(canceled); _ = parent.Close() })
			dialCtx := ctx
			cancel := func() {}
			if hop.Config.Timeout > 0 {
				dialCtx, cancel = context.WithTimeout(ctx, hop.Config.Timeout)
			}
			conn, dialErr := parent.DialContext(dialCtx, "tcp", hop.Address)
			cancel()
			if dialErr == nil {
				next, err = handshakeContext(ctx, &jumpConn{Conn: conn, parent: parent}, hop.Address, hop.Config)
			} else {
				err = dialErr
				var rejected *ssh.OpenChannelError
				if errors.As(dialErr, &rejected) && rejected.Reason == ssh.Prohibited {
					err = fmt.Errorf("%w: %s -> %s: %w", ErrForwardingDenied, hops[index-1].Address, hop.Address, dialErr)
				}
			}
			if !stop() {
				<-canceled
			}
			if ctx.Err() != nil {
				if next != nil {
					_ = next.Close()
				}
				err = ctx.Err()
			}
		}
		if err != nil {
			if client != nil {
				_ = client.Close()
			}
			return nil, fmt.Errorf("SSH hop %s: %w", hop.Address, err)
		}
		client = next
	}
	return client, nil
}

type jumpConn struct {
	net.Conn
	parent *ssh.Client
	once   sync.Once
	err    error
}

func (c *jumpConn) Close() error {
	c.once.Do(func() { c.err = errors.Join(c.Conn.Close(), c.parent.Close()) })
	return c.err
}
