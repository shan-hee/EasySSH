package sshutil

import (
	"context"
	"net"

	"golang.org/x/crypto/ssh"
)

// DialContext bounds TCP establishment by config.Timeout and the complete SSH
// handshake by ctx. Interactive authentication may therefore use a longer
// deadline than TCP dialing. A returned client no longer belongs to ctx.
func DialContext(ctx context.Context, address string, config *ssh.ClientConfig) (*ssh.Client, error) {
	dialer := net.Dialer{Timeout: config.Timeout}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}
	return handshakeContext(ctx, conn, address, config)
}

func handshakeContext(ctx context.Context, conn net.Conn, address string, config *ssh.ClientConfig) (*ssh.Client, error) {
	closed := make(chan struct{})
	stop := context.AfterFunc(ctx, func() {
		defer close(closed)
		_ = conn.Close()
	})
	transport, channels, requests, err := ssh.NewClientConn(conn, address, config)
	if !stop() {
		<-closed
	}
	if ctx.Err() != nil {
		_ = conn.Close()
		return nil, ctx.Err()
	}
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	return ssh.NewClient(transport, channels, requests), nil
}
