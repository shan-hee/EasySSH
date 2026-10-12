// Package sshclient establishes SSH on a caller-owned byte stream. It has no
// database, HTTP server, desktop runtime, or credential persistence dependency.
package sshclient

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/easyssh/shared/sshutil"
	"golang.org/x/crypto/ssh"
)

type Config struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	AuthMethod string `json:"auth_method"`
}

// Credentials are supplied by the local caller, never by the relay.
type Credentials struct {
	Password   string `json:"password"`
	PrivateKey string `json:"private_key"`
	Passphrase string `json:"passphrase"`
}

func ClientConfig(target Config, secrets Credentials, hostKey ssh.HostKeyCallback, keyboard ssh.KeyboardInteractiveChallenge) (*ssh.ClientConfig, error) {
	if strings.TrimSpace(target.Host) == "" || target.Port < 1 || target.Port > 65535 || strings.TrimSpace(target.Username) == "" {
		return nil, errors.New("invalid SSH target")
	}
	if hostKey == nil {
		return nil, errors.New("host key verification is required")
	}
	var factors []string
	switch target.AuthMethod {
	case "keyboard", "keyboard_interactive":
		factors = []string{"keyboard"}
	case "password", "key", "password_keyboard", "key_keyboard", "key_password", "key_password_keyboard", "password_key", "password_key_keyboard":
		factors = strings.Split(target.AuthMethod, "_")
	default:
		return nil, errors.New("unsupported SSH authentication method")
	}
	methods := make([]ssh.AuthMethod, 0, len(factors))
	for _, factor := range factors {
		switch factor {
		case "password":
			if secrets.Password == "" {
				return nil, errors.New("SSH password is required")
			}
			methods = append(methods, ssh.Password(secrets.Password))
		case "key":
			if secrets.PrivateKey == "" {
				return nil, errors.New("SSH private key is required")
			}
			signer, err := sshutil.ParsePrivateKey(secrets.PrivateKey, secrets.Passphrase)
			if err != nil {
				return nil, err
			}
			methods = append(methods, ssh.PublicKeys(signer))
		case "keyboard":
			if keyboard == nil {
				return nil, errors.New("interactive authentication is required")
			}
			methods = append(methods, ssh.KeyboardInteractive(keyboard))
		}
	}
	return &ssh.ClientConfig{User: target.Username, Auth: methods, HostKeyCallback: hostKey, Timeout: 30 * time.Second}, nil
}

// Connect takes ownership of stream, including on failure. The relay transports
// this stream without terminating SSH. Cancellation also interrupts a handshake.
func Connect(ctx context.Context, stream net.Conn, target Config, config *ssh.ClientConfig) (*ssh.Client, error) {
	if stream == nil {
		return nil, errors.New("SSH stream is required")
	}
	if config == nil || config.HostKeyCallback == nil {
		stream.Close()
		return nil, errors.New("SSH configuration and host key verification are required")
	}
	stop := context.AfterFunc(ctx, func() { _ = stream.Close() })
	defer stop()
	address := net.JoinHostPort(target.Host, strconv.Itoa(target.Port))
	conn, channels, requests, err := ssh.NewClientConn(stream, address, config)
	if err != nil {
		stream.Close()
		return nil, fmt.Errorf("SSH handshake: %w", err)
	}
	if err := ctx.Err(); err != nil {
		conn.Close()
		return nil, err
	}
	return ssh.NewClient(conn, channels, requests), nil
}
