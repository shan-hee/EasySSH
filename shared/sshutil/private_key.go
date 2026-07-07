package sshutil

import (
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"
)

func ParsePrivateKey(privateKey string, passphrase string) (ssh.Signer, error) {
	keyBytes := []byte(privateKey)
	signer, err := ssh.ParsePrivateKey(keyBytes)
	if err == nil {
		return signer, nil
	}

	var missingPassphrase *ssh.PassphraseMissingError
	if !errors.As(err, &missingPassphrase) {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	if strings.TrimSpace(passphrase) == "" {
		return nil, fmt.Errorf("private_key_passphrase_required: %w", err)
	}

	signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(passphrase))
	if err != nil {
		return nil, fmt.Errorf("private_key_passphrase_invalid: %w", err)
	}

	return signer, nil
}
