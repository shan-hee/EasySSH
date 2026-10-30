package syncdata

import (
	"errors"
	"strings"

	"github.com/easyssh/shared/sshutil"
	"golang.org/x/crypto/ssh"
)

func ValidateKey(k *KeyMaterial) error {
	if k == nil || !ValidUUID(k.ID) {
		return errors.New("invalid key ID")
	}
	if len(k.PrivateKey) > 1<<20 || len(k.SavedPassphrase) > 4096 {
		return errors.New("key material exceeds limit")
	}
	metadata, err := sshutil.InspectPublicKey(k.PublicKey)
	if err != nil {
		return err
	}
	if metadata.Fingerprint != k.Fingerprint || metadata.Algorithm != k.Algorithm || metadata.KeySize != k.KeySize {
		return errors.New("key fingerprint mismatch")
	}
	if k.PrivateKey == "" {
		if k.SavedPassphrase != "" {
			return errors.New("passphrase without private key")
		}
	} else if k.PassphraseRequired && k.SavedPassphrase == "" {
		_, err := ssh.ParseRawPrivateKey([]byte(k.PrivateKey))
		var missing *ssh.PassphraseMissingError
		if !errors.As(err, &missing) {
			return errors.New("invalid encrypted private key")
		}
		if missing.PublicKey == nil || ssh.FingerprintSHA256(missing.PublicKey) != k.Fingerprint {
			return errors.New("private/public key mismatch")
		}
	} else {
		metadata, err := sshutil.InspectPrivateKey(k.PrivateKey, k.SavedPassphrase)
		if err != nil {
			return err
		}
		if metadata.Fingerprint != k.Fingerprint || metadata.PassphraseRequired != k.PassphraseRequired {
			return errors.New("private/public key mismatch")
		}
	}
	if strings.TrimSpace(k.Name) == "" || len(k.Name) > 100 {
		return errors.New("invalid key name")
	}
	return nil
}
