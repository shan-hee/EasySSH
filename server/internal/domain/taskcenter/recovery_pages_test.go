package taskcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestRecoveryPagesKeepSavedResultsAndDoNotSkipUnchangedQueuedTasks(t *testing.T) {
	db := newTaskCenterTestDB(t)
	repo := NewRepository(db, nil)
	service := NewService(repo, nil)
	_, actor := taskTestContext(t)
	const body = `{"output":"confirmed partial output"}`
	for i := 0; i < 205; i++ {
		status, source := StatusRunning, "command"
		if i%3 == 0 {
			status, source = StatusQueued, "scheduled_task"
		} else if i%3 == 1 {
			source = "sftp_operation"
		}
		run := TaskRun{Actor: actor, TaskType: "command", Title: "recovery", Status: status, SourceType: source, ResultJSON: body, ProgressJSON: `{"observed":1}`, SuccessCount: 1, FailureCount: 2}
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := service.RecoverInterrupted(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	var runs []TaskRun
	if err := db.Find(&runs).Error; err != nil {
		t.Fatal(err)
	}
	for _, run := range runs {
		want := StatusUnknown
		if run.SourceType == "scheduled_task" {
			want = StatusQueued
		}
		if run.Status != want || run.ResultJSON != body || run.ProgressJSON != `{"observed":1}` || run.SuccessCount != 1 || run.FailureCount != 2 {
			raw, _ := json.Marshal(run)
			t.Fatalf("recovery discarded observed facts: %s", raw)
		}
	}
	var eventCount int64
	if err := db.Model(&TaskEvent{}).Count(&eventCount).Error; err != nil {
		t.Fatal(err)
	}
	if eventCount != 136 {
		t.Fatalf("recovery replayed or skipped settlement: %d events", eventCount)
	}
}
