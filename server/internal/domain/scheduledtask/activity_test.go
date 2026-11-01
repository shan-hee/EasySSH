package scheduledtask

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/protocol"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func scheduleActivityFixture(t *testing.T) (*gorm.DB, context.Context, *ScheduledTask) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { raw.Close() })
	if err := db.AutoMigrate(&ScheduledTask{}, &serverdomain.Server{}, &serverdomain.ServerAuth{}, &serverdomain.ServerTag{}, &serverdomain.ServerGroup{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	ctx := scheduledProtocolContext(t)
	server := serverdomain.Server{ID: uuid.New(), Name: "schedule target", Host: "host.test", Username: "owner"}
	if err := db.Create(&server).Error; err != nil {
		t.Fatal(err)
	}
	return db, ctx, &ScheduledTask{ID: uuid.New(), OwnerID: uuid.MustParse(access.Current(ctx).Actor().ID), TaskName: "before", TaskType: "command", Command: "echo private-command-value", ServerIDs: []string{server.ID.String()}, CronExpression: "0 * * * *", Timezone: "UTC", Enabled: true}
}

func TestScheduledRuntimeAndNoOpDoNotCreateConfigurationActivity(t *testing.T) {
	db, ctx, task := scheduleActivityFixture(t)
	repo := NewRepository(db)
	if err := repo.Create(ctx, task); err != nil {
		t.Fatal(err)
	}
	if err := repo.Update(ctx, task.ID, map[string]interface{}{"task_name": task.TaskName, "enabled": task.Enabled, "server_ids": task.ServerIDs}); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateRuntime(context.Background(), task.ID, map[string]interface{}{"next_run_at": time.Now(), "run_count": 1}); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateRuntime(context.Background(), task.ID, map[string]interface{}{"enabled": false}); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("runtime path accepted definition change: %v", err)
	}
	if err := repo.Update(ctx, task.ID, map[string]interface{}{"enabled": false}); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, task.ID); err != nil {
		t.Fatal(err)
	}
	var facts []operationrecord.OperationRecord
	if err := db.Find(&facts).Error; err != nil || len(facts) != 3 {
		t.Fatalf("runtime/no-op inflated work: %d %v", len(facts), err)
	}
	for _, fact := range facts {
		if fact.Actor != access.Current(ctx).Actor() || strings.Contains(fact.DetailJSON, task.Command) {
			t.Fatal("invalid scheduled activity attribution or content")
		}
		var resource operationrecord.Resource
		if err := db.First(&resource, "record_id=? AND server_id=?", fact.ID, task.ServerIDs[0]).Error; err != nil || resource.Name != "schedule target" {
			t.Fatalf("lost scheduled target: %+v %v", resource, err)
		}
	}
}

func TestScheduledMutationsRollBackWithActivity(t *testing.T) {
	for _, action := range []string{"create", "update", "toggle", "delete"} {
		t.Run(action, func(t *testing.T) {
			db, ctx, task := scheduleActivityFixture(t)
			repo := NewRepository(db)
			if err := repo.Create(ctx, task); err != nil {
				t.Fatal(err)
			}
			var before []ScheduledTask
			if err := db.Order("id").Find(&before).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec(`CREATE TRIGGER reject_schedule_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
				t.Fatal(err)
			}
			var err error
			switch action {
			case "create":
				next := *task
				next.ID = uuid.New()
				err = repo.Create(ctx, &next)
			case "update":
				err = repo.Update(ctx, task.ID, map[string]interface{}{"command": "after", "task_name": "after", "server_ids": []string{uuid.NewString()}})
			case "toggle":
				err = repo.Update(ctx, task.ID, map[string]interface{}{"enabled": false})
			case "delete":
				err = repo.Delete(ctx, task.ID)
			}
			if err == nil {
				t.Fatal("definition committed without activity")
			}
			var after []ScheduledTask
			if err := db.Order("id").Find(&after).Error; err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) {
				t.Fatal("definition mutation did not roll back")
			}
		})
	}
}

func TestScheduledTargetReplacementRetainsBothResourceSnapshots(t *testing.T) {
	db, ctx, task := scheduleActivityFixture(t)
	repo := NewRepository(db)
	if err := repo.Create(ctx, task); err != nil {
		t.Fatal(err)
	}
	next := serverdomain.Server{ID: uuid.New(), Name: "download target", Host: "host.test", Username: "owner"}
	if err := db.Create(&next).Error; err != nil {
		t.Fatal(err)
	}
	svc := NewService(repo, nil)
	if _, err := svc.UpdateScheduledTask(ctx, task.ID, &protocol.UpdateScheduledTaskRequest{
		TaskType: "sftp_download", PayloadJSON: `{"server_id":"` + next.ID.String() + `","remote_path":"/private-path"}`,
	}); err != nil {
		t.Fatal(err)
	}
	var fact operationrecord.OperationRecord
	if err := db.First(&fact, "action=?", "scheduled_task_update").Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(fact.DetailJSON, "/private-path") {
		t.Fatal("payload values entered activity")
	}
	var resources []operationrecord.Resource
	if err := db.Where("record_id=?", fact.ID).Find(&resources).Error; err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, resource := range resources {
		got[resource.ServerID.String()] = resource.Name
	}
	if !reflect.DeepEqual(got, map[string]string{task.ServerIDs[0]: "schedule target", next.ID.String(): next.Name}) {
		t.Fatalf("target replacement lost resource attribution: %+v", got)
	}
}

type removedTaskScheduler struct {
	TaskScheduler
	removed []uuid.UUID
}

func (s *removedTaskScheduler) RemoveTask(id uuid.UUID) { s.removed = append(s.removed, id) }

func TestDeleteKeepsSchedulerActiveUntilDatabaseCommit(t *testing.T) {
	db, ctx, task := scheduleActivityFixture(t)
	repo := NewRepository(db)
	if err := repo.Create(ctx, task); err != nil {
		t.Fatal(err)
	}
	scheduler := &removedTaskScheduler{}
	svc := NewService(repo, nil)
	svc.SetScheduler(scheduler)
	if err := db.Exec(`CREATE TRIGGER reject_delete_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteScheduledTask(ctx, task.ID); err == nil || len(scheduler.removed) != 0 {
		t.Fatal("failed deletion removed live schedule", err)
	}
	if err := db.Exec("DROP TRIGGER reject_delete_activity").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteScheduledTask(ctx, task.ID); err != nil || !reflect.DeepEqual(scheduler.removed, []uuid.UUID{task.ID}) {
		t.Fatalf("committed deletion did not remove schedule: %v %v", scheduler.removed, err)
	}
}
