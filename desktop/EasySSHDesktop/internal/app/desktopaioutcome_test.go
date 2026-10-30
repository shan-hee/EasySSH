package app

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestAIFileMutationUsesObservedEffectInsteadOfStorageError(t *testing.T) {
	for _, tc := range []struct {
		status string
		want   DesktopAITaskStatus
	}{
		{"succeeded", DesktopAITaskSucceeded}, {"unknown", DesktopAITaskUnknown},
		{"canceled", DesktopAITaskCancelled}, {"failed", DesktopAITaskFailed}, {"timeout", DesktopAITaskFailed},
	} {
		info := DesktopSFTPFileInfo{Operation: &DesktopSFTPChangeResult{TaskID: "observed-file-task", Status: tc.status}}
		result := desktopAIFileMutationError("写入文件", info, errors.New("local task storage unavailable"))
		task := DesktopAITaskView{Status: DesktopAITaskRunning}
		applyDesktopAIToolOutcome(&task, result, nil)
		if task.Status != tc.want || !strings.Contains(task.Result, "observed-file-task") {
			t.Fatalf("%s observation changed by persistence error: %+v", tc.status, task)
		}
		if tc.status == "succeeded" && (!strings.Contains(task.Result, "不要重复执行") || task.Error != "") {
			t.Fatal("confirmed success encouraged a retry")
		}
	}
}

func TestAIUnknownWinsCancellationAndPreservesInFlightTools(t *testing.T) {
	record := desktopAISessionRecord{Tasks: []DesktopAITaskView{
		{ID: "unknown", Status: DesktopAITaskRunning},
		{ID: "in-flight", Status: DesktopAITaskRunning},
		{ID: "queued", Status: DesktopAITaskQueued},
		{ID: "approval", Status: DesktopAITaskWaitingConfirm},
	}}
	applyDesktopAIToolOutcome(&record.Tasks[0], desktopAIToolResult{Unknown: true, Content: "remote outcome unknown"}, context.Canceled)
	cancelDesktopAIQueuedTasks(&record, desktopTaskNow())
	if record.Tasks[0].Status != DesktopAITaskUnknown || record.Tasks[1].Status != DesktopAITaskRunning || record.Tasks[2].Status != DesktopAITaskCancelled || record.Tasks[3].Status != DesktopAITaskCancelled {
		t.Fatalf("unknown lost or active result discarded: %+v", record.Tasks)
	}
	applyDesktopAIToolOutcome(&record.Tasks[1], desktopAIToolResult{Content: "confirmed effect"}, nil)
	if record.Tasks[1].Status != DesktopAITaskSucceeded {
		t.Fatal("late success discarded after stopping other work")
	}
	record.Tasks[0].AssistantMessageID, record.Tasks[0].ToolCallID = "assistant", "call"
	messages := desktopAIToolResultMessages(record.Tasks, "assistant")
	if len(messages) != 1 || messages[0].ToolCallID != "call" || messages[0].Content == "" {
		t.Fatal("unknown result missing from next explicit user turn")
	}
}

func TestAIStartupRecoveryPreservesPartialOutputWithoutExecuting(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	ai := &DesktopAIService{db: tasks.db}
	now := desktopTaskNow()
	record := desktopAISessionRecord{ID: "interrupted-ai", ConfigSpaceID: "local", Status: DesktopAISessionRunning, CreatedAt: now, UpdatedAt: now, Tasks: []DesktopAITaskView{
		{ID: "running", Status: DesktopAITaskRunning, CommandOutput: "partial output"},
		{ID: "queued", Status: DesktopAITaskQueued},
		{ID: "finished", Status: DesktopAITaskSucceeded, Result: "confirmed effect"},
	}}
	if err := ai.saveSession(record); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := ai.recoverInterruptedAITasks(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	got, err := ai.loadSession(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != DesktopAISessionIdle || got.Tasks[0].Status != DesktopAITaskUnknown || got.Tasks[0].CommandOutput != "partial output" || got.Tasks[1].Status != DesktopAITaskCancelled || got.Tasks[2].Status != DesktopAITaskSucceeded {
		t.Fatalf("restart changed observed facts: %+v", got)
	}
}

func TestAIAdmissionDoesNotReplaceAnActiveTurn(t *testing.T) {
	ai := &DesktopAIService{}
	ctx, request, err := ai.beginAIRequest(context.Background(), "session")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := ai.beginAIRequest(context.Background(), "session"); err == nil {
		t.Fatal("overlapping turn replaced active request")
	}
	if ctx.Err() != nil {
		t.Fatal("rejected request canceled original turn")
	}
	ai.finishAIRequest("session", request)
	if ctx.Err() == nil {
		t.Fatal("completed request retained its context")
	}
}
