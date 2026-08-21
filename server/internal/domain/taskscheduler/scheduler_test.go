package taskscheduler

import (
	"context"
	"testing"

	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type schedulerTestQueue struct {
	t        *testing.T
	taskRuns taskcenter.Service
	userID   uuid.UUID
	jobs     map[string]*jobqueue.Job
}

func (q *schedulerTestQueue) Enqueue(ctx context.Context, kind, sourceType, sourceID string, payload interface{}, options jobqueue.EnqueueOptions) (*jobqueue.Job, error) {
	q.t.Helper()
	if sourceType != "task_run" {
		q.t.Fatalf("expected task_run source, got %q", sourceType)
	}
	runID, err := uuid.Parse(sourceID)
	if err != nil {
		q.t.Fatalf("invalid task run source id: %v", err)
	}
	run, err := q.taskRuns.Get(ctx, q.userID, runID)
	if err != nil {
		q.t.Fatalf("task run must exist before enqueue: %v", err)
	}
	if run.Status != taskcenter.StatusQueued {
		q.t.Fatalf("expected queued task run before enqueue, got %q", run.Status)
	}
	key := options.DedupeKey
	if key == "" {
		key = uuid.NewString()
	}
	if existing := q.jobs[key]; existing != nil {
		return existing, nil
	}
	job := &jobqueue.Job{ID: uuid.New(), Kind: kind, SourceType: sourceType, SourceID: sourceID}
	q.jobs[key] = job
	return job, nil
}

func (q *schedulerTestQueue) CancelBySource(context.Context, string, string) error { return nil }

func TestSchedulerCreatesRunBeforeEnqueueAndDeduplicatesRetry(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&scheduledtask.ScheduledTask{}, &taskcenter.TaskRun{}, &taskcenter.TaskEvent{}); err != nil {
		t.Fatal(err)
	}

	userID := uuid.New()
	definition := &scheduledtask.ScheduledTask{
		ID: uuid.New(), UserID: userID, TaskName: "daily check", TaskType: "command",
		Command: "uptime", ServerIDs: []string{uuid.NewString()}, CronExpression: "0 * * * *", Timezone: "UTC", Enabled: true,
	}
	taskRepo := scheduledtask.NewRepository(db)
	if err := taskRepo.Create(definition); err != nil {
		t.Fatal(err)
	}
	taskRuns := taskcenter.NewService(taskcenter.NewRepository(db), nil)
	queue := &schedulerTestQueue{t: t, taskRuns: taskRuns, userID: userID, jobs: make(map[string]*jobqueue.Job)}
	scheduler := NewScheduler(taskRepo, queue, taskRuns)

	manualRunID, err := scheduler.TriggerTaskManually(definition.ID)
	if err != nil {
		t.Fatal(err)
	}
	manualRun, err := taskRuns.Get(context.Background(), userID, manualRunID)
	if err != nil {
		t.Fatal(err)
	}
	if manualRun.Status != taskcenter.StatusQueued {
		t.Fatalf("expected manual run to be visible as queued, got %q", manualRun.Status)
	}
	if len(queue.jobs) != 1 {
		t.Fatalf("expected one persisted queue job, got %d", len(queue.jobs))
	}

	originalRunID := uuid.New()
	firstRetryID, err := scheduler.RetryTask(definition.ID, originalRunID, 2)
	if err != nil {
		t.Fatal(err)
	}
	secondRetryID, err := scheduler.RetryTask(definition.ID, originalRunID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if firstRetryID != secondRetryID {
		t.Fatalf("retry must be idempotent: %s != %s", firstRetryID, secondRetryID)
	}
	var retryCount int64
	if err := db.Model(&taskcenter.TaskRun{}).Where("retry_of_id = ? AND attempt = ?", originalRunID, 2).Count(&retryCount).Error; err != nil {
		t.Fatal(err)
	}
	if retryCount != 1 {
		t.Fatalf("expected one retry run, got %d", retryCount)
	}

	orphanRun := &taskcenter.TaskRun{
		UserID: userID, DefinitionID: &definition.ID, SourceType: "scheduled_task", SourceID: definition.ID.String(),
		TaskType: "command", Title: "orphan", TriggerType: taskcenter.TriggerManual, Status: taskcenter.StatusQueued,
	}
	if err := taskRuns.Create(context.Background(), orphanRun); err != nil {
		t.Fatal(err)
	}
	if err := scheduler.recoverQueuedRuns(); err != nil {
		t.Fatal(err)
	}
	if _, exists := queue.jobs[taskRunDedupeKey(orphanRun.ID)]; !exists {
		t.Fatal("queued orphan task run was not restored to the durable queue")
	}
}
