package script

import (
	"errors"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/recyclebin"
	"github.com/easyssh/server/internal/storage/schema"
	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
	"gorm.io/gorm"
)

func TestDeletedScriptCanBeRestoredFromTheRecycleBin(t *testing.T) {
	db := scriptActivityDB(t)
	ctx := catalogContext(t)
	repo := NewRepository(db)
	original := &Script{Name: "deploy", Content: "echo deploy", Language: "bash", Tags: []string{"ops"}, Executions: 3, Author: "owner"}
	if err := repo.Create(ctx, original); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, original.ID); err != nil {
		t.Fatal(err)
	}
	var remaining int64
	if err := db.Model(&Script{}).Count(&remaining).Error; err != nil || remaining != 0 {
		t.Fatalf("script was not removed: %d %v", remaining, err)
	}
	bin := recyclebin.Service{DB: db, Restorers: map[string]recyclebin.Restorer{recyclebin.KindScript: RestoreArchived}}
	entries, err := bin.List(ctx)
	if err != nil || len(entries) != 1 {
		t.Fatalf("entries: %+v %v", entries, err)
	}
	if _, err = bin.Restore(ctx, entries[0].ID); err != nil {
		t.Fatal(err)
	}
	var restored Script
	if err = db.First(&restored, "id=?", original.ID).Error; err != nil || restored.Content != original.Content || restored.Name != original.Name || len(restored.Tags) != 1 || restored.Executions != 3 || !restored.CreatedAt.Equal(original.CreatedAt) {
		t.Fatalf("script not restored: %+v %v", restored, err)
	}
	if entries, err = bin.List(ctx); err != nil || len(entries) != 0 {
		t.Fatalf("restored entry remained: %+v %v", entries, err)
	}
	if err = repo.Delete(ctx, original.ID); err != nil {
		t.Fatal(err)
	}
	entries, err = bin.List(ctx)
	if err != nil || len(entries) != 1 {
		t.Fatal(entries, err)
	}
	if err = db.Create(&restored).Error; err != nil {
		t.Fatal(err)
	}
	if _, err = bin.Restore(ctx, entries[0].ID); !errors.Is(err, recyclebin.ErrExists) {
		t.Fatalf("restored over existing script: %v", err)
	}
	if _, err = DeleteArchived(db, uuid.New()); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("missing script: %v", err)
	}
}

