package sshclient

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestHostVerificationBeforePasswordAuthentication(t *testing.T) {
	for _, trusted := range []bool{false, true} {
		t.Run(map[bool]string{false: "reject", true: "accept"}[trusted], func(t *testing.T) {
			_, private, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			signer, err := ssh.NewSignerFromKey(private)
			if err != nil {
				t.Fatal(err)
			}
			var passwordSeen atomic.Bool
			serverConfig := &ssh.ServerConfig{PasswordCallback: func(_ ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
				passwordSeen.Store(true)
				if string(password) != "test-only-password" {
					return nil, errors.New("wrong test password")
				}
				return nil, nil
			}}
			serverConfig.AddHostKey(signer)
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			done := make(chan struct{})
			go func() {
				defer close(done)
				conn, err := listener.Accept()
				if err != nil {
					return
				}
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
				peer, channels, requests, err := ssh.NewServerConn(conn, serverConfig)
				if err != nil {
					return
				}
				defer peer.Close()
				go ssh.DiscardRequests(requests)
				for channel := range channels {
					_ = channel.Reject(ssh.Prohibited, "test server")
				}
			}()
			stream, err := net.Dial("tcp", listener.Addr().String())
			if err != nil {
				t.Fatal(err)
			}
			target := Config{Host: "expected-host", Port: 22, Username: "test-user", AuthMethod: "password"}
			config, err := ClientConfig(target, Credentials{Password: "test-only-password"}, func(host string, _ net.Addr, key ssh.PublicKey) error {
				if host != "expected-host:22" || ssh.FingerprintSHA256(key) != ssh.FingerprintSHA256(signer.PublicKey()) {
					return errors.New("unexpected target")
				}
				if !trusted {
					return errors.New("host key rejected")
				}
				return nil
			}, nil)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			client, err := Connect(ctx, stream, target, config)
			if trusted && err != nil {
				t.Fatal(err)
			}
			if !trusted && err == nil {
				t.Fatal("accepted an untrusted host")
			}
			if client != nil {
				client.Close()
			}
			select {
			case <-done:
			case <-ctx.Done():
				t.Fatal("SSH peer did not close")
			}
			if passwordSeen.Load() != trusted {
				t.Fatalf("password authentication occurred=%v, trusted=%v", passwordSeen.Load(), trusted)
			}
		})
	}
}

func TestClientCannotUseAnUnverifiedHost(t *testing.T) {
	_, err := ClientConfig(Config{Host: "host", Port: 22, Username: "user", AuthMethod: "password"}, Credentials{Password: "test"}, nil, nil)
	if err == nil {
		t.Fatal("accepted missing host key verification")
	}
}

func TestCancelledHandshakeClosesCallerStream(t *testing.T) {
	stream, peer := net.Pipe()
	defer peer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan error, 1)
	go func() {
		_, err := Connect(ctx, stream, Config{Host: "host", Port: 22}, &ssh.ClientConfig{User: "test", HostKeyCallback: func(string, net.Addr, ssh.PublicKey) error { return nil }})
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled handshake succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled handshake remained blocked")
	}
}
