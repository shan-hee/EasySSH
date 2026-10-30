package taskcenter

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"
)

func TestExecutionProgressSurvivesRestartWithoutLosingKnownTargets(t *testing.T) {
	db := newTaskCenterTestDB(t)
	repo := NewRepository(db, nil)
	s := NewService(repo, nil)
	ctx, actor := taskTestContext(t)
	done, unfinished := uuid.New(), uuid.New()
	started := time.Now().Add(-time.Minute).UTC().Truncate(time.Millisecond)
	finished := started.Add(time.Second)
	run := TaskRun{Actor: actor, TaskType: "command", Title: "checkpoint", SourceType: "scheduled_task", SourceID: uuid.NewString(), Status: StatusRunning, StartedAt: &started, TotalCount: 2, Resource: done.String() + "," + unfinished.String()}
	if err := s.Create(ctx, &run); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal([]map[string]any{{"ServerID": done, "ServerName": "completed target", "Status": "success", "StartTime": started, "EndTime": finished, "Duration": 1000, "Output": "confirmed output"}})
	if err != nil {
		t.Fatal(err)
	}
	// No active access scope is needed to retain an executor's observations.
	for i := 0; i < 2; i++ {
		if err := s.ObserveExecution(context.Background(), run, string(raw), 1, 1, 0); err != nil {
			t.Fatal(err)
		}
	}
	var deliveries int64
	if err := db.Model(&NotificationDelivery{}).Count(&deliveries).Error; err != nil || deliveries != 0 {
		t.Fatalf("progress created completion notification: %d %v", deliveries, err)
	}
	if err := s.RecoverInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetAny(ctx, run.ID)
	if err != nil || got.Status != StatusUnknown || got.SuccessCount != 1 || got.FailureCount != 0 || got.ResultJSON != string(raw) || got.Progress != 50 {
		t.Fatalf("lost checkpoint on restart: %+v %v", got, err)
	}
	for _, target := range []struct {
		id     uuid.UUID
		status operationrecord.Status
	}{{done, operationrecord.StatusSuccess}, {unfinished, operationrecord.StatusUnknown}} {
		var fact operationrecord.OperationRecord
		if err := db.Where("source_table=? AND source_id=?", "task_target_runs", run.ID.String()+":"+target.id.String()).First(&fact).Error; err != nil {
			t.Fatal(err)
		}
		if fact.Status != target.status {
			t.Fatalf("target %s: got %s want %s", target.id, fact.Status, target.status)
		}
		if target.id == done && (fact.FinishedAt == nil || !fact.FinishedAt.Equal(finished) || fact.DurationMs != 1000) {
			t.Fatalf("recovery changed observed completion: %+v", fact)
		}
	}
	if err := s.ObserveExecution(context.Background(), run, "[]", 2, 0, 0); !errors.Is(err, ErrObservedOutcomeConflict) {
		t.Fatalf("late progress overwrote terminal result: %v", err)
	}
}

func TestExecutionProgressRejectsForeignIdentityAndRollsBackProjectionFailure(t *testing.T) {
	db := newTaskCenterTestDB(t)
	repo := NewRepository(db, nil)
	s := NewService(repo, nil)
	ctx, actor := taskTestContext(t)
	run := TaskRun{Actor: actor, TaskType: "command", Title: "checkpoint", SourceType: "scheduled_task", SourceID: uuid.NewString(), Status: StatusRunning, TotalCount: 2}
	if err := s.Create(ctx, &run); err != nil {
		t.Fatal(err)
	}
	foreign := run
	foreign.Actor.SessionID = uuid.NewString()
	if err := s.ObserveExecution(ctx, foreign, "[]", 1, 1, 0); !errors.Is(err, ErrObservedOutcomeConflict) {
		t.Fatalf("accepted foreign writer: %v", err)
	}
	if err := db.Exec(`CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON operation_records BEGIN SELECT RAISE(ABORT, 'projection failure'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.ObserveExecution(context.Background(), run, "[]", 1, 1, 0); err == nil {
		t.Fatal("expected projection failure")
	}
	got, err := repo.GetAny(ctx, run.ID)
	if err != nil || got.ResultJSON != "" || got.Progress != 0 || got.SuccessCount != 0 {
		t.Fatalf("partially committed checkpoint: %+v %v", got, err)
	}
}
