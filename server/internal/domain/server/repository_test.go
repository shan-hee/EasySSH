package server

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func newServerTestRepository(t *testing.T) (Repository, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := db.AutoMigrate(&Server{}); err != nil {
		t.Fatal(err)
	}
	return NewRepository(db), db
}

func TestPartialReorderPreservesHiddenServers(t *testing.T) {
	repo, db := newServerTestRepository(t)
	ctx := context.Background()
	userID, otherUserID := uuid.New(), uuid.New()
	stamp := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	want := make([]uuid.UUID, 35)
	for i := range want {
		want[i] = uuid.New()
		if err := db.Create(&Server{ID: want[i], UserID: userID, Host: "host", Username: "operator", AuthMethod: AuthMethodPassword, SortOrder: i, CreatedAt: stamp, UpdatedAt: stamp}).Error; err != nil {
			t.Fatal(err)
		}
	}
	foreign := Server{ID: uuid.New(), UserID: otherUserID, Host: "foreign", Username: "operator", AuthMethod: AuthMethodPassword}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	assertOrder := func() {
		t.Helper()
		var ids []uuid.UUID
		for offset := 0; offset < 35; offset += 30 {
			rows, total, err := repo.FindByUserID(ctx, userID, 30, offset)
			if err != nil {
				t.Fatal(err)
			}
			if total != 35 || len(rows) != min(30, 35-offset) {
				t.Fatalf("total=%d length=%d", total, len(rows))
			}
			for _, row := range rows {
				ids = append(ids, row.ID)
				if !row.UpdatedAt.Equal(stamp) {
					t.Fatalf("reorder modified updated_at for %s", row.ID)
				}
			}
		}
		if !slices.Equal(ids, want) {
			t.Fatalf("order=%v, want=%v", ids, want)
		}
	}
	assertOrder()
	if err := repo.Reorder(ctx, userID, []uuid.UUID{want[32], want[1]}); err != nil {
		t.Fatal(err)
	}
	want[1], want[32] = want[32], want[1]
	assertOrder()
	for _, ids := range [][]uuid.UUID{{want[0], want[0]}, {want[0], uuid.New()}, {want[0], foreign.ID}, {uuid.Nil}} {
		if err := repo.Reorder(ctx, userID, ids); err == nil {
			t.Fatalf("accepted invalid reorder %v", ids)
		}
		assertOrder()
	}
}

func TestServerSearchAndStatisticsIncludeAllPages(t *testing.T) {
	repo, db := newServerTestRepository(t)
	ctx := context.Background()
	userID := uuid.New()
	rows := make([]Server, 1001)
	for i := range rows {
		group := "first"
		if i >= 990 {
			group = "later"
		}
		rows[i] = Server{ID: uuid.New(), UserID: userID, Host: "host", Username: "operator", Group: group, Tags: []string{"tag"}, AuthMethod: AuthMethodPassword, SortOrder: i}
	}
	rows[1000].Status = StatusOnline
	if err := db.CreateInBatches(rows, 100).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&Server{UserID: uuid.New(), Host: "foreign", Username: "operator", Group: "later", Tags: []string{"foreign"}, AuthMethod: AuthMethodPassword}).Error; err != nil {
		t.Fatal(err)
	}
	stats, err := repo.GetStatistics(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Total != 1001 || stats.Online != 1 || stats.Offline != 1000 || stats.ByGroup["later"] != 11 || stats.ByTag["tag"] != 1001 || stats.ByTag["foreign"] != 0 {
		t.Fatalf("incorrect statistics: %+v", stats)
	}
	for page := 0; page < 3; page++ {
		found, total, err := repo.Search(ctx, userID, "OPERATOR", "later", 6, page*6)
		if err != nil {
			t.Fatal(err)
		}
		if total != 11 || len(found) != min(6, max(0, 11-page*6)) {
			t.Fatalf("page %d: total=%d length=%d", page, total, len(found))
		}
		for i, row := range found {
			if row.ID != rows[990+page*6+i].ID {
				t.Fatalf("unexpected search result %s", row.ID)
			}
		}
	}
}

func TestCreatedServersAppendAfterExistingAndManualOrder(t *testing.T) {
	repo, db := newServerTestRepository(t)
	ctx := context.Background()
	userID := uuid.New()
	stamp := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	// Existing records can share the default sort order; creation time breaks ties.
	older := Server{ID: uuid.New(), UserID: userID, Host: "host", Username: "operator", Group: "group", AuthMethod: AuthMethodPassword, CreatedAt: stamp}
	newer := older
	newer.ID, newer.CreatedAt = uuid.New(), stamp.Add(time.Hour)
	for _, row := range []*Server{&newer, &older} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	foreign := Server{UserID: uuid.New(), Host: "foreign", Username: "operator", AuthMethod: AuthMethodPassword, SortOrder: 100}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	want := []uuid.UUID{older.ID, newer.ID}
	assertOrder := func() {
		t.Helper()
		queries := map[string]func(int) ([]*Server, int64, error){
			"list":  func(offset int) ([]*Server, int64, error) { return repo.FindByUserID(ctx, userID, 1, offset) },
			"group": func(offset int) ([]*Server, int64, error) { return repo.FindByGroup(ctx, userID, "group", 1, offset) },
			"search": func(offset int) ([]*Server, int64, error) {
				return repo.Search(ctx, userID, "operator", "group", 1, offset)
			},
		}
		for name, query := range queries {
			for index, id := range want {
				rows, total, err := query(index)
				if err != nil {
					t.Fatal(err)
				}
				if total != int64(len(want)) || len(rows) != 1 || rows[0].ID != id {
					t.Fatalf("%s page %d: unexpected order or total: %v, %d", name, index, rows, total)
				}
			}
		}
	}
	assertOrder()
	appendServer := func(wantSortOrder int) {
		t.Helper()
		row := &Server{UserID: userID, Host: "host", Username: "operator", Group: "group", AuthMethod: AuthMethodPassword}
		if err := repo.Create(ctx, row); err != nil {
			t.Fatal(err)
		}
		if row.SortOrder != wantSortOrder {
			t.Fatalf("sort_order=%d, want %d", row.SortOrder, wantSortOrder)
		}
		want = append(want, row.ID)
		assertOrder()
	}
	appendServer(1)
	if err := repo.Reorder(ctx, userID, []uuid.UUID{newer.ID, older.ID}); err != nil {
		t.Fatal(err)
	}
	want[0], want[1] = want[1], want[0]
	assertOrder()
	appendServer(3)
}
