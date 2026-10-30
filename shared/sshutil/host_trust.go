package sshutil

import (
	"errors"
	"net"
	"net/netip"
	"strconv"
	"strings"

	"golang.org/x/crypto/ssh"
)

// HostKeyPolicy is resolved for each target before SSH negotiation. It carries
// both the negotiated signature algorithms and verification of the actual key.
type HostKeyPolicy func(host string, port int) (ssh.HostKeyCallback, []string, error)

func NormalizeHost(host string) string {
	host = strings.Trim(strings.TrimSpace(host), "[]")
	if ip, err := netip.ParseAddr(host); err == nil {
		return ip.Unmap().String()
	}
	return strings.TrimSuffix(strings.ToLower(host), ".")
}

func ParseHostAddress(address string) (string, int, error) {
	host, rawPort, err := net.SplitHostPort(address)
	if err != nil {
		// An unbracketed IPv6 literal is a host, not a host:port pair.
		if strings.Contains(address, ":") {
			if _, err := netip.ParseAddr(strings.Trim(address, "[]")); err != nil {
				return "", 0, errors.New("invalid SSH endpoint")
			}
		}
		host, rawPort = address, "22"
	}
	port, err := strconv.Atoi(rawPort)
	host = NormalizeHost(host)
	if err != nil || port < 1 || port > 65535 || host == "" || strings.ContainsAny(host, " /\\\t\r\n") {
		return "", 0, errors.New("invalid SSH endpoint")
	}
	return host, port, nil
}

// HostKeyAlgorithms maps public-key types to secure signature algorithms. An RSA
// public key is encoded as ssh-rsa even when signing with RSA SHA-2; ssh-rsa must
// never be passed through as a SHA-1 handshake algorithm.
func HostKeyAlgorithms(keyTypes []string) ([]string, error) {
	preference := []string{"ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "rsa-sha2-512", "rsa-sha2-256"}
	if len(keyTypes) == 0 {
		return preference, nil
	}
	allowed := make(map[string]bool)
	for _, keyType := range keyTypes {
		switch keyType {
		case "ssh-rsa":
			allowed["rsa-sha2-512"], allowed["rsa-sha2-256"] = true, true
		case "ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521":
			allowed[keyType] = true
		}
	}
	result := make([]string, 0, len(preference))
	for _, algorithm := range preference {
		if allowed[algorithm] {
			result = append(result, algorithm)
		}
	}
	if len(result) == 0 {
		return nil, errors.New("no trusted host key supports the allowed SSH signature algorithms")
	}
	return result, nil
}
