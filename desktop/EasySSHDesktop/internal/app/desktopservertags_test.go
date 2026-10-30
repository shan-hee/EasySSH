package app

import (
	"github.com/easyssh/shared/protocol"
	"slices"
	"testing"
)

func TestDesktopServerTagsRelationsSearchAndRollback(t *testing.T) {
	s := newSSHKeyTestService(t)
	row, err := s.Create(protocol.ServerCreate{AuthMethod: protocol.ServerAuthMethod("password"), Host: "host.test", Username: "owner", Tags: []string{" web ", "prod", "web"}})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.getByIDStored(row.ID.String())
	if err != nil || !slices.Equal(got.Tags, []string{"prod", "web"}) {
		t.Fatalf("labels: %+v %v", got, err)
	}
	page, err := s.List(protocol.ServerListRequest{Search: "prod", Page: 1, Limit: 20})
	if err != nil || page.Total != 1 {
		t.Fatalf("relation search: %+v %v", page, err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_tag_update BEFORE INSERT ON desktop_configuration_events WHEN NEW.action='server_updated' BEGIN SELECT RAISE(ABORT,'record unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(row.ID.String(), protocol.ServerUpdate{Tags: &[]string{"replacement"}}); err == nil {
		t.Fatal("update committed without activity")
	}
	got, err = s.getByIDStored(row.ID.String())
	if err != nil || !slices.Equal(got.Tags, []string{"prod", "web"}) {
		t.Fatal("failed update changed tags", err)
	}
	if err := s.Delete(row.ID.String()); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM desktop_server_tags").Scan(&count); err != nil || count != 0 {
		t.Fatal("orphan links", count, err)
	}
}
