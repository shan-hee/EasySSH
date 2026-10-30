package taskcenter

import (
	"context"
	"encoding/json"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/taskprotocol"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type successfulCanceler struct {
	calledWith uuid.UUID
}

func (c *successfulCanceler) CancelTask(_ context.Context, id uuid.UUID) error {
	c.calledWith = id
	return nil
}

func newTaskCenterTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&NotificationDelivery{}, &TaskRun{}, &TaskEvent{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}, &serverdomain.Server{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestRepositoryStatisticsAndListSummary(t *testing.T) {
	db := newTaskCenterTestDB(t)
	repo := NewRepository(db, nil)
	ctx, actor := taskTestContext(t)
	_, otherActor := taskTestContext(t)
	runs := []*TaskRun{
		{Actor: actor, TaskType: "command", Title: "queued", Status: StatusQueued, PayloadJSON: `{"secret":true}`, ResultJSON: `{"output":"large"}`, ProgressJSON: `{"step":1}`},
		{Actor: actor, TaskType: "command", Title: "running", Status: StatusRunning},
		{Actor: actor, TaskType: "command", Title: "failed", Status: StatusFailed},
		{Actor: otherActor, TaskType: "command", Title: "other", Status: StatusSucceeded},
	}
	for _, run := range runs {
		if err := db.Create(run).Error; err != nil {
			t.Fatal(err)
		}
	}
	stats, err := repo.Statistics(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Total != 3 || stats.Queued != 1 || stats.Running != 1 || stats.Failed != 1 {
		t.Fatalf("unexpected statistics: %+v", stats)
	}
	result, err := repo.List(ctx, &ListRequest{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"payload_json", "result_json", "progress_json"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("list response contains detail field %q: %s", forbidden, raw)
		}
	}
}

func TestQueuedTaskCancellationCompletesImmediately(t *testing.T) {
	db := newTaskCenterTestDB(t)
	service := NewService(NewRepository(db, nil), nil)
	ctx, actor := taskTestContext(t)
	run := &TaskRun{Actor: actor, TaskType: "command", Title: "queued", Status: StatusQueued, Cancelable: true}
	if err := service.Create(ctx, run); err != nil {
		t.Fatal(err)
	}
	canceler := &successfulCanceler{}
	service.SetCanceler(canceler)
	if err := service.RequestCancel(ctx, run.ID); err != nil {
		t.Fatal(err)
	}
	updated, err := service.Get(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != StatusCanceled {
		t.Fatalf("expected canceled status, got %q", updated.Status)
	}
	if canceler.calledWith != run.ID {
		t.Fatalf("canceler received %s, expected %s", canceler.calledWith, run.ID)
	}
}

func TestRecoverInterruptedDoesNotReplayRunningCommands(t *testing.T) {
	db := newTaskCenterTestDB(t)
	service := NewService(NewRepository(db, nil), nil)
	ctx, actor := taskTestContext(t)
	running := &TaskRun{
		Actor: actor, TaskType: "command", Title: "running", SourceType: "scheduled_task", Status: StatusRunning,
	}
	queued := &TaskRun{
		Actor: actor, TaskType: "command", Title: "queued", SourceType: "scheduled_task", Status: StatusQueued,
	}
	if err := db.Create(running).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(queued).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.RecoverInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	recoveredRunning, err := service.Get(ctx, running.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recoveredRunning.Status != StatusUnknown || recoveredRunning.ErrorCode != "server_restarted" {
		t.Fatalf("running command must retain unknown effects without replay: %+v", recoveredRunning)
	}
	recoveredQueued, err := service.Get(ctx, queued.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recoveredQueued.Status != StatusQueued {
		t.Fatalf("queued command must remain recoverable, got %q", recoveredQueued.Status)
	}
}

type taskTestAuthorizer struct {
	testutil.AccessPolicy
}

func (taskTestAuthorizer) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func taskTestContext(t *testing.T) (context.Context, protocol.Actor) {
	t.Helper()
	id := uuid.NewString()
	actor := protocol.Actor{Kind: protocol.Visitor, ID: id, SessionID: id, GrantID: uuid.NewString()}
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), taskTestAuthorizer{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope), actor
}

func TestUnknownTaskIsTerminalWithoutFailureOrRetry(t *testing.T) {
	db := newTaskCenterTestDB(t)
	service := NewService(NewRepository(db, nil), nil)
	ctx, actor := taskTestContext(t)
	run := &TaskRun{Actor: actor, TaskType: "command", Title: "unknown command", Status: StatusRunning, Cancelable: true, Retryable: true}
	if err := service.Create(ctx, run); err != nil {
		t.Fatal(err)
	}
	if err := service.Complete(ctx, run.ID, StatusUnknown, "[]", "outcome_unknown", "verify remote effects", 1, 0); err != nil {
		t.Fatal(err)
	}
	got, err := service.Get(ctx, run.ID)
	if err != nil || got.Status != StatusUnknown || got.Retryable || got.Cancelable || got.FinishedAt == nil || got.FailureCount != 0 {
		t.Fatalf("unknown became failure or retryable: %+v %v", got, err)
	}
	stats, err := service.Statistics(ctx)
	if err != nil || stats.Unknown != 1 || stats.Failed != 0 {
		t.Fatalf("unknown miscounted: %+v %v", stats, err)
	}
	var activity operationrecord.OperationRecord
	if err := db.Where("source_table=? AND source_id=?", "task_runs", run.ID.String()).First(&activity).Error; err != nil {
		t.Fatal(err)
	}
	if activity.Status != operationrecord.StatusUnknown {
		t.Fatalf("unknown projection lost: %+v", activity)
	}
	if err := service.Complete(ctx, run.ID, StatusFailed, "", "late_cancel", "", 0, 1); err != nil {
		t.Fatal(err)
	}
	got, err = service.Get(ctx, run.ID)
	if err != nil || got.Status != StatusUnknown {
		t.Fatal("late completion rewrote a terminal unknown")
	}
}

func TestTaskEventCursorIsOrderedBoundedAndScoped(t *testing.T) {
	db := newTaskCenterTestDB(t)
	repo := NewRepository(db, nil)
	ctx, actor := taskTestContext(t)
	otherCtx, _ := taskTestContext(t)
	run := TaskRun{Actor: actor, TaskType: "command", Title: "events"}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	var ids []uint
	for i := 0; i < 5; i++ {
		// Clocks can move backwards; insertion IDs, not timestamps, drive cursors.
		event := TaskEvent{TaskRunID: run.ID, Level: "info", Message: "observed", CreatedAt: now.Add(-time.Duration(i) * time.Second)}
		if err := db.Create(&event).Error; err != nil {
			t.Fatal(err)
		}
		ids = append(ids, event.ID)
	}
	first, err := repo.ListEvents(ctx, run.ID, protocol.TaskEventInput{Limit: 2})
	if err != nil || len(first.Events) != 2 || !first.HasMore || first.NextAfterID != ids[1] || first.Events[0].ID != ids[0] {
		t.Fatalf("first page: %+v %v", first, err)
	}
	second, err := repo.ListEvents(ctx, run.ID, protocol.TaskEventInput{AfterID: first.NextAfterID, Limit: 2})
	if err != nil || len(second.Events) != 2 || second.Events[0].ID != ids[2] || !second.HasMore {
		t.Fatalf("second page: %+v %v", second, err)
	}
	last, err := repo.ListEvents(ctx, run.ID, protocol.TaskEventInput{AfterID: second.NextAfterID, Limit: 2})
	if err != nil || len(last.Events) != 1 || last.HasMore || last.NextAfterID != ids[4] {
		t.Fatalf("last page: %+v %v", last, err)
	}
	empty, err := repo.ListEvents(ctx, run.ID, protocol.TaskEventInput{AfterID: last.NextAfterID, Limit: 2})
	if err != nil || len(empty.Events) != 0 || empty.HasMore || empty.NextAfterID != last.NextAfterID {
		t.Fatalf("empty page: %+v %v", empty, err)
	}
	if page, err := repo.ListEvents(otherCtx, run.ID, protocol.TaskEventInput{AfterID: first.NextAfterID, Limit: 2}); err == nil || page != nil {
		t.Fatal("cursor leaked another actor's events")
	}
	if _, err := repo.ListEvents(ctx, run.ID, protocol.TaskEventInput{Limit: 101}); err != taskprotocol.ErrEventQuery {
		t.Fatalf("invalid limit accepted: %v", err)
	}
}

func TestTaskListPreservesInputAndStableOrder(t *testing.T) {
	db := newTaskCenterTestDB(t)
	ctx, actor := taskTestContext(t)
	now := time.Now().UTC()
	ids := []uuid.UUID{uuid.MustParse("11111111-1111-4111-8111-111111111111"), uuid.MustParse("22222222-2222-4222-8222-222222222222")}
	for _, id := range ids {
		if err := db.Create(&TaskRun{ID: id, Actor: actor, TaskType: "command", Title: "same time", CreatedAt: now}).Error; err != nil {
			t.Fatal(err)
		}
	}
	request := &ListRequest{}
	result, err := NewRepository(db, nil).List(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if request.Page != 0 || request.PageSize != 0 || result.Page != 1 || result.Total != 2 || len(result.Runs) != 2 || result.Runs[0].ID != ids[1] {
		t.Fatalf("unstable order or mutated request: %+v %+v", request, result)
	}
}

func TestStandaloneTaskEventRequiresExistingTask(t *testing.T) {
	db := newTaskCenterTestDB(t)
	repo := NewRepository(db, nil)
	ctx, actor := taskTestContext(t)
	event := TaskEvent{TaskRunID: uuid.New(), Level: "warning", Message: "diagnostic"}
	if err := repo.AppendEvent(ctx, &event); err == nil {
		t.Fatal("orphan task event stored")
	}
	run := TaskRun{Actor: actor, TaskType: "command", Title: "observed"}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	event.TaskRunID = run.ID
	if err := repo.AppendEvent(ctx, &event); err != nil {
		t.Fatal(err)
	}
	page, err := repo.ListEvents(ctx, run.ID, protocol.TaskEventInput{})
	if err != nil || len(page.Events) != 1 || page.Events[0].ID != event.ID {
		t.Fatalf("event not visible: %+v %v", page, err)
	}
}
