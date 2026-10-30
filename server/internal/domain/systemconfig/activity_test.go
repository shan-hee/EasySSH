package systemconfig

import (
	"context"
	"encoding/json"
	"github.com/easyssh/server/internal/testutil"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type settingsAuthority struct {
	testutil.AccessPolicy
}

func (settingsAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func settingsContext(t *testing.T) context.Context {
	t.Helper()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}, time.Now().Add(time.Hour), settingsAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}

func TestSettingsActivityAtomicityAndFieldScope(t *testing.T) {
	for _, item := range []struct {
		name, field string
		save        func(Repository, context.Context, *SystemConfig) error
		change      func(*SystemConfig)
	}{
		{"basic", "system_name", func(r Repository, ctx context.Context, config *SystemConfig) error { return r.SaveBasic(ctx, config) }, func(config *SystemConfig) { config.SystemName = "Renamed" }},
		{"file_transfer", "skip_excluded_on_upload", func(r Repository, ctx context.Context, config *SystemConfig) error {
			return r.SaveFileTransfer(ctx, config)
		}, func(config *SystemConfig) { config.SkipExcludedOnUpload = false }},
		{"scheduled_tasks", "job_queue_max_concurrency", func(r Repository, ctx context.Context, config *SystemConfig) error {
			return r.SaveScheduledTasks(ctx, config)
		}, func(config *SystemConfig) { config.JobQueueMaxConcurrency = 6 }},
	} {
		t.Run(item.name, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			raw, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			raw.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = raw.Close() })
			if err := db.AutoMigrate(&SystemConfig{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
				t.Fatal(err)
			}
			repo, ctx := NewRepository(db), settingsContext(t)
			before, err := repo.Get(ctx)
			if err != nil {
				t.Fatal(err)
			}
			change := *before
			item.change(&change)
			if err := db.Exec(`CREATE TRIGGER reject_settings_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
				t.Fatal(err)
			}
			if err := item.save(repo, ctx, &change); err == nil || !strings.Contains(err.Error(), "activity unavailable") {
				t.Fatalf("expected activity rejection: %v", err)
			}
			unchanged, err := repo.Get(ctx)
			if err != nil || !reflect.DeepEqual(before, unchanged) {
				t.Fatalf("configuration not rolled back: %v", err)
			}
			if err := db.Exec("DROP TRIGGER reject_settings_activity").Error; err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := item.save(repo, ctx, &change); err != nil {
					t.Fatal(err)
				}
			}
			var facts []operationrecord.OperationRecord
			if err := db.Find(&facts).Error; err != nil || len(facts) != 1 {
				t.Fatalf("settings replay counted: %d %v", len(facts), err)
			}
			fact := facts[0]
			var detail struct {
				ResourceKind  string   `json:"resource_kind"`
				ChangedFields []string `json:"changed_fields"`
			}
			if err := json.Unmarshal([]byte(fact.DetailJSON), &detail); err != nil {
				t.Fatal(err)
			}
			if fact.Actor != access.Current(ctx).Actor() || fact.Action != "system_settings_update" || fact.Source != "manual" || detail.ResourceKind != "system_config" || !reflect.DeepEqual(detail.ChangedFields, []string{item.field}) {
				t.Fatalf("wrong settings activity: %+v", fact)
			}
			if strings.Contains(fact.DetailJSON, "example.test") || strings.Contains(fact.DetailJSON, "192.0.2.1") || strings.Contains(fact.DetailJSON, "Renamed") {
				t.Fatal("settings values copied into activity")
			}
		})
	}
}
