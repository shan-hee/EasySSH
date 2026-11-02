// Package automation exposes existing resource services without an AI session.
package automation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/aichat"
	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/server/internal/domain/batchtask"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/domain/taskexecutor"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

type Service struct {
	tools   *aichat.ToolExecutorService
	batch   batchtask.Service
	tasks   taskcenter.Service
	scripts script.Service
	records operationrecord.Service
	specs   []registry.ToolSpec
	actions map[string][]protocol.Action
	schemas map[string]*jsonschema.Schema
}

var (
	ErrUnknownTool      = errors.New("unknown tool")
	ErrInvalidArguments = errors.New("invalid arguments")
)

// Output is a resource tool's model-facing text. UI artifacts such as full
// file snapshots and duplicated command output stay on the server.
type Output struct {
	Content   string `json:"content"`
	IsError   bool   `json:"is_error,omitempty"`
	Unknown   bool   `json:"unknown,omitempty"`
	Cancelled bool   `json:"cancelled,omitempty"`
}

// Task is a durable command or script run. Each target keeps at most the last
// 48 KiB of output, so results are returned inline, never as content references.
type Task struct {
	TaskID     string            `json:"task_id"`
	Status     taskcenter.Status `json:"status"`
	Finished   bool              `json:"finished"`
	Cancelable bool              `json:"cancelable"`
	Error      string            `json:"error,omitempty"`
	StartedAt  *time.Time        `json:"started_at,omitempty"`
	FinishedAt *time.Time        `json:"finished_at,omitempty"`
	Results    []TaskTarget      `json:"results,omitempty"`
}

