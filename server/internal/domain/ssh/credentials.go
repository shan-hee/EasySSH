package ssh

import (
	"fmt"
	"sync"

	"github.com/easyssh/server/internal/domain/server"
	"github.com/google/uuid"
)

// Credential 是一次 SSH/SFTP 建连使用的临时认证信息，不负责持久化。
type Credential struct {
	AuthMethod           server.AuthMethod
	Secret               string
	PrivateKeyPassphrase string
}

func CredentialOptions(credential *Credential) []ClientOption {
	if credential == nil {
		return nil
	}

	opts := make([]ClientOption, 0, 2)
	if credential.AuthMethod == server.AuthMethodKey {
		if credential.Secret != "" {
			opts = append(opts, WithPrivateKeyAuth(credential.Secret))
		}
	} else {
		opts = append(opts, WithPasswordAuth(credential.Secret))
	}
	if credential.PrivateKeyPassphrase != "" {
		opts = append(opts, WithPrivateKeyPassphrase(credential.PrivateKeyPassphrase))
	}
	return opts
}

type RuntimeCredentialStore struct {
	mu         sync.RWMutex
	credential map[string]Credential
}

func NewRuntimeCredentialStore() *RuntimeCredentialStore {
	return &RuntimeCredentialStore{
		credential: map[string]Credential{},
	}
}

func runtimeCredentialKey(userID, serverID uuid.UUID) string {
	return fmt.Sprintf("%s:%s", userID.String(), serverID.String())
}

func (s *RuntimeCredentialStore) Set(userID, serverID uuid.UUID, credential Credential) {
	if s == nil || userID == uuid.Nil || serverID == uuid.Nil {
		return
	}

	s.mu.Lock()
	s.credential[runtimeCredentialKey(userID, serverID)] = credential
	s.mu.Unlock()
}

func (s *RuntimeCredentialStore) Get(userID, serverID uuid.UUID) (*Credential, bool) {
	if s == nil || userID == uuid.Nil || serverID == uuid.Nil {
		return nil, false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	credential, ok := s.credential[runtimeCredentialKey(userID, serverID)]
	if !ok {
		return nil, false
	}

	return &credential, true
}

func (s *RuntimeCredentialStore) Delete(userID, serverID uuid.UUID) {
	if s == nil || userID == uuid.Nil || serverID == uuid.Nil {
		return
	}

	s.mu.Lock()
	delete(s.credential, runtimeCredentialKey(userID, serverID))
	s.mu.Unlock()
}
