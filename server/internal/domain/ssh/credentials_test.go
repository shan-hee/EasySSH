package ssh

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

type credentialAuthority struct {
	testutil.AccessPolicy
}

func (credentialAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func credentialContext(t *testing.T, actor protocol.Actor) context.Context {
	t.Helper()
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), credentialAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}

func TestRuntimeCredentialsCannotCrossConnectionRevisions(t *testing.T) {
	store := NewRuntimeCredentialStore()
	actor := protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}
	ctx := credentialContext(t, actor)
	id := uuid.New()
	secret := Credential{AuthMethod: server.AuthMethodPassword, Password: "old-password"}
	if err := store.Set(ctx, id, 1, [32]byte{}, secret); err != nil {
		t.Fatal(err)
	}
	if got, ok := store.Get(ctx, id, 1, [32]byte{}); !ok || got.Password != secret.Password {
		t.Fatal("same connection lost credential")
	}
	if _, ok := store.Get(ctx, id, 2, [32]byte{}); ok {
		t.Fatal("old credential exposed to changed target")
	}
	// An old authentication may finish after the invalidation. Its revision
	// stays old, so it still cannot supply credentials to the new endpoint.
	if err := store.Set(ctx, id, 1, [32]byte{}, secret); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Get(ctx, id, 2, [32]byte{}); ok {
		t.Fatal("late authentication rebound old credential")
	}
	newer := Credential{AuthMethod: server.AuthMethodPassword, Password: "new-password"}
	if err := store.Set(ctx, id, 2, [32]byte{}, newer); err != nil {
		t.Fatal(err)
	}
	if err := store.Set(ctx, id, 1, [32]byte{}, secret); !errors.Is(err, access.ErrResourceChanged) {
		t.Fatalf("stale write replaced current credential: %v", err)
	}
	if _, ok := store.Get(ctx, id, 1, [32]byte{}); ok {
		t.Fatal("stale caller obtained current credential")
	}
	if got, ok := store.Get(ctx, id, 2, [32]byte{}); !ok || got.Password != newer.Password {
		t.Fatal("stale reader removed current credential")
	}
	if _, ok := store.Get(ctx, id, 0, [32]byte{}); ok {
		t.Fatal("unversioned lookup accepted")
	}
	if err := store.Set(ctx, id, 0, [32]byte{}, secret); !errors.Is(err, access.ErrResourceChanged) {
		t.Fatal("unversioned credential accepted")
	}
}

func TestRuntimeCredentialsRemainSessionAndOwnerScoped(t *testing.T) {
	store := NewRuntimeCredentialStore()
	actor := protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}
	ctx := credentialContext(t, actor)
	id := uuid.New()
	if err := store.Set(ctx, id, 1, [32]byte{}, Credential{Password: "private"}); err != nil {
		t.Fatal(err)
	}
	other := actor
	other.SessionID = uuid.NewString()
	if _, ok := store.Get(credentialContext(t, other), id, 1, [32]byte{}); ok {
		t.Fatal("another session received credential")
	}
	visitorID := uuid.NewString()
	visitor := credentialContext(t, protocol.Actor{Kind: protocol.Visitor, ID: visitorID, SessionID: visitorID, GrantID: uuid.NewString()})
	if _, ok := store.Get(visitor, id, 1, [32]byte{}); ok {
		t.Fatal("visitor received owner credential")
	}
	if err := store.Set(visitor, id, 1, [32]byte{}, Credential{Password: "visitor"}); !errors.Is(err, access.ErrForbidden) {
		t.Fatal("visitor wrote credential")
	}
	store.Invalidate(uuid.MustParse(actor.ID), id)
	if _, ok := store.Get(ctx, id, 1, [32]byte{}); ok {
		t.Fatal("invalidated credential survived")
	}
}

func TestRuntimeCredentialsRejectRotatedSecretsWithoutChangingSharingRevision(t *testing.T) {
	store := NewRuntimeCredentialStore()
	ctx := credentialContext(t, protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()})
	id := uuid.New()
	snapshot := &server.Server{Auth: server.ServerAuth{Password: "saved-before"}}
	before := snapshot.CredentialDigest()
	snapshot.Auth.Password = "saved-after"
	after := snapshot.CredentialDigest()
	secret := Credential{Password: "temporary-before"}
	for _, digest := range [][32]byte{before, after} {
		if err := store.Set(ctx, id, 1, digest, secret); err != nil {
			t.Fatal(err)
		}
		if _, ok := store.Get(ctx, id, 1, digest); !ok {
			t.Fatal("matching authentication snapshot lost")
		}
	}
	store.Invalidate(uuid.MustParse(access.Current(ctx).Actor().ID), id)
	// Authentication begun before rotation completes after invalidation.
	if err := store.Set(ctx, id, 1, before, secret); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Get(ctx, id, 1, after); ok {
		t.Fatal("late old credential survived password rotation")
	}
}
