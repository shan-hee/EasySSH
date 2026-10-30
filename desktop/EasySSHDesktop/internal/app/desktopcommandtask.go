package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Keep task cancellation separate from batch command handlers and Wails APIs.
type desktopCommandTaskHandler struct{ servers *DesktopServerService }

func (h desktopCommandTaskHandler) CancelDesktopTask(id string) bool {
	h.servers.commandMu.Lock()
	defer h.servers.commandMu.Unlock()
	cancel, ok := h.servers.commands[id]
	if ok {
		cancel()
	}
	return ok
}

func (desktopCommandTaskHandler) RetryDesktopTask(DesktopTaskRun) (string, error) {
	return "", errors.New("create a new execution after reviewing the previous result")
}

func (s *DesktopServerService) runCommandTask(ctx context.Context, input DesktopServerCommandInput, execute func(context.Context, DesktopServerCommandInput) (DesktopServerCommandResult, error)) (DesktopServerCommandResult, error) {
	input.ServerID, input.Command = strings.TrimSpace(input.ServerID), strings.TrimSpace(input.Command)
	if input.ServerID == "" || input.Command == "" {
		return DesktopServerCommandResult{}, errors.New("server id and command are required")
	}
	if s.tasks == nil {
		return DesktopServerCommandResult{}, errors.New("task service is unavailable")
	}
	ctx, done, err := s.beginOperation(ctx)
	if err != nil {
		return DesktopServerCommandResult{}, err
	}
	// Shutdown must wait for completion persistence as well as remote execution.
	defer done()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	id := uuid.NewString()
	s.commandMu.Lock()
	s.commands[id] = cancel
	s.commandMu.Unlock()
	defer func() {
		s.commandMu.Lock()
		delete(s.commands, id)
		s.commandMu.Unlock()
	}()
	payload, _ := json.Marshal(input)
	if _, err := s.tasks.create(desktopTaskCreateInput{
		ID: id, Actor: desktopLocalActor(), SourceType: "desktop_command", SourceID: id,
		TaskType: "command_execute", Title: "执行命令", ServerID: input.ServerID,
		PayloadJSON: string(payload), TotalCount: 1, Cancelable: true,
	}); err != nil {
		return DesktopServerCommandResult{}, err
	}
	started := time.Now().UTC()
	result := DesktopServerCommandResult{TaskID: id, ServerID: input.ServerID, Command: input.Command,
		StartedAt: started.Format(time.RFC3339Nano)}
	err = s.tasks.start(id, "executing")
	if err != nil {
		// Cancel commits canceling before invoking its handler. Account for
		// that interval when start loses the race to cancellation.
		if run, readErr := s.tasks.getOverview(id); readErr == nil && run.Status == "canceling" {
			cancel()
		}
	}
	if err == nil {
		err = ctx.Err()
	}
	if err == nil {
		result, err = execute(ctx, input)
	}
	result.TaskID, result.ServerID, result.Command = id, input.ServerID, input.Command
	if result.StartedAt == "" {
		result.StartedAt = started.Format(time.RFC3339Nano)
	}
	if result.CompletedAt == "" {
		completed := time.Now().UTC()
		result.CompletedAt, result.DurationMs = completed.Format(time.RFC3339Nano), completed.Sub(started).Milliseconds()
	}
	if err != nil {
		// The SSH executor returns errors only before sending exec. Once sent,
		// it returns an observed outcome, including unknown on transport loss.
		result.Outcome, result.Error = "failed", err.Error()
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			result.Outcome = "canceled"
		} else if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			result.Outcome = "timeout"
		}
	}
	successes, failures := 0, 0
	if result.Outcome == "succeeded" {
		successes = 1
	} else if result.Outcome == "failed" {
		failures = 1
	}
	encoded, _ := json.Marshal(result)
	saveErr := s.tasks.completeOutcome(id, desktopTaskCompletion{
		Status: result.Outcome, ResultJSON: string(encoded), ErrorMessage: result.Error,
		SuccessCount: successes, FailureCount: failures, FinishedAt: result.CompletedAt,
	})
	// Preserve the observed result if local persistence fails; never replay exec.
	return result, errors.Join(err, saveErr)
}
