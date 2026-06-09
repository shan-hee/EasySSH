package ssh

import (
	"fmt"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/server"
	"github.com/google/uuid"
)

const defaultRuntimeCredentialTTL = 15 * time.Minute

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
	credential map[string]runtimeCredentialEntry
	ttl        time.Duration
}

type runtimeCredentialEntry struct {
	Credential Credential
	ExpiresAt  time.Time
}

func NewRuntimeCredentialStore() *RuntimeCredentialStore {
	return &RuntimeCredentialStore{
		credential: map[string]runtimeCredentialEntry{},
		ttl:        defaultRuntimeCredentialTTL,
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
	s.credential[runtimeCredentialKey(userID, serverID)] = runtimeCredentialEntry{
		Credential: credential,
		ExpiresAt:  time.Now().Add(s.ttl),
	}
	s.mu.Unlock()
}

func (s *RuntimeCredentialStore) Get(userID, serverID uuid.UUID) (*Credential, bool) {
	if s == nil || userID == uuid.Nil || serverID == uuid.Nil {
		return nil, false
	}

	key := runtimeCredentialKey(userID, serverID)
	s.mu.RLock()
	entry, ok := s.credential[key]
	s.mu.RUnlock()
	if !ok {
		return nil, false
	}

	if time.Now().After(entry.ExpiresAt) {
		s.mu.Lock()
		if current, exists := s.credential[key]; exists && current.ExpiresAt.Equal(entry.ExpiresAt) {
			delete(s.credential, key)
		}
		s.mu.Unlock()
		return nil, false
	}

	credential := entry.Credential
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
