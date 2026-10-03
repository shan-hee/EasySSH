package crypto

import (
	"bytes"
	"encoding/base64"
	"testing"
)

func TestAuthenticatedSecretIsolation(t *testing.T) {
	root := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32))
	e, err := NewEncryptor(root)
	if err != nil {
		t.Fatal(err)
	}
	aad := SecretAAD("servers", "one", "password")
	ciphertext, err := e.EncryptSecret("   ", aad)
	if err != nil {
		t.Fatal(err)
	}
	again, err := e.EncryptSecret("   ", aad)
	if err != nil {
		t.Fatal(err)
	}
	if again == ciphertext {
		t.Fatal("encryption reused a nonce")
	}
	plain, err := e.DecryptSecret(ciphertext, aad)
	if err != nil || plain != "   " {
		t.Fatalf("round trip changed secret: %v", err)
	}
	if _, err := e.DecryptSecret(ciphertext, SecretAAD("servers", "two", "password")); err == nil {
		t.Fatal("accepted ciphertext from another record")
	}
	other, err := NewEncryptor(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := other.DecryptSecret(ciphertext, aad); err == nil {
		t.Fatal("accepted another root key")
	}
	data, err := base64.StdEncoding.DecodeString(ciphertext[len(encryptedValuePrefix):])
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)-1] ^= 1
	if _, err := e.DecryptSecret(encryptedValuePrefix+base64.StdEncoding.EncodeToString(data), aad); err == nil {
		t.Fatal("accepted modified ciphertext")
	}
	if _, err := e.DecryptSecret("plaintext", aad); err == nil {
		t.Fatal("accepted plaintext credentials")
	}
}
