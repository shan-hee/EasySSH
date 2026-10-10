package main

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"slices"
	"testing"
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
	wantIDs := make([]string, 35)
	for i := range wantIDs {
		wantIDs[i] = fmt.Sprintf("server-%02d", i)
		group := "first"
		if i >= 30 {
			group = "later"
		}
		_, err := db.Exec(`INSERT INTO desktop_servers (id,host,username,server_group,tags_json,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`, wantIDs[i], "host", "operator", group, `["tag"]`, i, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z")
		if err != nil {
			t.Fatal(err)
		}
	}
	service := &DesktopServerService{db: db}
	assertOrder := func() {
		t.Helper()
		var ids []string
		for page := 1; page <= 2; page++ {
			result, err := service.List(DesktopServerListParams{Page: page, Limit: 30})
			if err != nil {
				t.Fatal(err)
			}
			if result.Total != 35 || len(result.Data) != min(30, 35-(page-1)*30) {
				t.Fatalf("unexpected page: %+v", result)
			}
			for _, server := range result.Data {
				ids = append(ids, server.ID)
			}
		}
		if !slices.Equal(ids, wantIDs) {
			t.Fatalf("order=%v, want=%v", ids, wantIDs)
		}
	}
	assertOrder()
	if err := service.Reorder([]string{wantIDs[32], wantIDs[1]}); err != nil {
		t.Fatal(err)
	}
	wantIDs[1], wantIDs[32] = wantIDs[32], wantIDs[1]
	assertOrder()
	for _, ids := range [][]string{{wantIDs[0], wantIDs[0]}, {wantIDs[0], "missing"}, {""}} {
		if err := service.Reorder(ids); err == nil {
			t.Fatalf("accepted invalid reorder %v", ids)
		}
		assertOrder()
	}
	if _, err := service.MarkConnected(wantIDs[34]); err != nil {
		t.Fatal(err)
	}
	assertOrder()
	filtered, err := service.List(DesktopServerListParams{Search: "OPERATOR", Group: "later", Limit: 30})
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
	if stats["total"] != 35 || stats["online"] != 1 || stats["by_group"].(map[string]int)["later"] != 5 || stats["by_tag"].(map[string]int)["tag"] != 35 {
		t.Fatalf("incorrect statistics: %+v", stats)
	}
}
