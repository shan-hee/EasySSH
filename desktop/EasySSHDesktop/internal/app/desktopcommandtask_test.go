package app

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/easyssh/shared/activitystats"
)

func TestDesktopDirectCommandIntentAndCompletion(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	s := NewDesktopServerService(nil, tasks)
	calls := 0
	result, err := s.runCommandTask(context.Background(), DesktopServerCommandInput{ServerID: "server", Command: " true "}, func(ctx context.Context, input DesktopServerCommandInput) (DesktopServerCommandResult, error) {
		calls++
		var state, payload string
		if err := tasks.db.QueryRow(`SELECT status,payload_json FROM desktop_task_runs WHERE source_type='desktop_command'`).Scan(&state, &payload); err != nil {
			t.Fatal(err)
		}
		if state != "running" || input.Command != "true" {
			t.Fatalf("command sent before durable intent: %s %+v", state, input)
		}
		var intent DesktopServerCommandInput
		if err := json.Unmarshal([]byte(payload), &intent); err != nil || intent.Command != input.Command || intent.ServerID != input.ServerID {
			t.Fatalf("intent does not describe execution: %+v %v", intent, err)
		}
		code := 0
		return DesktopServerCommandResult{Outcome: "succeeded", ExitCode: &code, Output: "done"}, nil
	})
	if err != nil || calls != 1 || result.TaskID == "" {
		t.Fatalf("command execution: %+v %d %v", result, calls, err)
	}
	run, err := tasks.getRun(result.TaskID)
	if err != nil || run.Status != "succeeded" || run.SuccessCount != 1 || run.FailureCount != 0 || run.Retryable || run.Cancelable {
		t.Fatalf("completion: %+v %v", run, err)
	}
	var saved DesktopServerCommandResult
	if err := json.Unmarshal([]byte(run.ResultJSON), &saved); err != nil || saved.Output != "done" || saved.TaskID != result.TaskID {
		t.Fatalf("saved result: %+v %v", saved, err)
	}
	var kind, source, sourceID string
	if err := tasks.db.QueryRow(`SELECT kind FROM activity_logs WHERE source_table='desktop_task_runs' AND source_id=?`, result.TaskID).Scan(&kind); err != nil || kind != string(activitystats.TypeExecution) {
		t.Fatalf("execution activity: %s %v", kind, err)
	}
	if err := tasks.db.QueryRow(`SELECT source_type,source_id FROM desktop_notifications WHERE source_id=?`, result.TaskID).Scan(&source, &sourceID); err != nil || source != "task_run" || sourceID != result.TaskID {
		t.Fatalf("completion notification: %s %s %v", source, sourceID, err)
	}
}

func TestDesktopDirectCommandCancellationPreservesUnknown(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	s := NewDesktopServerService(nil, tasks)
	batch := NewDesktopScriptService(s, tasks)
	t.Cleanup(batch.runCancel)
	if tasks.handlers["command"] != batch {
		t.Fatal("direct command replaced batch cancellation")
	}
	result, err := s.runCommandTask(context.Background(), DesktopServerCommandInput{ServerID: "server", Command: "change-state"}, func(ctx context.Context, _ DesktopServerCommandInput) (DesktopServerCommandResult, error) {
		var id string
		if err := tasks.db.QueryRow(`SELECT id FROM desktop_task_runs WHERE source_type='desktop_command'`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if _, err := tasks.Cancel(id); err != nil || ctx.Err() != context.Canceled {
			t.Fatalf("cancel did not reach command: %v %v", err, ctx.Err())
		}
		return DesktopServerCommandResult{Outcome: "unknown", Error: "remote exit not received"}, nil
	})
	run, readErr := tasks.getRun(result.TaskID)
	if err != nil || readErr != nil || run.Status != "unknown" || run.SuccessCount != 0 || run.FailureCount != 0 || run.Retryable || len(s.commands) != 0 {
		t.Fatalf("unknown effect became a failure/retry: %+v %v %v", run, err, readErr)
	}
}

func TestDesktopDirectCommandRecoveryDoesNotReplay(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	for _, started := range []bool{false, true} {
		id, err := tasks.create(desktopTaskCreateInput{Actor: desktopLocalActor(), SourceType: "desktop_command", TaskType: "command_execute", Title: "执行命令", TotalCount: 1, Cancelable: true})
		if err != nil {
			t.Fatal(err)
		}
		if started {
			if err := tasks.start(id, "executing"); err != nil {
				t.Fatal(err)
			}
		}
		if err := tasks.recoverInterrupted(context.Background()); err != nil {
			t.Fatal(err)
		}
		want := "canceled"
		if started {
			want = "unknown"
		}
		run, err := tasks.getRun(id)
		if err != nil || run.Status != want || run.Retryable || run.Cancelable || run.SuccessCount != 0 || run.FailureCount != 0 {
			t.Fatalf("restart invented a result or replay: %+v %v", run, err)
		}
	}
}

func TestDesktopDirectCommandDoesNotExecuteWithoutIntent(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	s := NewDesktopServerService(nil, tasks)
	if _, err := tasks.db.Exec(`CREATE TRIGGER reject_direct_command BEFORE INSERT ON desktop_task_runs WHEN NEW.source_type='desktop_command' BEGIN SELECT RAISE(ABORT,'intent unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	_, err := s.runCommandTask(context.Background(), DesktopServerCommandInput{ServerID: "server", Command: "change-state"}, func(context.Context, DesktopServerCommandInput) (DesktopServerCommandResult, error) {
		t.Fatal("command executed without intent")
		return DesktopServerCommandResult{}, nil
	})
	if err == nil || len(s.commands) != 0 || len(s.operations) != 0 {
		t.Fatalf("intent failure or execution registration leaked: %v", err)
	}
}
