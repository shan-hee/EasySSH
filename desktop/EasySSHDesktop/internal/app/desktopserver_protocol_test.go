package app

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func TestDesktopServerPartialUpdatePreservesSecretsAndClearsExplicitFields(t *testing.T) {
	s := newSSHKeyTestService(t)
	created, err := s.Create(protocol.ServerCreate{
		Name: "original", Host: "example.test", Username: "owner", AuthMethod: "password",
		Password: "stored-secret", Description: "description", Tags: []string{"production"},
	})
	if err != nil {
		t.Fatal(err)
	}
	id := created.ID.String()
	if created.ConnectionRevision == nil || *created.ConnectionRevision != 1 || created.SortOrder == nil || *created.SortOrder != 0 {
		t.Fatalf("creation omitted stored version or order: %+v", created)
	}
	before, err := s.getByIDStored(id)
	if err != nil {
		t.Fatal(err)
	}
	name := "renamed"
	renamed, err := s.Update(id, protocol.ServerUpdate{Name: &name})
	if err != nil {
		t.Fatal(err)
	}
	after, err := s.getByIDStored(id)
	if err != nil || after.Password != before.Password || after.Host != before.Host || after.Description != before.Description || len(after.Tags) != 1 {
		t.Fatalf("partial edit overwrote omitted fields: %+v %v", renamed, err)
	}
	if renamed.ConnectionRevision == nil || *renamed.ConnectionRevision != *created.ConnectionRevision {
		t.Fatal("metadata edit changed connection revision")
	}
	empty, tags := "", []string{}
	cleared, err := s.Update(id, protocol.ServerUpdate{Password: &empty, Description: &empty, Tags: &tags})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.getByIDRaw(id)
	if err != nil || stored.Password != "" || stored.Description != "" || len(stored.Tags) != 0 {
		t.Fatal("explicit clearing did not reach storage", err)
	}
	if cleared.HasPassword == nil || *cleared.HasPassword || cleared.ConnectionRevision == nil || *cleared.ConnectionRevision != *created.ConnectionRevision {
		t.Fatalf("response lost updated credential state or revision: %+v", cleared)
	}
	noChange, err := s.Update(id, protocol.ServerUpdate{})
	if err != nil || noChange.UpdatedAt == nil || !noChange.UpdatedAt.Equal(*cleared.UpdatedAt) || *noChange.ConnectionRevision != *cleared.ConnectionRevision {
		t.Fatalf("empty update changed stored version: %+v %v", noChange, err)
	}
}

func TestDesktopServerPublicProtocolDoesNotExposeCredentialsOrInventHistory(t *testing.T) {
	now, keyID := desktopTaskNow(), uuid.NewString()
	row, err := desktopPublicServer(DesktopServer{
		ID: uuid.NewString(), UserID: "local", Host: "example.test", Username: "owner", Port: 22,
		AuthMethod: DesktopServerAuthKeyPassword, Password: "encrypted-password", PrivateKey: "private-material",
		SavedPrivateKeyPassphrase: "saved-passphrase", SSHKeyID: &keyID, CreatedAt: now, UpdatedAt: now,
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"encrypted-password", "private-material", "saved-passphrase", `"password":`, `"private_key":`, `"user_id":`, `"status":`} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("public response contains forbidden field or secret %q", forbidden)
		}
	}
	if row.Connected == nil || *row.Connected || row.HasPassword == nil || !*row.HasPassword || row.SSHKeyID == nil || row.SSHKeyID.String() != keyID || row.Tags == nil || len(*row.Tags) != 0 {
		t.Fatalf("public availability metadata missing: %+v", row)
	}
}

func TestDesktopServerRejectsInvalidCreateAndPagination(t *testing.T) {
	for _, port := range []int{-1, 65536} {
		s := &DesktopServerService{}
		if _, err := s.Create(protocol.ServerCreate{Host: "host", Username: "owner", AuthMethod: "password", Port: port}); err == nil || s.db != nil {
			t.Fatal("invalid port reached database initialization")
		}
	}
	for _, input := range []protocol.ServerListRequest{{Page: -1}, {Page: 1000001}, {Limit: -1}, {Limit: 101}} {
		if _, err := normalizeDesktopServerListParams(input); err == nil {
			t.Fatal("invalid pagination accepted", input)
		}
	}
	defaults, err := normalizeDesktopServerListParams(protocol.ServerListRequest{})
	if err != nil || defaults.Page != 1 || defaults.Limit != 20 {
		t.Fatal("pagination defaults differ from shared contract")
	}
}
