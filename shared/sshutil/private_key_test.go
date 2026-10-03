package sshutil

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestPrivateKeyFormats(t *testing.T) {
	_, ed, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	ec, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, algorithm string
		key             any
		size            int
	}{
		{"ed25519", "ed25519", ed, 0}, {"rsa", "rsa", rsaKey, 2048}, {"ecdsa", "ecdsa", ec, 256},
	} {
		t.Run(tc.name, func(t *testing.T) {
			der, err := x509.MarshalPKCS8PrivateKey(tc.key)
			if err != nil {
				t.Fatal(err)
			}
			material := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
			metadata, err := InspectPrivateKey(material, "")
			if err != nil {
				t.Fatal(err)
			}
			signer, err := ParsePrivateKey(material, "")
			if err != nil {
				t.Fatal(err)
			}
			if metadata.Algorithm != tc.algorithm || metadata.KeySize != tc.size || metadata.PassphraseRequired || metadata.Fingerprint != ssh.FingerprintSHA256(signer.PublicKey()) {
				t.Fatalf("unexpected key metadata: %+v", metadata)
			}
		})
	}
}

func TestEncryptedPrivateKeyPreservesWhitespacePassphrase(t *testing.T) {
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKeyWithPassphrase(key, "test", []byte("   "))
	if err != nil {
		t.Fatal(err)
	}
	material := string(pem.EncodeToMemory(block))
	metadata, err := InspectPrivateKey(material, "   ")
	if err != nil || !metadata.PassphraseRequired {
		t.Fatalf("encrypted key import failed: %v", err)
	}
	for _, tc := range []struct{ passphrase, want string }{{"", "private_key_passphrase_required"}, {"wrong", "private_key_passphrase_invalid"}} {
		if _, err := ParsePrivateKey(material, tc.passphrase); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("expected %s, got %v", tc.want, err)
		}
	}
}
