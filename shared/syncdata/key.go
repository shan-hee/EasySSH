package syncdata

import (
	"errors"
	"strings"

	"github.com/easyssh/shared/sshutil"
	"golang.org/x/crypto/ssh"
)

func ValidateKey(k *KeyMaterial) error {
	pub, _, _, _, err := ssh.ParseAuthorizedKey([]byte(k.PublicKey))
	if err != nil {
		return err
	}
	if ssh.FingerprintSHA256(pub) != k.Fingerprint {
		return errors.New("key fingerprint mismatch")
	}
	if k.PrivateKey == "" {
		if k.PassphraseRequired {
			return errors.New("missing encrypted private key")
		}
	} else if k.PassphraseRequired {
		_, err := ssh.ParseRawPrivateKey([]byte(k.PrivateKey))
		var missing *ssh.PassphraseMissingError
		if !errors.As(err, &missing) {
			return errors.New("invalid encrypted private key")
		}
		if missing.PublicKey != nil && ssh.FingerprintSHA256(missing.PublicKey) != k.Fingerprint {
			return errors.New("private/public key mismatch")
		}
	} else {
		metadata, err := sshutil.InspectPrivateKey(k.PrivateKey, "")
		if err != nil {
			return err
		}
		if metadata.Fingerprint != k.Fingerprint {
			return errors.New("private/public key mismatch")
		}
	}
	if strings.TrimSpace(k.Name) == "" || len(k.Name) > 100 {
		return errors.New("invalid key name")
	}
	return nil
}
