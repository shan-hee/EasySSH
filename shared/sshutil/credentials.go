package sshutil

import (
	"crypto/sha256"
	"encoding/json"
)

// CredentialDigest binds an in-memory credential to the saved authentication
// material used for that connection. It is never persisted or exposed in APIs.
func CredentialDigest(password, privateKey, passphrase string) [32]byte {
	data, _ := json.Marshal([3]string{password, privateKey, passphrase})
	return sha256.Sum256(data)
}
