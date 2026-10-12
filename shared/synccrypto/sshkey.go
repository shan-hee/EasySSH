package synccrypto

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"errors"
	"github.com/easyssh/shared/sshutil"
	"golang.org/x/crypto/ssh"
)

func inspectSSHKey(material, passphrase string) (map[string]any, error) {
	if len(material) > 1<<20 {
		return nil, ErrInvalid
	}
	metadata, err := sshutil.InspectPrivateKey(material, passphrase)
	if err != nil {
		return nil, err
	}
	return map[string]any{"public_key": metadata.PublicKey, "fingerprint": metadata.Fingerprint, "algorithm": metadata.Algorithm, "key_size": metadata.KeySize, "passphrase_required": metadata.PassphraseRequired}, nil
}
func generateSSHKey(algorithm string, size int) (string, error) {
	var key any
	var err error
	switch algorithm {
	case "ed25519":
		_, key, err = ed25519.GenerateKey(rand.Reader)
	case "rsa":
		if size == 0 {
			size = 3072
		}
		if size != 2048 && size != 3072 && size != 4096 {
			return "", errors.New("unsupported RSA size")
		}
		key, err = rsa.GenerateKey(rand.Reader, size)
	default:
		return "", errors.New("unsupported SSH key algorithm")
	}
	if err != nil {
		return "", err
	}
	block, err := ssh.MarshalPrivateKey(key, "EasySSH")
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(block)), nil
}
