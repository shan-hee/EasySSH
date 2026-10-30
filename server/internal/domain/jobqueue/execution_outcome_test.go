package jobqueue

import (
	"context"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type queueEventAuthority struct {
	testutil.AccessPolicy
	runtime *access.Runtime
}

func (a queueEventAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func (a queueEventAuthority) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, requirements ...access.Requirement) (*access.Lease, error) {
	return a.runtime.Reserve(ctx, scope, kind, 10, requirements...)
}

func TestScheduledDispatchFailureSettlesOnlyUnstartedTask(t *testing.T) {
	for _, status := range []taskcenter.Status{taskcenter.StatusQueued, taskcenter.StatusRunning} {
		t.Run(string(status), func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			if err := db.AutoMigrate(&Job{}, &taskcenter.NotificationDelivery{}, &taskcenter.TaskRun{}, &taskcenter.TaskEvent{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
				t.Fatal(err)
			}
			raw, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = raw.Close() })
			ctx := context.Background()
			actor := protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}
			run := taskcenter.TaskRun{Actor: actor, Title: "scheduled", TaskType: "command", SourceType: "scheduled_task", SourceID: uuid.NewString(), Status: status}
			tasks := taskcenter.NewRepository(db, nil)
			if err := tasks.CreateWithEvent(ctx, &run, &taskcenter.TaskEvent{Level: "info", Message: "admitted"}); err != nil {
				t.Fatal(err)
			}
			job := Job{Actor: actor, Kind: "task.execute", SourceType: "task_run", SourceID: run.ID.String(), MaxAttempts: 1}
			runtime := access.NewRuntime()
			defer runtime.Close()
			scope, err := access.NewScope(actor, time.Now().Add(time.Hour), queueEventAuthority{runtime: runtime})
			if err != nil {
				t.Fatal(err)
			}
			hub := realtime.NewHub()
			subscription, err := hub.Subscribe(access.WithScope(ctx, scope))
			if err != nil {
				t.Fatal(err)
			}
			defer subscription.Close()
			queue := NewRepository(db, hub, nil)
			if err := queue.Create(ctx, &job); err != nil {
				t.Fatal(err)
			}
			if _, err := queue.Claim(ctx, "worker", time.Minute); err != nil {
				t.Fatal(err)
			}
			if _, err := queue.MarkRunning(ctx, job.ID, "worker"); err != nil {
				t.Fatal(err)
			}
			if status == taskcenter.StatusQueued {
				if err := db.Exec(`CREATE TRIGGER reject_projection BEFORE UPDATE ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
					t.Fatal(err)
				}
				if changed, err := queue.Reject(ctx, job.ID, "worker", "access revoked"); err == nil || changed {
					t.Fatal("partial projection committed")
				}
				select {
				case event := <-subscription.Events:
					t.Fatal("published rolled back state", event)
				default:
				}
				if err := db.Exec("DROP TRIGGER reject_projection").Error; err != nil {
					t.Fatal(err)
				}
			}
			if changed, err := queue.Reject(ctx, job.ID, "worker", "access revoked"); err != nil || !changed {
				t.Fatalf("reject: %v %v", changed, err)
			}
			expectedEvents := 0
			if status == taskcenter.StatusQueued {
				expectedEvents = 2
			}
			for i := 0; i < expectedEvents; i++ {
				select {
				case event := <-subscription.Events:
					if event.Type != "task.updated" && event.Type != "activity.updated" {
						t.Fatal("unexpected notification", event.Type)
					}
				default:
					t.Fatal("missing committed notification")
				}
			}
			select {
			case event := <-subscription.Events:
				t.Fatal("unobserved execution notification", event)
			default:
			}
			got, err := tasks.GetAny(ctx, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if status == taskcenter.StatusQueued && (got.Status != taskcenter.StatusFailed || got.ErrorCode != "dispatch_failed_before_start") {
				t.Fatalf("unstarted task left active: %+v", got)
			}
			if status == taskcenter.StatusRunning && (got.Status != status || got.FinishedAt != nil) {
				t.Fatalf("execution observation overwritten: %+v", got)
			}
		})
	}
}
