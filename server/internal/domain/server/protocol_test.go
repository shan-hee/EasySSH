package server

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/sshkey"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func TestServerPublicUsesUUIDAndKeepsOwnerFieldsPrivate(t *testing.T) {
	keyID := uuid.New()
	row := Server{ID: uuid.New(), Host: "example.invalid", Port: 22, Username: "owner", Status: StatusOffline,
		Auth: ServerAuth{AuthMethod: AuthMethodKeyPasswordKeyboard, Password: "ciphertext-password", SSHKeyID: &keyID,
			SSHKey: &sshkey.SSHKey{PrivateKey: "ciphertext-key"}},
		Description: "owner note", Tags: []string{"private-tag"}, ConnectionRevision: 3,
	}
	for _, visitor := range []bool{false, true} {
		row.executionScope = access.Current(groupContext(t, visitor))
		encoded, err := json.Marshal(row.ToPublic())
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(encoded), "ciphertext") {
			t.Fatal("secret material escaped into public response")
		}
		var result map[string]any
		if err := json.Unmarshal(encoded, &result); err != nil {
			t.Fatal(err)
		}
		for _, field := range []string{"auth_method", "connection_revision", "ssh_key_id", "has_password", "has_private_key", "group_id", "tags", "description", "created_at"} {
			_, present := result[field]
			if present == visitor {
				t.Fatalf("field %s visibility incorrect for visitor=%v: %s", field, visitor, encoded)
			}
		}
		if !visitor && (result["ssh_key_id"] != keyID.String() || result["has_password"] != true || result["has_private_key"] != true) {
			t.Fatalf("key reference or availability lost: %s", encoded)
		}
	}
}

func TestServerUpdateKeepsExplicitClearInGeneratedClient(t *testing.T) {
	var request protocol.ServerUpdate
	if err := json.Unmarshal([]byte(`{"password":"","group_id":"","description":"","tags":[],"ssh_key_id":"00000000-0000-0000-0000-000000000000"}`), &request); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var result protocol.ServerUpdate
	if err := json.Unmarshal(encoded, &result); err != nil {
		t.Fatal(err)
	}
	if result.Password == nil || result.GroupID == nil || result.Description == nil || result.Tags == nil || len(*result.Tags) != 0 || result.SSHKeyID == nil || *result.SSHKeyID != uuid.Nil {
		t.Fatalf("explicit clearing became omission: %s", encoded)
	}
}

func TestInvalidServerCreateStopsBeforeRepositoryOrNetwork(t *testing.T) {
	ctx := groupContext(t, false)
	scope := access.Current(ctx)
	service := &serverService{}
	for _, input := range []protocol.ServerCreate{
		{Host: "example.invalid", Username: "owner", Port: -1, AuthMethod: "password"},
		{Host: "example.invalid", Username: "owner", Port: 65536, AuthMethod: "password"},
		{Host: "example.invalid", Username: " ", AuthMethod: "password"},
		{Host: "example.invalid", Username: "owner", AuthMethod: "invalid"},
		{Host: "example.invalid", Username: "owner", AuthMethod: "password", Password: strings.Repeat("x", 4097)},
	} {
		if _, err := service.Create(ctx, scope, &input); !errors.Is(err, ErrInvalidServer) {
			t.Fatalf("invalid input accepted: %v", err)
		}
	}
	if _, err := service.Create(ctx, scope, nil); !errors.Is(err, ErrInvalidServer) {
		t.Fatal(err)
	}
}

func TestServerReorderRejectsDuplicateIdentity(t *testing.T) {
	ctx := groupContext(t, false)
	id := uuid.New()
	service := &serverService{}
	for _, ids := range [][]uuid.UUID{nil, {uuid.Nil}, {id, id}} {
		if err := service.ReorderServers(ctx, access.Current(ctx), ids); !errors.Is(err, ErrInvalidServer) {
			t.Fatalf("invalid order accepted: %v", err)
		}
	}
}
