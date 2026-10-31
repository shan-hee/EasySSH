// Package automation exposes existing resource services without an AI session.
package automation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/aichat"
	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/server/internal/domain/batchtask"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/server/internal/domain/taskcenter"
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
	schemas map[string]*jsonschema.Schema
}

var (
	ErrUnknownTool      = errors.New("unknown tool")
	ErrInvalidArguments = errors.New("invalid arguments")
)

func NewService(tools *aichat.ToolExecutorService, batch batchtask.Service, tasks taskcenter.Service, scripts script.Service, records operationrecord.Service) (*Service, error) {
	s := &Service{tools: tools, batch: batch, tasks: tasks, scripts: scripts, records: records, schemas: map[string]*jsonschema.Schema{}}
	for _, spec := range tools.BuildToolRegistry().All() {
		if spec.Name != "execute_command" {
			spec.Parameters["additionalProperties"] = false
			if spec.Name == "write_file" {
				spec.Description += " Requires both files.read and files.write; text files only, with baseline conflict detection."
			}
			s.specs = append(s.specs, spec)
		}
	}
	str := func() any { return map[string]any{"type": "string", "minLength": 1} }
	add := func(name, description string, properties map[string]any, required ...string) {
		s.specs = append(s.specs, registry.ToolSpec{Name: name, Description: description, Parameters: map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}})
	}
	add("execute_command", "Run a shell command as a durable task. Returns task_id; poll get_task. Never automatically retry an uncertain execution.", map[string]any{"server_id": str(), "command": str()}, "server_id", "command")
	add("list_scripts", "List permitted scripts and their exact versions and parameter constraints. Continue with next_after_id while has_more is true.", map[string]any{"server_id": str(), "after_id": str(), "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 100}}, "server_id")
	add("execute_script", "Run a permitted script version as a durable task.", map[string]any{"server_id": str(), "script_id": str(), "version": str(), "parameters": map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}}}, "server_id", "script_id", "version")
	add("get_task", "Read this credential's task status and output.", map[string]any{"task_id": str()}, "task_id")
	add("cancel_task", "Request cancellation of this credential's task. Remote effects are not rolled back.", map[string]any{"task_id": str()}, "task_id")
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
	var value any
	if err := json.Unmarshal(arguments, &value); err != nil {
		return nil, fmt.Errorf("%w: expected JSON", ErrInvalidArguments)
	}
	if err := schema.Validate(value); err != nil {
		return nil, fmt.Errorf("%w: arguments do not match tool schema", ErrInvalidArguments)
	}
	var input struct {
		ServerID   string            `json:"server_id"`
		Command    string            `json:"command"`
		ScriptID   string            `json:"script_id"`
		Version    string            `json:"version"`
		Parameters map[string]string `json:"parameters"`
		TaskID     string            `json:"task_id"`
		AfterID    string            `json:"after_id"`
		Limit      int               `json:"limit"`
	}
	if err := json.Unmarshal(arguments, &input); err != nil {
		return nil, ErrInvalidArguments
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
		return map[string]any{"task_id": task.ID, "status": "queued"}, nil
	case "get_task", "cancel_task":
		id, err := uuid.Parse(input.TaskID)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid task_id", ErrInvalidArguments)
		}
		if name == "get_task" {
			return s.tasks.Details(ctx, id)
		}
		if err := s.tasks.RequestCancel(ctx, id); err != nil {
			return nil, err
		}
		return map[string]string{"task_id": input.TaskID, "status": "cancellation_requested"}, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	now := time.Now().UTC()
	id := uuid.New()
	record := &operationrecord.OperationRecord{ID: id, WorkID: id, Actor: access.Current(ctx).Actor(), Type: operationrecord.TypeAudit, Category: operationrecord.CategoryAudit, Action: name, Title: name, Source: "automation", SourceTable: "automation_operations", SourceID: id.String(), Status: operationrecord.StatusRunning, CreatedAt: now, StartedAt: &now}
	if input.ServerID != "" {
		parsed, err := uuid.Parse(input.ServerID)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid server_id", ErrInvalidArguments)
		}
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
	return result, err
}
