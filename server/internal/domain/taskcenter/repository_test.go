package taskcenter

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

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
	if err := db.AutoMigrate(&TaskRun{}, &TaskEvent{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestRepositoryStatisticsAndListSummary(t *testing.T) {
	db := newTaskCenterTestDB(t)
	repo := NewRepository(db)
	userID := uuid.New()
	otherUserID := uuid.New()
	runs := []*TaskRun{
		{UserID: userID, TaskType: "command", Title: "queued", Status: StatusQueued, PayloadJSON: `{"secret":true}`, ResultJSON: `{"output":"large"}`, ProgressJSON: `{"step":1}`},
		{UserID: userID, TaskType: "command", Title: "running", Status: StatusRunning},
		{UserID: userID, TaskType: "command", Title: "failed", Status: StatusFailed},
		{UserID: otherUserID, TaskType: "command", Title: "other", Status: StatusSucceeded},
	}
	for _, run := range runs {
		if err := db.Create(run).Error; err != nil {
			t.Fatal(err)
		}
	}
	stats, err := repo.Statistics(context.Background(), userID)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Total != 3 || stats.Queued != 1 || stats.Running != 1 || stats.Failed != 1 {
		t.Fatalf("unexpected statistics: %+v", stats)
	}
	result, err := repo.List(context.Background(), &ListRequest{UserID: userID, Page: 1, PageSize: 20})
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
	service := NewService(NewRepository(db), nil)
	userID := uuid.New()
	run := &TaskRun{UserID: userID, TaskType: "command", Title: "queued", Status: StatusQueued, Cancelable: true}
	if err := service.Create(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	canceler := &successfulCanceler{}
	service.SetCanceler(canceler)
	if err := service.RequestCancel(context.Background(), userID, run.ID); err != nil {
		t.Fatal(err)
	}
	updated, err := service.Get(context.Background(), userID, run.ID)
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
	service := NewService(NewRepository(db), nil)
	userID := uuid.New()
	running := &TaskRun{
		UserID: userID, TaskType: "command", Title: "running", SourceType: "scheduled_task", Status: StatusRunning,
	}
	queued := &TaskRun{
		UserID: userID, TaskType: "command", Title: "queued", SourceType: "scheduled_task", Status: StatusQueued,
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
	recoveredRunning, err := service.Get(context.Background(), userID, running.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recoveredRunning.Status != StatusFailed || recoveredRunning.ErrorCode != "server_restarted" {
		t.Fatalf("running command must fail without replay: %+v", recoveredRunning)
	}
	recoveredQueued, err := service.Get(context.Background(), userID, queued.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recoveredQueued.Status != StatusQueued {
		t.Fatalf("queued command must remain recoverable, got %q", recoveredQueued.Status)
	}
}