type TaskTarget struct {
	ServerID   string `json:"server_id"`
	ServerName string `json:"server_name,omitempty"`
	Status     string `json:"status"`
	ExitCode   *int   `json:"exit_code"`
	Output     string `json:"output"`
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"duration_ms"`
}

type callInput struct {
	ServerID    string            `json:"server_id"`
	Command     string            `json:"command"`
	ScriptID    string            `json:"script_id"`
	Version     string            `json:"version"`
	Parameters  map[string]string `json:"parameters"`
	TaskID      string            `json:"task_id"`
	AfterID     string            `json:"after_id"`
	Limit       int               `json:"limit"`
	WaitSeconds *int              `json:"wait_seconds"`
}

// maxWaitSeconds keeps a waiting call below common 60-second proxy timeouts.
const maxWaitSeconds = 50

func NewService(tools *aichat.ToolExecutorService, batch batchtask.Service, tasks taskcenter.Service, scripts script.Service, records operationrecord.Service) (*Service, error) {
	s := &Service{tools: tools, batch: batch, tasks: tasks, scripts: scripts, records: records, actions: map[string][]protocol.Action{}, schemas: map[string]*jsonschema.Schema{}}
	for _, spec := range tools.BuildToolRegistry().All() {
		if spec.Name == "execute_command" {
			continue // replaced by the durable task version below
		}
		spec.Parameters["additionalProperties"] = false
		// These descriptions address the in-app assistant and its review UI.
		switch spec.Name {
		case "list_servers":
			spec.Description = "列出当前凭据可访问的服务器，包含 ID、名称、主机地址、状态等信息。"
		case "write_file":
			spec.Description = "向服务器写入最多 2 MiB 的 UTF-8 文本文件。传入 read_file 返回的 sha256 作为 expected_sha256，文件在读取后被修改时拒绝写入。"
		}
		s.add(spec, aichat.ToolActions(spec.Name)...)
	}
	str := func() any { return map[string]any{"type": "string", "minLength": 1} }
	wait := func(defaultSeconds int) any {
		return map[string]any{"type": "integer", "minimum": 0, "maximum": maxWaitSeconds, "default": defaultSeconds, "description": "Seconds to wait for the task to finish before returning its current state."}
	}
	object := func(properties map[string]any, required ...string) map[string]any {
		return map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}
	}
	readOnly := []string{"readonly"}
	s.add(registry.ToolSpec{Name: "execute_command", Dangerous: true,
		Description: "Run a shell command as a durable task and wait up to wait_seconds (default 10) for its exit code and output; otherwise poll get_task. Output is combined stdout/stderr, last 48 KiB. Wrap commands that may hang in `timeout N`; pass multi-line scripts as a quoted heredoc (python3 - <<'EOF' ... EOF). Never automatically retry an uncertain execution.",
		Parameters:  object(map[string]any{"server_id": str(), "command": str(), "wait_seconds": wait(10)}, "server_id", "command")},
		aichat.ToolActions("execute_command")...)
	s.add(registry.ToolSpec{Name: "list_scripts", SupportedModes: readOnly,
		Description: "List permitted scripts and their exact versions and parameter constraints. Continue with next_after_id while has_more is true.",
		Parameters:  object(map[string]any{"server_id": str(), "after_id": str(), "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 100}}, "server_id")})
	s.add(registry.ToolSpec{Name: "execute_script", Dangerous: true,
		Description: "Run a permitted script version as a durable task and wait up to wait_seconds (default 10) for its result; otherwise poll get_task.",
		Parameters:  object(map[string]any{"server_id": str(), "script_id": str(), "version": str(), "parameters": map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}}, "wait_seconds": wait(10)}, "server_id", "script_id", "version")},
		protocol.ScriptsExecute)
	s.add(registry.ToolSpec{Name: "get_task", SupportedModes: readOnly,
		Description: "Read this credential's task status, exit codes and output. Set wait_seconds to wait for completion instead of polling repeatedly.",
		Parameters:  object(map[string]any{"task_id": str(), "wait_seconds": wait(0)}, "task_id")})
	s.add(registry.ToolSpec{Name: "cancel_task",
		Description: "Request cancellation of this credential's task by sending SIGTERM, then SIGKILL to the remote session. This requires SSH server signal support; query get_task to confirm the outcome. Effects already produced are not rolled back, and detached processes may keep running.",
		Parameters:  object(map[string]any{"task_id": str()}, "task_id")})
	for _, spec := range s.specs {
		compiler := jsonschema.NewCompiler()
		// Round-trip converts Go maps/slices to the JSON representation expected by the compiler.
		data, err := json.Marshal(spec.Parameters)
		if err != nil {
			return nil, err
		}
		var doc any
		if err := json.Unmarshal(data, &doc); err != nil {
			return nil, err
		}
		uri := "urn:easyssh:tool:" + spec.Name
		if err := compiler.AddResource(uri, doc); err != nil {
			return nil, err
		}
		schema, err := compiler.Compile(uri)
		if err != nil {
			return nil, err
		}
		s.schemas[spec.Name] = schema
	}
	return s, nil
}

// add states each tool's permissions in its description: every credential sees
// the full catalog, so a client learns what a tool needs before calling it.
func (s *Service) add(spec registry.ToolSpec, actions ...protocol.Action) {
	if len(actions) > 0 {
		names := make([]string, len(actions))
		for i, action := range actions {
			names[i] = string(action)
		}
		spec.Description += " Requires " + strings.Join(names, " + ") + " on the target server."
	}
	s.actions[spec.Name] = actions
	s.specs = append(s.specs, spec)
}

func (s *Service) Tools() []registry.ToolSpec { return s.specs }

func (s *Service) Call(ctx context.Context, name string, arguments json.RawMessage) (any, error) {
	if err := access.Current(ctx).Check(ctx, access.Requirement{Action: protocol.WorkspaceRead}); err != nil {
		return nil, err
	}
	schema := s.schemas[name]
	if schema == nil {
		return nil, ErrUnknownTool
	}
	if len(arguments) > 1<<20 {
		return nil, fmt.Errorf("%w: arguments exceed 1 MiB", ErrInvalidArguments)
	}
	if len(arguments) == 0 {
		arguments = json.RawMessage("{}") // MCP clients may omit arguments for parameterless tools
	}
	var value any
	if err := json.Unmarshal(arguments, &value); err != nil {
		return nil, fmt.Errorf("%w: expected JSON", ErrInvalidArguments)
	}
	if err := schema.Validate(value); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidArguments, err)
	}
	var input callInput
	if err := json.Unmarshal(arguments, &input); err != nil {
		return nil, ErrInvalidArguments
	}
	if input.ServerID != "" {
		if _, err := uuid.Parse(input.ServerID); err != nil {
			return nil, fmt.Errorf("%w: invalid server_id", ErrInvalidArguments)
		}
	}
	result, err := s.call(ctx, name, arguments, input)
	if errors.Is(err, access.ErrForbidden) {
		err = s.explainDenial(ctx, name, input, err)
	}
	return result, err
}

func (s *Service) call(ctx context.Context, name string, arguments json.RawMessage, input callInput) (any, error) {
	wait := func(defaultSeconds int) time.Duration {
		if input.WaitSeconds != nil {
			return time.Duration(*input.WaitSeconds) * time.Second
		}
		return time.Duration(defaultSeconds) * time.Second
	}
	switch name {
	case "list_scripts":
		return s.scripts.Available(ctx, input.ServerID, protocol.ScriptCatalogInput{AfterID: input.AfterID, Limit: input.Limit})
	case "execute_command", "execute_script":
		req := &protocol.CreateBatchTaskRequest{TaskName: "Automation " + name, TaskType: "command", Content: input.Command, ServerIDs: []string{input.ServerID}, ExecutionMode: "sequential"}
		if name == "execute_script" {
			req.TaskType = "script"
			req.Content = ""
			req.ScriptID = &input.ScriptID
			req.ScriptVersion = input.Version
			req.Parameters = input.Parameters
		}
		task, err := s.batch.CreateBatchTask(ctx, req)
		if err != nil {
			return nil, err
		}
		if err := s.batch.StartBatchTask(ctx, task.ID); err != nil {
			return nil, fmt.Errorf("task %s was created but not dispatched: %w", task.ID, err)
		}
		return s.task(ctx, task.ID, wait(10))
	case "get_task", "cancel_task":
		id, err := uuid.Parse(input.TaskID)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid task_id", ErrInvalidArguments)
		}
		if name == "cancel_task" {
			if err := s.tasks.RequestCancel(ctx, id); err != nil {
				return nil, err
			}
		}
		return s.task(ctx, id, wait(0))
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	now := time.Now().UTC()
	id := uuid.New()
	record := &operationrecord.OperationRecord{ID: id, WorkID: id, Actor: access.Current(ctx).Actor(), Type: operationrecord.TypeAudit, Category: operationrecord.CategoryAudit, Action: name, Title: name, Source: "automation", SourceTable: "automation_operations", SourceID: id.String(), Status: operationrecord.StatusRunning, CreatedAt: now, StartedAt: &now}
	if input.ServerID != "" {
		parsed := uuid.MustParse(input.ServerID) // validated by Call
		record.ServerID = &parsed
	}
	if err := s.records.Upsert(ctx, record); err != nil {
		return nil, errors.New("cannot record operation")
	}
	result, err := s.tools.ExecuteOperation(ctx, &aichat.ToolCall{ID: id.String(), Name: name, Arguments: arguments})
	end := time.Now().UTC()
	record.FinishedAt = &end
	record.Status = operationrecord.StatusSuccess
	if err != nil || result != nil && result.IsError {
		record.Status = operationrecord.StatusFailure
	}
	if result != nil && result.Unknown {
		record.Status = operationrecord.StatusUnknown
	}
	if result != nil && result.Cancelled {
		record.Status = operationrecord.StatusCanceled
	}
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer finishCancel()
	if recordErr := s.records.Upsert(finishCtx, record); recordErr != nil {
		return nil, errors.New("operation completed but result recording failed; verify state before retrying")
	}
	if err != nil {
		return nil, err
	}
	return Output{Content: result.Content, IsError: result.IsError, Unknown: result.Unknown, Cancelled: result.Cancelled}, nil
}

// explainDenial names the permission behind a denial; services return only the
// generic error. It runs on the failure path, so allowed calls pay nothing.
func (s *Service) explainDenial(ctx context.Context, name string, input callInput, denied error) error {
	if input.ServerID == "" {
		return denied
	}
	scope := access.Current(ctx)
	if errors.Is(scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead, ServerID: input.ServerID}), access.ErrForbidden) {
		return fmt.Errorf("%w: server %s is not available to this credential", denied, input.ServerID)
	}
	for _, action := range s.actions[name] {
		req := access.Requirement{Action: action, ServerID: input.ServerID}
		if action == protocol.ScriptsExecute {
			req.ScriptID, req.ScriptVersion = input.ScriptID, input.Version
		}
		if errors.Is(scope.Check(ctx, req), access.ErrForbidden) {
			target := "server " + input.ServerID
			if req.ScriptID != "" {
				target = fmt.Sprintf("script %s version %s on %s", req.ScriptID, req.ScriptVersion, target)
			}
			return fmt.Errorf("%w: this credential lacks %s for %s", denied, action, target)
		}
	}
	return denied
}

// task reads a run, waiting up to wait for it to finish so that short commands
// complete in a single call.
func (s *Service) task(ctx context.Context, id uuid.UUID, wait time.Duration) (*Task, error) {
	deadline := time.Now().Add(wait)
	for {
		run, err := s.tasks.Get(ctx, id)
		if err != nil {
			return nil, err
		}
		if taskcenter.IsTerminalStatus(run.Status) || !time.Now().Before(deadline) {
			return newTask(run)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func newTask(run *taskcenter.TaskRun) (*Task, error) {
	task := &Task{TaskID: run.ID.String(), Status: run.Status, Finished: taskcenter.IsTerminalStatus(run.Status), Cancelable: run.Cancelable, Error: run.ErrorMessage, StartedAt: utc(run.StartedAt), FinishedAt: utc(run.FinishedAt)}
	if run.SourceType != string(taskexecutor.SourceBatchTask) || run.ResultJSON == "" {
		return task, nil
	}
	var targets []taskexecutor.ServerExecutionResult
	if err := json.Unmarshal([]byte(run.ResultJSON), &targets); err != nil {
		return nil, fmt.Errorf("task %s result is unreadable: %w", task.TaskID, err)
	}
	for _, target := range targets {
		task.Results = append(task.Results, TaskTarget{ServerID: target.ServerID.String(), ServerName: target.ServerName, Status: string(target.Status), ExitCode: target.ExitCode, Output: target.Output, Error: target.ErrorMessage, DurationMs: target.Duration})
	}
	return task, nil
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	value := t.UTC()
	return &value
}
