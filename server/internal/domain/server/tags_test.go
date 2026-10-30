package server

import (
	"errors"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"slices"
	"testing"
)

func TestServerTagsAreUniqueRelationsAndTransactional(t *testing.T) {
	repo, db := newServerTestRepository(t)
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	raw.SetMaxOpenConns(1)
	if err := db.Exec("PRAGMA foreign_keys=ON").Error; err != nil {
		t.Fatal(err)
	}
	ctx := groupContext(t, false)
	row := &Server{ID: uuid.New(), Host: "host.test", Username: "owner", Tags: []string{" prod ", "web", "prod"}, Auth: ServerAuth{AuthMethod: AuthMethodPassword}}
	if err := repo.Create(ctx, row); err != nil {
		t.Fatal(err)
	}
	got, err := repo.FindByID(ctx, row.ID)
	if err != nil || !slices.Equal(got.Tags, []string{"prod", "web"}) {
		t.Fatalf("labels: %+v %v", got, err)
	}
	var count int64
	if err := db.Model(&ServerTag{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatal("duplicate links", count, err)
	}
	if err := db.Create(&ServerTag{ServerID: row.ID, TagName: "missing"}).Error; err == nil {
		t.Fatal("dangling label accepted")
	}
	failed := errors.New("later write failed")
	err = db.Transaction(func(tx *gorm.DB) error {
		got.Tags = []string{"replacement"}
		if err := got.SaveTags(tx); err != nil {
			return err
		}
		return failed
	})
	if !errors.Is(err, failed) {
		t.Fatal(err)
	}
	got, err = repo.FindByID(ctx, row.ID)
	if err != nil || !slices.Equal(got.Tags, []string{"prod", "web"}) {
		t.Fatal("rollback lost relations", err)
	}
	matches, total, err := repo.Query(ctx, Query{Search: "prod"}, 20, 0)
	if err != nil || total != 1 || len(matches) != 1 {
		t.Fatal("relation search failed", err)
	}
	if err := repo.Delete(ctx, row.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&ServerTag{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("orphan links", count, err)
	}
}
