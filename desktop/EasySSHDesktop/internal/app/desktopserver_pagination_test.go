package app

import (
	"context"
	"database/sql"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestDesktopServerPaginationReorderAndStatistics(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "servers.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := configureDesktopDatabase(db); err != nil {
		t.Fatal(err)
	}
	firstID, laterID := uuid.NewString(), uuid.NewString()
	for id, name := range map[string]string{firstID: "first", laterID: "later"} {
		if _, err := db.Exec("INSERT INTO desktop_server_groups(id,name) VALUES(?,?)", id, name); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec("INSERT INTO desktop_tags(name) VALUES('tag')"); err != nil {
		t.Fatal(err)
	}
	wantIDs := make([]string, 35)
	for i := range wantIDs {
		wantIDs[i] = uuid.NewString()
		group := firstID
		if i >= 30 {
			group = laterID
		}
		_, err := db.Exec(`INSERT INTO desktop_servers (id,host,username,group_id,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`, wantIDs[i], "host", "operator", group, i, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec("INSERT INTO desktop_server_tags(server_id,tag_name) VALUES(?,'tag')", wantIDs[i]); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec("INSERT INTO desktop_server_auth(server_id,auth_method) VALUES(?,'password')", wantIDs[i]); err != nil {
			t.Fatal(err)
		}
	}
	activity := &ActivityLogService{db: db}
	service := &DesktopServerService{db: db, activity: activity}
	assertOrder := func() {
		t.Helper()
		var ids []string
		for page := 1; page <= 2; page++ {
			result, err := service.List(protocol.ServerListRequest{Page: page, Limit: 30})
			if err != nil {
				t.Fatal(err)
			}
			if result.Total != 35 || len(result.Data) != min(30, 35-(page-1)*30) {
				t.Fatalf("unexpected page: %+v", result)
			}
			for _, server := range result.Data {
				ids = append(ids, server.ID.String())
			}
		}
		if !slices.Equal(ids, wantIDs) {
			t.Fatalf("order=%v, want=%v", ids, wantIDs)
		}
	}
	assertOrder()
	if err := service.Reorder(protocol.ServerReorderRequest{ServerIDs: []uuid.UUID{uuid.MustParse(wantIDs[32]), uuid.MustParse(wantIDs[1])}}); err != nil {
		t.Fatal(err)
	}
	wantIDs[1], wantIDs[32] = wantIDs[32], wantIDs[1]
	assertOrder()
	for _, ids := range [][]uuid.UUID{{uuid.MustParse(wantIDs[0]), uuid.MustParse(wantIDs[0])}, {uuid.MustParse(wantIDs[0]), uuid.New()}, {uuid.Nil}} {
		if err := service.Reorder(protocol.ServerReorderRequest{ServerIDs: ids}); err == nil {
			t.Fatalf("accepted invalid reorder %v", ids)
		}
		assertOrder()
	}
	observation, err := activity.beginConnection(context.Background(), DesktopServer{ID: wantIDs[34], Name: "last"})
	if err != nil {
		t.Fatal(err)
	}
	if err = observation.established(); err != nil {
		t.Fatal(err)
	}
	defer observation.finish("success", "closed", time.Time{})
	assertOrder()
	filtered, err := service.List(protocol.ServerListRequest{Search: "OPERATOR", GroupID: laterID, Limit: 30})
	if err != nil {
		t.Fatal(err)
	}
	if filtered.Total != 5 || len(filtered.Data) != 5 {
		t.Fatalf("incorrect filtered result: %+v", filtered)
	}
	stats, err := service.GetStatistics()
	if err != nil {
		t.Fatal(err)
	}
	if stats.Total != 35 || stats.ConnectedServers == nil || *stats.ConnectedServers != 1 || stats.Online != nil || stats.Offline != nil || stats.ByGroup[laterID] != 5 || stats.ByTag["tag"] != 35 {
		t.Fatalf("incorrect statistics: %+v", stats)
	}
}
