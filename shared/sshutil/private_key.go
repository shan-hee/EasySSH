package sshutil

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"
)

func ParsePrivateKey(privateKey string, passphrase string) (ssh.Signer, error) {
	key, err := ParseRawPrivateKey(privateKey, passphrase)
	if err != nil {
		return nil, err
	}
	return ssh.NewSignerFromKey(key)
}

// ParseRawPrivateKey is shared by key import and SSH authentication. Passphrases
// are only used while parsing and are never part of the returned metadata.
func ParseRawPrivateKey(privateKey, passphrase string) (any, error) {
	keyBytes := []byte(strings.TrimSpace(privateKey))
	key, err := ssh.ParseRawPrivateKey(keyBytes)
	if err == nil {
		return key, nil
	}

	var missingPassphrase *ssh.PassphraseMissingError
	if !errors.As(err, &missingPassphrase) {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	if passphrase == "" {
		return nil, fmt.Errorf("private_key_passphrase_required: %w", err)
	}

	key, err = ssh.ParseRawPrivateKeyWithPassphrase(keyBytes, []byte(passphrase))
	if err != nil {
		return nil, fmt.Errorf("private_key_passphrase_invalid: %w", err)
	}

	return key, nil
}

type KeyMetadata struct {
	PublicKey          string
	Fingerprint        string
	Algorithm          string
	KeySize            int
	PassphraseRequired bool
}

func InspectPrivateKey(privateKey, passphrase string) (KeyMetadata, error) {
	key, err := ParseRawPrivateKey(privateKey, passphrase)
	if err != nil {
		return KeyMetadata{}, err
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		return KeyMetadata{}, err
	}
	metadata := KeyMetadata{
		PublicKey:   string(ssh.MarshalAuthorizedKey(signer.PublicKey())),
		Fingerprint: ssh.FingerprintSHA256(signer.PublicKey()),
	}
	switch key := key.(type) {
	case *rsa.PrivateKey:
		metadata.Algorithm, metadata.KeySize = "rsa", key.N.BitLen()
	case *ed25519.PrivateKey, ed25519.PrivateKey:
		metadata.Algorithm = "ed25519"
	case *ecdsa.PrivateKey:
		metadata.Algorithm, metadata.KeySize = "ecdsa", key.Curve.Params().BitSize
	default:
		return KeyMetadata{}, errors.New("unsupported key type: use RSA, ED25519 or ECDSA")
	}
	_, err = ssh.ParseRawPrivateKey([]byte(strings.TrimSpace(privateKey)))
	var missing *ssh.PassphraseMissingError
	metadata.PassphraseRequired = errors.As(err, &missing)
	return metadata, nil
}
