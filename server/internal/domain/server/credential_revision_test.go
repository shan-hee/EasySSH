package server

import (
	"context"
	"encoding/base64"
	"errors"
	"github.com/easyssh/shared/protocol"
	"testing"

	"github.com/easyssh/server/internal/access"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/google/uuid"
)

func TestPasswordRotationPreservesSharingRevision(t *testing.T) {
	repo, _ := newServerTestRepository(t)
	encryptor, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	ctx := groupContext(t, false)
	row := &Server{ID: uuid.New(), Host: "host.test", Username: "owner", CountryCode: "US", Auth: ServerAuth{AuthMethod: AuthMethodPassword}}
	row.Auth.Password, err = encryptor.EncryptSecret("before", row.CredentialAAD("password"))
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(ctx, row); err != nil {
		t.Fatal(err)
	}
	runtime := repo.(*gormRepository).runtime
	visitor := access.Current(groupContext(t, true))
	lease, err := runtime.Reserve(context.Background(), visitor, access.Connection, 1, access.Requirement{Action: protocol.TerminalConnect, ServerID: row.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close(nil)
	service := NewService(repo, encryptor, nil, nil)
	password := "before"
	unchanged, err := service.Update(ctx, access.Current(ctx), row.ID, &protocol.ServerUpdate{Password: &password})
	if err != nil || unchanged.ConnectionRevision != row.ConnectionRevision || unchanged.Auth.Password != row.Auth.Password {
		t.Fatal("same password invalidated approved connection", err)
	}
	password = "after"
	changed, err := service.Update(ctx, access.Current(ctx), row.ID, &protocol.ServerUpdate{Password: &password})
	if err != nil || changed.ConnectionRevision != row.ConnectionRevision {
		t.Fatal("password replacement invalidated sharing approval", err)
	}
	password = ""
	cleared, err := service.Update(ctx, access.Current(ctx), row.ID, &protocol.ServerUpdate{Password: &password})
	if err != nil || cleared.ConnectionRevision != changed.ConnectionRevision || cleared.Auth.Password != "" {
		t.Fatal("password removal changed sharing approval or retained secret", err)
	}
	runtime.RevalidateResource(row.ID.String())
	if lease.Context().Err() != nil {
		t.Fatal("password rotation terminated approved visitor connection")
	}
	username := "different-account"
	if _, err := service.Update(ctx, access.Current(ctx), row.ID, &protocol.ServerUpdate{Username: &username}); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(context.Cause(lease.Context()), access.ErrResourceChanged) {
		t.Fatal("remote identity change retained visitor connection")
	}
}

func TestPasswordRotationCannotBeOverwrittenByStaleServerEdit(t *testing.T) {
	repo, _ := newServerTestRepository(t)
	ctx := groupContext(t, false)
	row := &Server{ID: uuid.New(), Host: "host.test", Username: "owner", Auth: ServerAuth{AuthMethod: AuthMethodPassword, Password: "before"}}
	if err := repo.Create(ctx, row); err != nil {
		t.Fatal(err)
	}
	stale, err := repo.FindByID(ctx, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	current, err := repo.FindByID(ctx, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	current.Auth.Password = "after"
	if err = repo.Update(ctx, current); err != nil {
		t.Fatal(err)
	}
	stale.Name = "stale-edit"
	if err = repo.Update(ctx, stale); !errors.Is(err, ErrServerUpdateConflict) {
		t.Fatal("stale save overwrote password rotation", err)
	}
	saved, err := repo.FindByID(ctx, row.ID)
	if err != nil || saved.Auth.Password != "after" || saved.Name == "stale-edit" || saved.ConnectionRevision != row.ConnectionRevision {
		t.Fatal("stale edit changed authentication or sharing approval", err)
	}
}
