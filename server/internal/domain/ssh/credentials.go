package ssh

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
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
	Password             string
	PrivateKey           string
	PrivateKeyPassphrase string
}

func CredentialOptions(credential *Credential) []ClientOption {
	if credential == nil {
		return nil
	}

	opts := make([]ClientOption, 0, 4)
	if credential.AuthMethod.IsValid() {
		opts = append(opts, WithAuthMethod(credential.AuthMethod))
	}

	password := credential.Password
	privateKey := credential.PrivateKey
	if credential.Secret != "" {
		if credential.AuthMethod.RequiresPrivateKey() && !credential.AuthMethod.RequiresPassword() {
			privateKey = credential.Secret
		} else if credential.AuthMethod.RequiresPassword() && !credential.AuthMethod.RequiresPrivateKey() {
			password = credential.Secret
		} else if credential.AuthMethod == server.AuthMethodKey {
			privateKey = credential.Secret
		} else if credential.AuthMethod == server.AuthMethodPassword {
			password = credential.Secret
		}
	}

	if password != "" {
		opts = append(opts, WithPasswordAuth(password))
	}
	if privateKey != "" {
		opts = append(opts, WithPrivateKeyAuth(privateKey))
	}
	if credential.PrivateKeyPassphrase != "" {
		opts = append(opts, WithPrivateKeyPassphrase(credential.PrivateKeyPassphrase))
	}
	return opts
}

type RuntimeCredentialStore struct {
	mu         sync.RWMutex
	credential map[credentialKey]runtimeCredentialEntry
	ttl        time.Duration
}

type credentialKey struct {
	SessionID string
	ServerID  uuid.UUID
}
type runtimeCredentialEntry struct {
	Revision   int64
	Digest     [32]byte
	Actor      protocol.Actor
	Credential Credential
	ExpiresAt  time.Time
}

func NewRuntimeCredentialStore() *RuntimeCredentialStore {
	return &RuntimeCredentialStore{credential: map[credentialKey]runtimeCredentialEntry{}, ttl: defaultRuntimeCredentialTTL}
}
func (s *RuntimeCredentialStore) Set(ctx context.Context, serverID uuid.UUID, revision int64, digest [32]byte, credential Credential) error {
	scope := access.Current(ctx)
	if err := scope.RequireOwner(ctx, protocol.CredentialsRead); err != nil {
		return err
	}
	if revision < 1 {
		return access.ErrResourceChanged
	}
	key := credentialKey{scope.Actor().SessionID, serverID}
	s.mu.Lock()
	if current, ok := s.credential[key]; ok && current.Revision > revision {
		s.mu.Unlock()
		return access.ErrResourceChanged
	}
	s.credential[key] = runtimeCredentialEntry{Actor: scope.Actor(), Revision: revision, Digest: digest, Credential: credential, ExpiresAt: time.Now().Add(s.ttl)}
	s.mu.Unlock()
	return nil
}
func (s *RuntimeCredentialStore) Get(ctx context.Context, serverID uuid.UUID, revision int64, digest [32]byte) (*Credential, bool) {
	scope := access.Current(ctx)
	if scope.RequireOwner(ctx, protocol.CredentialsRead) != nil {
		return nil, false
	}
	key := credentialKey{scope.Actor().SessionID, serverID}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.credential[key]
	if !ok {
		return nil, false
	}
	if entry.Actor != scope.Actor() || !time.Now().Before(entry.ExpiresAt) {
		delete(s.credential, key)
		return nil, false
	}
	if revision < 1 || entry.Revision != revision || entry.Digest != digest {
		if entry.Revision < revision {
			delete(s.credential, key)
		}
		return nil, false
	}
	value := entry.Credential
	return &value, true
}
func (s *RuntimeCredentialStore) Delete(ctx context.Context, serverID uuid.UUID) {
	scope := access.Current(ctx)
	s.mu.Lock()
	delete(s.credential, credentialKey{scope.Actor().SessionID, serverID})
	s.mu.Unlock()
}

// Invalidate is called after a trusted resource mutation commits.
func (s *RuntimeCredentialStore) Invalidate(ownerID, serverID uuid.UUID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, entry := range s.credential {
		if key.ServerID == serverID && entry.Actor.ID == ownerID.String() {
			delete(s.credential, key)
		}
	}
}