func TestLegacySoftDeletedScriptCanBeRestoredAfterMigration(t *testing.T) {
	db := catalogDB(t)
	ctx := catalogContext(t)
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	definition, err := schema.Definition("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	provider, err := goose.NewProvider(goose.DialectSQLite3, raw, definition.Files, goose.WithDisableGlobalRegistry(true))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = provider.UpTo(ctx, 6); err != nil {
		t.Fatal(err)
	}
	id, scheduleID, liveID := uuid.New(), uuid.New(), uuid.New()
	created := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	content := "echo \"保留旧脚本\"\n"
	if err = db.Exec(`INSERT INTO scripts(id,version,name,content,language,tags,description,executions,author,created_at,deleted_at) VALUES(?,'v','旧脚本',?,'bash','["运维","prod"]','description',9,'owner',?,?)`, id, content, created, created.Add(time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(`INSERT INTO scripts(id,version,name,content,language) VALUES(?,'v','live','echo live','bash')`, liveID).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(`INSERT INTO scheduled_tasks(id,owner_id,task_name,task_type,script_id,cron_expression,timezone,enabled,next_run_at) VALUES(?,?,'daily','script',?,'0 0 * * *','UTC',true,?)`, scheduleID, uuid.New(), id, time.Now().Add(time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	started := time.Now().UTC().Truncate(time.Second)
	if _, err = provider.UpTo(ctx, 7); err != nil {
		t.Fatal(err)
	}
	bin := recyclebin.Service{DB: db, Restorers: map[string]recyclebin.Restorer{recyclebin.KindScript: RestoreArchived}}
	entries, err := bin.List(ctx)
	if err != nil || len(entries) != 1 || entries[0].ResourceID != id.String() || entries[0].RemovedAt.Before(started) {
		t.Fatalf("legacy script not retained for a fresh retention period: %+v %v", entries, err)
	}
	if _, err = bin.Restore(ctx, entries[0].ID); err != nil {
		t.Fatal(err)
	}
	var restored Script
	if err = db.First(&restored, "id=?", id).Error; err != nil {
		t.Fatal(err)
	}
	if restored.Content != content || restored.Description != "description" || restored.Executions != 9 || restored.Author != "owner" || !restored.CreatedAt.Equal(created) || len(restored.Tags) != 2 || restored.Tags[0] != "运维" {
		t.Fatalf("legacy fields lost: %+v", restored)
	}
	var schedule struct {
		Enabled   bool
		NextRunAt *time.Time
	}
	if err = db.Table("scheduled_tasks").Where("id=?", scheduleID).Take(&schedule).Error; err != nil || schedule.Enabled || schedule.NextRunAt != nil {
		t.Fatalf("legacy schedule resumed: %+v %v", schedule, err)
	}
	var live int64
	if err = db.Model(&Script{}).Where("id=?", liveID).Count(&live).Error; err != nil || live != 1 {
		t.Fatal("live script lost", live, err)
	}
	if _, err = provider.DownTo(ctx, 6); err != nil {
		t.Fatal(err)
	}
	if err = schema.CheckUpgradeSource(ctx, raw, "sqlite", 6); err != nil {
		t.Fatal(err)
	}
}

func TestScriptDeletionDisablesOnlyItsSchedulesAndRestoreKeepsThemDisabled(t *testing.T) {
	db := scriptActivityDB(t)
	ctx := catalogContext(t)
	repo := NewRepository(db)
	row := &Script{Name: "scheduled", Language: "bash", Content: "echo original"}
	if err := repo.Create(ctx, row); err != nil {
		t.Fatal(err)
	}
	taskID, otherID := uuid.New(), uuid.New()
	for _, item := range []struct{ id, script uuid.UUID }{{taskID, row.ID}, {otherID, uuid.New()}} {
		if err := db.Exec(`INSERT INTO scheduled_tasks(id,owner_id,task_name,task_type,script_id,cron_expression,timezone,enabled,next_run_at,payload_json) VALUES(?,?,'daily','script',?,'0 0 * * *','UTC',true,?,?)`, item.id, uuid.New(), item.script, time.Now().Add(time.Hour), `{"script_version":"`+row.Version+`"}`).Error; err != nil {
			t.Fatal(err)
		}
	}
	// A failed enclosing transaction must leave both the script and schedule intact.
	rollback := errors.New("rollback deletion")
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := DeleteArchived(tx, row.ID); err != nil {
			return err
		}
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
	assertSchedule := func(id uuid.UUID, want bool) {
		t.Helper()
		var schedule struct {
			Enabled   bool
			NextRunAt *time.Time
		}
		if err := db.Table("scheduled_tasks").Where("id=?", id).Take(&schedule).Error; err != nil {
			t.Fatal(err)
		}
		if schedule.Enabled != want || (schedule.NextRunAt != nil) != want {
			t.Fatalf("schedule=%+v want enabled=%v", schedule, want)
		}
	}
	assertSchedule(taskID, true)
	if err = repo.Delete(ctx, row.ID); err != nil {
		t.Fatal(err)
	}
	assertSchedule(taskID, false)
	assertSchedule(otherID, true)
	bin := recyclebin.Service{DB: db, Restorers: map[string]recyclebin.Restorer{recyclebin.KindScript: RestoreArchived}}
	entries, err := bin.List(ctx)
	if err != nil || len(entries) != 1 {
		t.Fatal(entries, err)
	}
	if _, err = bin.Restore(ctx, entries[0].ID); err != nil {
		t.Fatal(err)
	}
	assertSchedule(taskID, false)
	assertSchedule(otherID, true)
}
