package taskscheduler

import (
	"context"
	"encoding/base64"
	"errors"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/operationrecord"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/taskexecutor"
	"github.com/easyssh/shared/protocol"
	crypto "github.com/easyssh/shared/secretcrypto"
	"slices"
	"testing"

	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type schedulerTestQueue struct{ notifications int }

func (q *schedulerTestQueue) NotifyEnqueued() { q.notifications++ }

func TestSchedulerDispatchIsAtomicAndDeduplicatesRetry(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&security.SecurityConfig{}, &auth.Owner{}, &auth.Session{}, &scheduledtask.ScheduledTask{}, &taskcenter.NotificationDelivery{}, &taskcenter.TaskRun{}, &taskcenter.TaskEvent{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}, &serverdomain.Server{}, &serverdomain.ServerAuth{}, &serverdomain.ServerTag{}, &serverdomain.ServerGroup{}, &jobqueue.Job{}); err != nil {
		t.Fatal(err)
	}

	runtime := access.NewRuntime()
	t.Cleanup(runtime.Close)
	encryptor, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	owners, err := auth.NewService(db, encryptor, runtime)
	if err != nil {
		t.Fatal(err)
	}
	row, err := owners.Initialize(context.Background(), "fixture", "fixture@example.test", "Acceptance-2026-Only9")
	if err != nil {
		t.Fatal(err)
	}
	login, err := owners.Login(context.Background(), protocol.OwnerLoginInput{Email: row.Email, Password: "Acceptance-2026-Only9"}, auth.SessionInfo{})
	if err != nil {
		t.Fatal(err)
	}
	scope, _, err := owners.Authenticate(context.Background(), login.Token, "", false)
	if err != nil {
		t.Fatal(err)
	}
	ctx := access.WithScope(context.Background(), scope)
	ownerID := row.ID
	definition := &scheduledtask.ScheduledTask{
		ID: uuid.New(), OwnerID: ownerID, TaskName: "daily check", TaskType: "command",
		Command: "uptime", ServerIDs: []string{uuid.NewString()}, CronExpression: "0 * * * *", Timezone: "UTC", Enabled: true,
	}
	if err := db.Create(&serverdomain.Server{ID: uuid.MustParse(definition.ServerIDs[0]), Host: "test.invalid", Port: 22, Username: "fixture"}).Error; err != nil {
		t.Fatal(err)
	}
	taskRepo := scheduledtask.NewRepository(db)
	if err := taskRepo.Create(ctx, definition); err != nil {
		t.Fatal(err)
	}
	taskRuns := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
	queue := &schedulerTestQueue{}
	scheduler := NewScheduler(db, taskRepo, queue, taskRuns, owners.OwnerExecutionScope, nil)

	manualRunID, err := scheduler.TriggerTaskManually(ctx, definition.ID)
	if err != nil {
		t.Fatal(err)
	}
	manualRun, err := taskRuns.Get(ctx, manualRunID)
	if err != nil {
		t.Fatal(err)
	}
	if manualRun.Actor.SessionID != "" || manualRun.Actor.ID != ownerID.String() {
		t.Fatal("scheduled execution retained a login or pseudo session")
	}
	if manualRun.Status != taskcenter.StatusQueued {
		t.Fatalf("expected manual run to be visible as queued, got %q", manualRun.Status)
	}
	var job jobqueue.Job
	if err := db.First(&job, "id=?", manualRunID).Error; err != nil {
		t.Fatal(err)
	}
	if job.Actor != manualRun.Actor || job.SourceID != manualRunID.String() || job.MaxAttempts != 1 || queue.notifications != 1 {
		t.Fatal("invalid committed dispatch")
	}

	originalRunID := manualRunID
	if err := taskRuns.Complete(ctx, originalRunID, taskcenter.StatusFailed, "", "remote_exit", "confirmed remote failure", 0, 1); err != nil {
		t.Fatal(err)
	}
	firstRetryID, err := scheduler.RetryTask(ctx, definition.ID, originalRunID, 2)
	if err != nil {
		t.Fatal(err)
	}
	secondRetryID, err := scheduler.RetryTask(ctx, definition.ID, originalRunID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if firstRetryID != secondRetryID {
		t.Fatalf("retry must be idempotent: %s != %s", firstRetryID, secondRetryID)
	}
	if err := taskRuns.Complete(ctx, firstRetryID, taskcenter.StatusUnknown, "", "outcome_unknown", "verify effects", 0, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := scheduler.RetryTask(ctx, definition.ID, firstRetryID, 3); err == nil {
		t.Fatal("scheduler accepted direct retry of an unknown result")
	}
	var retryCount int64
	if err := db.Model(&taskcenter.TaskRun{}).Where("retry_of_id = ? AND attempt = ?", originalRunID, 2).Count(&retryCount).Error; err != nil {
		t.Fatal(err)
	}
	if retryCount != 1 {
		t.Fatalf("expected one retry run, got %d", retryCount)
	}

	// Queue insertion failure rolls back the task, event, and activity together.
	counts := func() []int64 {
		t.Helper()
		result := []int64{}
		for _, table := range []string{"task_runs", "task_events", "operation_records", "job_queue"} {
			var n int64
			if err := db.Table(table).Count(&n).Error; err != nil {
				t.Fatal(err)
			}
			result = append(result, n)
		}
		return result
	}
	before := counts()
	notifications := queue.notifications
	if _, err := db.DB(); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TRIGGER reject_dispatch BEFORE INSERT ON job_queue BEGIN SELECT RAISE(ABORT,'queue unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := scheduler.TriggerTaskManually(ctx, definition.ID); err == nil {
		t.Fatal("queue failure accepted")
	}
	if !slices.Equal(before, counts()) || notifications != queue.notifications {
		t.Fatal("partial dispatch committed or published")
	}
	if err := db.Exec("DROP TRIGGER reject_dispatch").Error; err != nil {
		t.Fatal(err)
	}
	if err := taskRepo.Update(ctx, definition.ID, map[string]any{"command": "different"}); err != nil {
		t.Fatal(err)
	}
	if _, err := scheduler.enqueueTask(ctx, definition, taskexecutor.TriggerManual, nil, 1, ""); !errors.Is(err, access.ErrResourceChanged) {
		t.Fatalf("stale definition accepted: %v", err)
	}
}
