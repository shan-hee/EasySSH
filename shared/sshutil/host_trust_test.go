package sshutil

import (
	"slices"
	"testing"
)

func TestRSATrustDoesNotEnableSHA1(t *testing.T) {
	algorithms, err := HostKeyAlgorithms([]string{"ssh-rsa"})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(algorithms, "rsa-sha2-512") || !slices.Contains(algorithms, "rsa-sha2-256") {
		t.Fatalf("RSA SHA-2 identity was lost: %v", algorithms)
	}
	if slices.Contains(algorithms, "ssh-rsa") || slices.Contains(algorithms, "ssh-ed25519") {
		t.Fatalf("negotiation escaped the trusted identity or enabled SHA-1: %v", algorithms)
	}
}

func TestUnsupportedTrustDoesNotFallBackToUntrustedKeys(t *testing.T) {
	if _, err := HostKeyAlgorithms([]string{"ssh-dss"}); err == nil {
		t.Fatal("unsupported trust must fail rather than negotiate unrelated default keys")
	}
}

func TestEndpointNormalization(t *testing.T) {
	for address, want := range map[string]string{
		"EXAMPLE.COM.:2222":     "example.com",
		"[2001:0db8::1]:22":     "2001:db8::1",
		"[::ffff:192.0.2.1]:22": "192.0.2.1",
	} {
		host, _, err := ParseHostAddress(address)
		if err != nil || host != want {
			t.Fatalf("%q: got %q, %v", address, host, err)
		}
	}
	for _, address := range []string{"host:0", "host:65536", "host:no", "bad host:22"} {
		if _, _, err := ParseHostAddress(address); err == nil {
			t.Fatalf("invalid endpoint accepted: %q", address)
		}
	}
}
