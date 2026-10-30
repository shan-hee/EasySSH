package runtime

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/google/uuid"
)

func TestUnknownToolStopsQueuedWorkWithoutDiscardingInFlightFacts(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &session{id: "session", actor: testAIActor(uuid.New()), currentRun: cancel, tasks: map[string]*taskState{}, taskOrder: []string{"unknown", "queued", "inflight"}}
	s.tasks["unknown"] = &taskState{view: TaskView{ID: "unknown", Status: TaskStatusQueued}, toolCall: registry.ToolCall{ID: "call-unknown"}, spec: registry.ToolSpec{}}
	s.tasks["queued"] = &taskState{view: TaskView{ID: "queued", Status: TaskStatusQueued}, toolCall: registry.ToolCall{ID: "call-queued"}}
	s.tasks["inflight"] = &taskState{view: TaskView{ID: "inflight", Status: TaskStatusRunning}, toolCall: registry.ToolCall{ID: "call-inflight"}}
	m := &Manager{registry: registry.NewToolRegistry(nil), sessions: map[string]*session{s.id: s}}
	s.tasks["unknown"].spec.Executor = func(context.Context, json.RawMessage) (registry.ExecutionResult, error) {
		return registry.ExecutionResult{Unknown: true, Content: "effect unconfirmed"}, nil
	}
	m.executeTask(ctx, s, "unknown")
	if !s.halted || ctx.Err() == nil || s.tasks["unknown"].view.Status != TaskStatusUnknown || s.tasks["queued"].view.Status != TaskStatusCancelled || s.tasks["inflight"].view.Status != TaskStatusRunning {
		t.Fatal("unknown did not halt safely")
	}
}

func TestConfirmedToolResultWinsLateCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &session{id: "session", actor: testAIActor(uuid.New()), tasks: map[string]*taskState{}, taskOrder: []string{"tool"}}
	s.tasks["tool"] = &taskState{view: TaskView{ID: "tool", Status: TaskStatusQueued}, toolCall: registry.ToolCall{ID: "call"}, spec: registry.ToolSpec{Executor: func(context.Context, json.RawMessage) (registry.ExecutionResult, error) {
		cancel()
		return registry.ExecutionResult{Content: "confirmed effect"}, nil
	}}}
	m := &Manager{registry: registry.NewToolRegistry(nil), sessions: map[string]*session{s.id: s}}
	m.executeTask(ctx, s, "tool")
	if s.tasks["tool"].view.Status != TaskStatusSucceeded {
		t.Fatal("late cancellation replaced confirmed result")
	}
}

func TestRestoreMarksRunningUnknownEvenWhileOtherToolsAwaitApproval(t *testing.T) {
	snapshot := SessionSnapshot{Status: SessionStatusWaitingConfirmation, UpdatedAt: time.Now(), Tasks: []PersistedTask{
		{ToolCall: registry.ToolCall{ID: "running-call"}, View: TaskView{ID: "running", Status: TaskStatusRunning, CommandOutput: "partial"}},
		{ToolCall: registry.ToolCall{ID: "waiting-call"}, View: TaskView{ID: "waiting", Status: TaskStatusWaitingConfirm}},
	}}
	normalizeRestoredSnapshot(&snapshot)
	normalizeRestoredSnapshot(&snapshot)
	if snapshot.Status != SessionStatusIdle || snapshot.Tasks[0].View.Status != TaskStatusUnknown || snapshot.Tasks[0].View.CommandOutput != "partial" || snapshot.Tasks[1].View.Status != TaskStatusCancelled || len(snapshot.Messages) != 2 {
		t.Fatalf("incorrect restored facts: %+v", snapshot)
	}
}
