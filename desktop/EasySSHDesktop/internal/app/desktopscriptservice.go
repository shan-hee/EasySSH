package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/easyssh/shared/resultstore"
	"github.com/easyssh/shared/scriptutil"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

type DesktopScript struct {
	Version     string   `json:"version"`
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Content     string   `json:"content"`
	Language    string   `json:"language"`
	Tags        []string `json:"tags"`
	Executions  int      `json:"executions"`
	Author      string   `json:"author"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

type DesktopScriptInput struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Content     string   `json:"content"`
	Language    string   `json:"language,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

type DesktopScriptListParams struct {
	Page     int      `json:"page,omitempty"`
	Limit    int      `json:"limit,omitempty"`
	Search   string   `json:"search,omitempty"`
	Tags     []string `json:"tags,omitempty"`
	Language string   `json:"language,omitempty"`
}

type DesktopScriptListResult struct {
	Data       []DesktopScript `json:"data"`
	Total      int             `json:"total"`
	Page       int             `json:"page"`
	Limit      int             `json:"limit"`
	TotalPages int             `json:"total_pages"`
}

type DesktopBatchTask struct {
	ScriptVersion string            `json:"script_version"`
	Parameters    map[string]string `json:"parameters"`
	ID            string            `json:"id"`
	TaskName      string            `json:"task_name"`
	TaskType      string            `json:"task_type"`
	Content       string            `json:"content"`
	ScriptID      string            `json:"script_id,omitempty"`
	ServerIDs     []string          `json:"server_ids"`
	ExecutionMode string            `json:"execution_mode"`
	Status        string            `json:"status"`
	SuccessCount  int               `json:"success_count"`
	FailedCount   int               `json:"failed_count"`
	StartedAt     string            `json:"started_at,omitempty"`
	CompletedAt   string            `json:"completed_at,omitempty"`
	Duration      int               `json:"duration,omitempty"`
	CreatedAt     string            `json:"created_at"`
	UpdatedAt     string            `json:"updated_at"`
}

type DesktopBatchTaskInput struct {
	ScriptVersion string            `json:"script_version"`
	Parameters    map[string]string `json:"parameters"`
	TaskName      string            `json:"task_name"`
	TaskType      string            `json:"task_type"`
	Content       string            `json:"content,omitempty"`
	ScriptID      string            `json:"script_id,omitempty"`
	ServerIDs     []string          `json:"server_ids"`
	ExecutionMode string            `json:"execution_mode,omitempty"`
}

type DesktopBatchTaskListParams struct {
	Page     int    `json:"page,omitempty"`
	Limit    int    `json:"limit,omitempty"`
	Status   string `json:"status,omitempty"`
	TaskType string `json:"task_type,omitempty"`
}

type DesktopBatchTaskListResult struct {
	Data       []DesktopBatchTask `json:"data"`
	Total      int                `json:"total"`
	Page       int                `json:"page"`
	Limit      int                `json:"limit"`
	TotalPages int                `json:"total_pages"`
}

type DesktopBatchTaskStartResult struct {
	TaskID      string `json:"task_id"`
	BatchTaskID string `json:"batch_task_id"`
	Status      string `json:"status"`
}

type desktopBatchTaskResult struct {
	ID           string
	TaskID       string
	ServerID     string
	ServerName   string
	ServerHost   string
	Status       string
	ExitCode     sql.NullInt64
	Output       string
	ErrorMessage string
	StartedAt    string
	CompletedAt  string
	DurationMs   int64
}

type desktopScriptExecution struct {
	scriptID string
	version  string
	cancel   context.CancelFunc
}

type DesktopScriptService struct {
	executionMu    sync.Mutex
	executions     map[string]desktopScriptExecution
	executionSlots chan struct{}
	workerWG       sync.WaitGroup
	closed         bool
	runCtx         context.Context
	runCancel      context.CancelFunc
	mu             sync.Mutex
	db             *sql.DB
	serverService  *DesktopServerService
	taskCenter     *DesktopTaskService
}

func NewDesktopScriptService(serverService *DesktopServerService, taskCenter *DesktopTaskService) *DesktopScriptService {
	ctx, cancel := context.WithCancel(context.Background())
	service := &DesktopScriptService{serverService: serverService, taskCenter: taskCenter,
		runCtx: ctx, runCancel: cancel, executions: make(map[string]desktopScriptExecution), executionSlots: make(chan struct{}, 10)}
	if taskCenter != nil {
		taskCenter.registerHandler("command", service)
		taskCenter.registerHandler("script", service)
	}
	return service
}

func (s *DesktopScriptService) ServiceName() string {
	return "DesktopScriptService"
}

func (s *DesktopScriptService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	_, err := s.database()
	return err
}

func (s *DesktopScriptService) ServiceShutdown() error {
	s.executionMu.Lock()
	s.closed = true
	s.runCancel()
	s.executionMu.Unlock()
	s.workerWG.Wait()
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return nil
	}

	err := s.db.Close()
	s.db = nil
	return err
}

func (s *DesktopScriptService) List(params DesktopScriptListParams) (DesktopScriptListResult, error) {
	database, err := s.database()
	if err != nil {
		return DesktopScriptListResult{}, err
	}

	params = normalizeDesktopScriptListParams(params)
	where, args := buildDesktopScriptWhere(params)

	var total int
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM desktop_scripts WHERE %s", where)
	if err := database.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return DesktopScriptListResult{}, err
	}

	offset := (params.Page - 1) * params.Limit
	queryArgs := append(append([]any{}, args...), params.Limit, offset)
	querySQL := fmt.Sprintf(`
		SELECT id, name, description, content, language, tags_json, executions, author, created_at, updated_at
		FROM desktop_scripts
		WHERE %s
		ORDER BY updated_at DESC, created_at DESC, id DESC
		LIMIT ? OFFSET ?`, where)

	rows, err := database.Query(querySQL, queryArgs...)
	if err != nil {
		return DesktopScriptListResult{}, err
	}
	defer rows.Close()

	scripts, err := scanDesktopScripts(rows)
	if err != nil {
		return DesktopScriptListResult{}, err
	}

	totalPages := 0
	if total > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(params.Limit)))
	}

	return DesktopScriptListResult{
		Data:       scripts,
		Total:      total,
		Page:       params.Page,
		Limit:      params.Limit,
		TotalPages: totalPages,
	}, nil
}

func (s *DesktopScriptService) GetById(id string) (DesktopScript, error) {
	database, err := s.database()
	if err != nil {
		return DesktopScript{}, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return DesktopScript{}, errors.New("script id is required")
	}

	row := database.QueryRow(`
		SELECT id, name, description, content, language, tags_json, executions, author, created_at, updated_at
		FROM desktop_scripts
		WHERE id = ?`, id)

	return scanDesktopScript(row)
}

func (s *DesktopScriptService) Create(input DesktopScriptInput) (DesktopScript, error) {
	database, err := s.database()
	if err != nil {
		return DesktopScript{}, err
	}

	script, tagsJSON, err := normalizeDesktopScriptInput(input)
	if err != nil {
		return DesktopScript{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	script.ID = newDesktopScriptID()
	script.Author = "desktop"
	script.CreatedAt = now
	script.UpdatedAt = now

	tx, err := database.Begin()
	if err != nil {
		return DesktopScript{}, err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`
		INSERT INTO desktop_scripts (
			id, name, description, content, language, tags_json, executions, author, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		script.ID, script.Name, script.Description, script.Content, script.Language,
		tagsJSON, script.Executions, script.Author, script.CreatedAt, script.UpdatedAt)
	if err != nil {
		return DesktopScript{}, err
	}

	if err = recordDesktopConfiguration(tx, "script_created", "script", script.ID, script.Name, "manual", []string{"created"}, nil); err != nil {
		return DesktopScript{}, err
	}
	if err = tx.Commit(); err != nil {
		return DesktopScript{}, err
	}
	script.Version = scriptutil.Version(script.Language, script.Content)
	return script, nil
}

func (s *DesktopScriptService) Update(id string, input DesktopScriptInput) (DesktopScript, error) {
	database, err := s.database()
	if err != nil {
		return DesktopScript{}, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return DesktopScript{}, errors.New("script id is required")
	}

	script, tagsJSON, err := normalizeDesktopScriptInput(input)
	if err != nil {
		return DesktopScript{}, err
	}

	tx, err := database.Begin()
	if err != nil {
		return DesktopScript{}, err
	}
	defer tx.Rollback()
	current, err := scanDesktopScript(tx.QueryRow(`SELECT id,name,description,content,language,tags_json,executions,author,created_at,updated_at FROM desktop_scripts WHERE id=?`, id))
	if err != nil {
		return DesktopScript{}, err
	}
	fields := []string{}
	for _, f := range []struct {
		name    string
		changed bool
	}{{"name", current.Name != script.Name}, {"description", current.Description != script.Description}, {"content", current.Content != script.Content}, {"language", current.Language != script.Language}, {"tags", !slices.Equal(current.Tags, script.Tags)}} {
		if f.changed {
			fields = append(fields, f.name)
		}
	}
	if len(fields) == 0 {
		if err = tx.Commit(); err != nil {
			return DesktopScript{}, err
		}
		return current, nil
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := tx.Exec(`
		UPDATE desktop_scripts
		SET name = ?, description = ?, content = ?, language = ?, tags_json = ?, updated_at = ?
		WHERE id = ?`,
		script.Name, script.Description, script.Content, script.Language, tagsJSON, now, id)
	if err != nil {
		return DesktopScript{}, err
	}

	if changed, _ := result.RowsAffected(); changed == 0 {
		return DesktopScript{}, sql.ErrNoRows
	}

	if err = recordDesktopConfiguration(tx, "script_updated", "script", id, script.Name, "manual", fields, nil); err != nil {
		return DesktopScript{}, err
	}
	if err = tx.Commit(); err != nil {
		return DesktopScript{}, err
	}
	script.ID, script.CreatedAt, script.UpdatedAt, script.Author, script.Executions = current.ID, current.CreatedAt, now, current.Author, current.Executions
	script.Version = scriptutil.Version(script.Language, script.Content)
	s.invalidateScript(id, script.Version)
	return script, nil
}

func (s *DesktopScriptService) Delete(id string) error {
	database, err := s.database()
	if err != nil {
		return err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("script id is required")
	}

	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var name string
	if err = tx.QueryRow("SELECT name FROM desktop_scripts WHERE id=?", id).Scan(&name); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM desktop_scripts WHERE id=?", id); err != nil {
		return err
	}
	if err = recordDesktopConfiguration(tx, "script_deleted", "script", id, name, "manual", []string{"deleted"}, nil); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	s.invalidateScript(id, "")
	return nil
}

// Execute creates the same durable work item as the server script endpoint.
func (s *DesktopScriptService) Execute(id string, input DesktopBatchTaskInput) (DesktopBatchTaskStartResult, error) {
	script, err := s.GetById(id)
	if err != nil {
		return DesktopBatchTaskStartResult{}, err
	}
	input.TaskName, input.TaskType, input.ScriptID, input.Content = script.Name, "script", id, ""
	task, err := s.CreateBatchTask(input)
	if err != nil {
		return DesktopBatchTaskStartResult{}, err
	}
	return s.StartBatchTask(task.ID)
}

func (s *DesktopScriptService) CreateBatchTask(input DesktopBatchTaskInput) (DesktopBatchTask, error) {
	database, err := s.database()
	if err != nil {
		return DesktopBatchTask{}, err
	}

	task, serverIDsJSON, err := normalizeDesktopBatchTaskInput(input)
	if err != nil {
		return DesktopBatchTask{}, err
	}

	if task.TaskType == "script" {
		script, err := s.GetById(task.ScriptID)
		if err != nil {
			return DesktopBatchTask{}, err
		}
		if task.ScriptVersion != "" && task.ScriptVersion != script.Version {
			return DesktopBatchTask{}, errors.New("script version changed")
		}
		task.ScriptVersion = script.Version
	}
	if _, err := s.resolveBatchTaskCommand(task); err != nil {
		return DesktopBatchTask{}, err
	}
	for _, serverID := range task.ServerIDs {
		if _, err := s.serverService.GetById(serverID); err != nil {
			return DesktopBatchTask{}, err
		}
	}
	parametersJSON, err := json.Marshal(task.Parameters)
	if err != nil {
		return DesktopBatchTask{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	task.ID = newDesktopBatchTaskID()
	task.Status = "pending"
	task.CreatedAt = now
	task.UpdatedAt = now

	_, err = database.Exec(`
		INSERT INTO desktop_batch_tasks (
			id, task_name, task_type, content, script_id, script_version, parameters_json, server_ids_json,
			execution_mode, status, success_count, failed_count, started_at, completed_at,
			duration, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		task.ID, task.TaskName, task.TaskType, task.Content, task.ScriptID, task.ScriptVersion, string(parametersJSON), serverIDsJSON,
		task.ExecutionMode, task.Status, task.SuccessCount, task.FailedCount, task.StartedAt,
		task.CompletedAt, task.Duration, task.CreatedAt, task.UpdatedAt)
	if err != nil {
		return DesktopBatchTask{}, err
	}

	return s.GetBatchTaskById(task.ID)
}

func (s *DesktopScriptService) GetBatchTaskById(id string) (DesktopBatchTask, error) {
	database, err := s.database()
	if err != nil {
		return DesktopBatchTask{}, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return DesktopBatchTask{}, errors.New("batch task id is required")
	}

	row := database.QueryRow(`
		SELECT id, task_name, task_type, content, script_id, script_version, parameters_json, server_ids_json,
			execution_mode, status, success_count, failed_count, started_at, completed_at,
			duration, created_at, updated_at
		FROM desktop_batch_tasks
		WHERE id = ?`, id)

	return scanDesktopBatchTask(row)
}

func (s *DesktopScriptService) ListBatchTasks(params DesktopBatchTaskListParams) (DesktopBatchTaskListResult, error) {
	database, err := s.database()
	if err != nil {
		return DesktopBatchTaskListResult{}, err
	}

	params = normalizeDesktopBatchTaskListParams(params)
	where, args := buildDesktopBatchTaskWhere(params)

	var total int
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM desktop_batch_tasks WHERE %s", where)
	if err := database.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return DesktopBatchTaskListResult{}, err
	}

	offset := (params.Page - 1) * params.Limit
	queryArgs := append(append([]any{}, args...), params.Limit, offset)
	querySQL := fmt.Sprintf(`
		SELECT id, task_name, task_type, content, script_id, script_version, parameters_json, server_ids_json,
			execution_mode, status, success_count, failed_count, started_at, completed_at,
			duration, created_at, updated_at
		FROM desktop_batch_tasks
		WHERE %s
		ORDER BY created_at DESC, id DESC
		LIMIT ? OFFSET ?`, where)

	rows, err := database.Query(querySQL, queryArgs...)
	if err != nil {
		return DesktopBatchTaskListResult{}, err
	}
	defer rows.Close()

	tasks := make([]DesktopBatchTask, 0)
	for rows.Next() {
		task, err := scanDesktopBatchTask(rows)
		if err != nil {
			return DesktopBatchTaskListResult{}, err
		}
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return DesktopBatchTaskListResult{}, err
	}

	totalPages := 0
	if total > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(params.Limit)))
	}

	return DesktopBatchTaskListResult{
		Data:       tasks,
		Total:      total,
		Page:       params.Page,
		Limit:      params.Limit,
		TotalPages: totalPages,
	}, nil
}

func (s *DesktopScriptService) StartBatchTask(id string) (DesktopBatchTaskStartResult, error) {

	id = strings.TrimSpace(id)
	if id == "" {
		return DesktopBatchTaskStartResult{}, errors.New("batch task id is required")
	}

	task, err := s.GetBatchTaskById(id)
	if err != nil {
		return DesktopBatchTaskStartResult{}, err
	}
	if task.Status != "pending" {
		return DesktopBatchTaskStartResult{}, errors.New("task is not in pending status")
	}

	if s.taskCenter == nil {
		return DesktopBatchTaskStartResult{}, errors.New("task center is unavailable")
	}
	if _, err := s.resolveBatchTaskCommand(task); err != nil {
		return DesktopBatchTaskStartResult{}, err
	}
	s.executionMu.Lock()
	if s.closed {
		s.executionMu.Unlock()
		return DesktopBatchTaskStartResult{}, errors.New("script service is closed")
	}
	if len(s.executions) >= 4 {
		s.executionMu.Unlock()
		return DesktopBatchTaskStartResult{}, errors.New("batch execution capacity reached")
	}
	if _, exists := s.executions[id]; exists {
		s.executionMu.Unlock()
		return DesktopBatchTaskStartResult{}, errors.New("task is already running")
	}
	ctx, cancel := context.WithCancel(s.runCtx)
	s.executions[id] = desktopScriptExecution{scriptID: task.ScriptID, version: task.ScriptVersion, cancel: cancel}
	s.workerWG.Add(1)
	s.executionMu.Unlock()
	started := false
	cleanup := func() {
		cancel()
		s.executionMu.Lock()
		delete(s.executions, id)
		s.executionMu.Unlock()
		s.workerWG.Done()
	}
	defer func() {
		if !started {
			cleanup()
		}
	}()

	payload, err := json.Marshal(task)
	if err != nil {
		return DesktopBatchTaskStartResult{}, err
	}
	runID, err := s.taskCenter.create(desktopTaskCreateInput{Actor: desktopLocalActor(),
		ID: task.ID, TaskType: task.TaskType, Title: task.TaskName, SourceType: "desktop_batch_task", SourceID: task.ID,
		Resource: strings.Join(task.ServerIDs, ","), PayloadJSON: string(payload), TotalCount: len(task.ServerIDs), Cancelable: true, Retryable: false,
	})
	if err == nil {
		err = s.taskCenter.start(runID, "executing")
	}
	if err != nil {
		if runID != "" {
			_ = s.taskCenter.complete(runID, "failed", "", "start_failed", err.Error(), 0, len(task.ServerIDs))
		}
		return DesktopBatchTaskStartResult{}, err
	}

	started = true
	go func() { defer cleanup(); s.runBatchTask(ctx, id, runID) }()

	return DesktopBatchTaskStartResult{TaskID: runID, BatchTaskID: task.ID, Status: "running"}, nil
}

func (s *DesktopScriptService) database() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db != nil {
		return s.db, nil
	}

	dataDir := desktopDataDir()
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create desktop data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "easyssh-desktop.sqlite")
	database, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}

	if err := configureDesktopDatabase(database); err != nil {
		database.Close()
		return nil, err
	}

	s.db = database
	return s.db, nil
}

func (s *DesktopScriptService) runBatchTask(parent context.Context, taskID string, runID string) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	task, err := s.GetBatchTaskById(taskID)
	if err != nil {
		_ = s.taskCenter.complete(runID, "failed", "", "batch_task_load_failed", err.Error(), 0, 0)
		return
	}
	command, err := s.resolveBatchTaskCommand(task)
	if err != nil {
		_ = s.taskCenter.complete(runID, "failed", "", "batch_task_invalid", err.Error(), 0, 0)
		return
	}
	results := make(chan desktopScriptTargetOutcome, len(task.ServerIDs))
	var storageDegraded atomic.Bool
	execute := func(serverID string) {
		select {
		case s.executionSlots <- struct{}{}:
			defer func() { <-s.executionSlots }()
		case <-ctx.Done():
		}
		observed := s.executeBatchTaskOnServer(ctx, task, serverID, command)
		if observed.Result.Status == "unknown" {
			cancel()
		}
		if storageDegraded.Load() {
			observed.PersistenceError = errors.New("task_result_not_saved")
		} else {
			observed.PersistenceError = s.recordBatchTaskResult(observed.Result)
		}
		if observed.PersistenceError != nil {
			storageDegraded.Store(true)
			cancel()
		}
		results <- observed
	}
	go func() {
		if task.ExecutionMode == "sequential" {
			for _, id := range task.ServerIDs {
				execute(id)
			}
		} else {
			var wg sync.WaitGroup
			for _, id := range task.ServerIDs {
				wg.Add(1)
				go func(id string) { defer wg.Done(); execute(id) }(id)
			}
			wg.Wait()
		}
		close(results)
	}()
	targets := make([]desktopBatchTaskResult, 0, len(task.ServerIDs))
	successCount, failedCount, canceledCount, unknownCount := 0, 0, 0, 0
	storageFailed := false
	for observed := range results {
		targets = append(targets, observed.Result)
		switch observed.Result.Status {
		case "success":
			successCount++
		case "canceled":
			canceledCount++
		case "unknown":
			unknownCount++
		default:
			failedCount++
		}
		if observed.PersistenceError != nil {
			storageFailed = true
		}
		if !storageDegraded.Load() {
			if err := s.taskCenter.updateProgress(runID, desktopSFTPProgressPercent(int64(len(targets)), int64(len(task.ServerIDs))), "executing", 0, 0, successCount, failedCount); err != nil {
				storageFailed = true
				storageDegraded.Store(true)
				cancel()
			}
		}
	}
	status := "failed"
	switch {
	case unknownCount > 0:
		status = "unknown"
	case successCount == len(task.ServerIDs):
		status = "succeeded"
	case canceledCount > 0:
		status = "canceled"
	case successCount > 0:
		status = "partial_success"
	}
	result, _ := json.Marshal(map[string]int{"success_count": successCount, "failure_count": failedCount, "canceled_count": canceledCount, "unknown_count": unknownCount})
	outcome := desktopTaskCompletion{Status: status, ResultJSON: string(result), SuccessCount: successCount, FailureCount: failedCount, Targets: targets}
	if storageFailed && canceledCount > 0 {
		outcome.ErrorCode = "persistence_interrupted"
		outcome.ErrorMessage = "结果保存异常，已停止后续目标；最终状态以已保存记录为准"
	}
	if err := s.taskCenter.completeOutcome(runID, outcome); err != nil {
		desktopLogPrintf("batch result storage failed: %s", runID)
	}
}

type desktopScriptTargetOutcome struct {
	Result           desktopBatchTaskResult
	PersistenceError error
}

func (s *DesktopScriptService) CancelDesktopTask(taskID string) bool {
	s.executionMu.Lock()
	defer s.executionMu.Unlock()
	run, ok := s.executions[taskID]
	if ok {
		run.cancel()
	}
	return ok
}

func (s *DesktopScriptService) RetryDesktopTask(run DesktopTaskRun) (string, error) {
	return "", errors.New("create a new execution after reviewing the previous result")
}

// version is the new committed version; empty means the script was deleted.
func (s *DesktopScriptService) invalidateScript(id, version string) {
	s.executionMu.Lock()
	defer s.executionMu.Unlock()
	for _, run := range s.executions {
		if run.scriptID == id && run.version != version {
			run.cancel()
		}
	}
}

func (s *DesktopScriptService) resolveBatchTaskCommand(task DesktopBatchTask) (string, error) {
	if task.TaskType == "command" {
		return task.Content, nil
	}
	script, err := s.GetById(task.ScriptID)
	if err != nil {
		return "", err
	}
	if task.ScriptVersion == "" || script.Version != task.ScriptVersion {
		return "", errors.New("script version changed; confirm the current version before executing")
	}
	return scriptutil.Command(script.Language, script.Content, task.Parameters)
}

func (s *DesktopScriptService) executeBatchTaskOnServer(ctx context.Context, task DesktopBatchTask, serverID string, command string) desktopScriptTargetOutcome {
	started := time.Now().UTC()
	result := desktopBatchTaskResult{
		ID:        uuid.NewSHA1(uuid.NameSpaceOID, []byte("desktop-target:"+task.ID+":"+serverID)).String(),
		TaskID:    task.ID,
		ServerID:  strings.TrimSpace(serverID),
		Status:    "failed",
		StartedAt: started.Format(time.RFC3339Nano),
	}

	if err := ctx.Err(); err != nil {
		result.Status = "canceled"
		result.ErrorMessage = err.Error()
		return s.finishBatchTaskServerResult(result, started)
	}
	server, err := s.serverService.GetById(serverID)
	if err != nil {
		result.ErrorMessage = err.Error()
		result.Output = err.Error()
		return s.finishBatchTaskServerResult(result, started)
	}

	result.ServerName = server.Name
	result.ServerHost = server.Host

	if task.TaskType == "script" {
		if err := s.recordExecution(task.ScriptID, task.ScriptVersion); err != nil {
			result.ErrorMessage = err.Error()
			return s.finishBatchTaskServerResult(result, started)
		}
	}

	commandResult, err := s.serverService.executeCommandContext(ctx, DesktopServerCommandInput{
		ServerID:  serverID,
		Command:   command,
		TimeoutMs: 120000,
	})
	if err != nil {
		result.ErrorMessage = err.Error()
		result.Output = err.Error()
		return s.finishBatchTaskServerResult(result, started)
	}

	if commandResult.ExitCode != nil {
		result.ExitCode = sql.NullInt64{Int64: int64(*commandResult.ExitCode), Valid: true}
	}
	result.Output = commandResult.Output
	result.ErrorMessage = commandResult.Error
	result.Status = commandResult.Outcome
	if commandResult.Outcome == "succeeded" {
		result.Status = "success"
	}

	return s.finishBatchTaskServerResult(result, started)
}

func (s *DesktopScriptService) finishBatchTaskServerResult(result desktopBatchTaskResult, started time.Time) desktopScriptTargetOutcome {
	completed := time.Now().UTC()
	result.CompletedAt = completed.Format(time.RFC3339Nano)
	result.DurationMs = completed.Sub(started).Milliseconds()
	const maxStoredTargetOutput = 64 << 10
	if len(result.Output) > maxStoredTargetOutput {
		result.Output = strings.ToValidUTF8(result.Output[:maxStoredTargetOutput], "") + "\n[output truncated]"
	}
	if len(result.ErrorMessage) > 4096 {
		result.ErrorMessage = strings.ToValidUTF8(result.ErrorMessage[:4096], "")
	}
	return desktopScriptTargetOutcome{Result: result}
}

func (s *DesktopScriptService) recordExecution(id, version string) error {
	database, err := s.database()
	if err != nil {
		return err
	}
	script, err := s.GetById(id)
	if err != nil {
		return err
	}
	if script.Version != version {
		return errors.New("script version changed")
	}
	result, err := database.Exec(`UPDATE desktop_scripts SET executions = executions + 1 WHERE id = ? AND content = ? AND language = ?`, id, script.Content, script.Language)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed != 1 {
		return errors.New("script version changed")
	}
	return nil
}

func (s *DesktopScriptService) recordBatchTaskResult(result desktopBatchTaskResult) error {
	database, err := s.database()
	if err != nil {
		return err
	}
	return resultstore.Write(context.Background(), func(ctx context.Context) error {
		desktopInstanceFilesMu.RLock()
		defer desktopInstanceFilesMu.RUnlock()
		tx, err := database.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if err := saveDesktopTaskTarget(tx, result); err != nil {
			return err
		}
		return tx.Commit()
	})
}

func normalizeDesktopScriptInput(input DesktopScriptInput) (DesktopScript, string, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return DesktopScript{}, "", errors.New("script name is required")
	}

	if strings.TrimSpace(input.Content) == "" {
		return DesktopScript{}, "", errors.New("script content is required")
	}

	language := strings.TrimSpace(input.Language)
	if language == "" {
		language = "bash"
	}

	if _, err := scriptutil.Command(language, input.Content, nil); err != nil {
		return DesktopScript{}, "", err
	}
	tags := normalizeDesktopScriptTags(input.Tags)
	if err := scriptutil.ValidateMetadata(name, strings.TrimSpace(input.Description), tags); err != nil {
		return DesktopScript{}, "", err
	}
	tagsJSONBytes, err := json.Marshal(tags)
	if err != nil {
		return DesktopScript{}, "", err
	}

	return DesktopScript{
		Name:        name,
		Description: strings.TrimSpace(input.Description),
		Content:     input.Content,
		Language:    language,
		Tags:        tags,
		Author:      "desktop",
	}, string(tagsJSONBytes), nil
}

func normalizeDesktopScriptListParams(params DesktopScriptListParams) DesktopScriptListParams {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.Limit < 1 {
		params.Limit = 20
	}
	if params.Limit > 1000 {
		params.Limit = 1000
	}

	params.Search = strings.TrimSpace(params.Search)
	params.Language = strings.TrimSpace(params.Language)
	params.Tags = normalizeDesktopScriptTags(params.Tags)
	return params
}

func buildDesktopScriptWhere(params DesktopScriptListParams) (string, []any) {
	params = normalizeDesktopScriptListParams(params)
	clauses := []string{"1 = 1"}
	args := make([]any, 0)

	if params.Search != "" {
		like := "%" + strings.ToLower(params.Search) + "%"
		clauses = append(clauses, `(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags_json) LIKE ?)`)
		args = append(args, like, like, like, like)
	}

	if params.Language != "" {
		clauses = append(clauses, "language = ?")
		args = append(args, params.Language)
	}

	for _, tag := range params.Tags {
		clauses = append(clauses, "LOWER(tags_json) LIKE ?")
		args = append(args, "%"+strings.ToLower(tag)+"%")
	}

	return strings.Join(clauses, " AND "), args
}

func normalizeDesktopBatchTaskInput(input DesktopBatchTaskInput) (DesktopBatchTask, string, error) {
	taskName := strings.TrimSpace(input.TaskName)
	if taskName == "" {
		return DesktopBatchTask{}, "", errors.New("task name is required")
	}

	taskType := strings.TrimSpace(input.TaskType)
	if taskType == "" {
		taskType = "script"
	}
	switch taskType {
	case "command", "script":
	default:
		return DesktopBatchTask{}, "", fmt.Errorf("unsupported task type: %s", taskType)
	}

	serverIDs := normalizeDesktopStringList(input.ServerIDs)
	if len(serverIDs) == 0 || len(serverIDs) > 100 {
		return DesktopBatchTask{}, "", errors.New("server_ids cannot be empty")
	}

	for _, id := range serverIDs {
		parsed, err := uuid.Parse(id)
		if err != nil || parsed == uuid.Nil {
			return DesktopBatchTask{}, "", errors.New("invalid server id")
		}
	}
	if err := scriptutil.ValidateParameters(input.Parameters); err != nil {
		return DesktopBatchTask{}, "", err
	}
	if taskType == "script" {
		if input.ScriptID == "" || input.Content != "" {
			return DesktopBatchTask{}, "", errors.New("script task requires a stored script and no inline command")
		}
	} else if strings.TrimSpace(input.Content) == "" || len(input.Content) > 1<<20 || strings.ContainsRune(input.Content, 0) || input.ScriptID != "" || input.ScriptVersion != "" || len(input.Parameters) != 0 {
		return DesktopBatchTask{}, "", errors.New("invalid command task")
	}

	executionMode := strings.TrimSpace(input.ExecutionMode)
	if executionMode == "" {
		executionMode = "parallel"
	}
	if executionMode != "parallel" && executionMode != "sequential" {
		return DesktopBatchTask{}, "", fmt.Errorf("unsupported execution mode: %s", executionMode)
	}

	serverIDsJSONBytes, err := json.Marshal(serverIDs)
	if err != nil {
		return DesktopBatchTask{}, "", err
	}

	return DesktopBatchTask{
		TaskName:      taskName,
		TaskType:      taskType,
		Content:       input.Content,
		ScriptID:      strings.TrimSpace(input.ScriptID),
		ScriptVersion: input.ScriptVersion,
		Parameters:    input.Parameters,
		ServerIDs:     serverIDs,
		ExecutionMode: executionMode,
	}, string(serverIDsJSONBytes), nil
}

func normalizeDesktopBatchTaskListParams(params DesktopBatchTaskListParams) DesktopBatchTaskListParams {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.Limit < 1 {
		params.Limit = 20
	}
	if params.Limit > 500 {
		params.Limit = 500
	}

	params.Status = strings.TrimSpace(params.Status)
	params.TaskType = strings.TrimSpace(params.TaskType)
	return params
}

func buildDesktopBatchTaskWhere(params DesktopBatchTaskListParams) (string, []any) {
	params = normalizeDesktopBatchTaskListParams(params)
	clauses := []string{"1 = 1"}
	args := make([]any, 0)

	if params.Status != "" {
		clauses = append(clauses, "status = ?")
		args = append(args, params.Status)
	}

	if params.TaskType != "" {
		clauses = append(clauses, "task_type = ?")
		args = append(args, params.TaskType)
	}

	return strings.Join(clauses, " AND "), args
}

func normalizeDesktopScriptTags(tags []string) []string {
	return normalizeDesktopStringList(tags)
}

func normalizeDesktopStringList(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

type desktopScriptScanner interface {
	Scan(dest ...any) error
}

func scanDesktopScripts(rows *sql.Rows) ([]DesktopScript, error) {
	scripts := make([]DesktopScript, 0)
	for rows.Next() {
		script, err := scanDesktopScript(rows)
		if err != nil {
			return nil, err
		}
		scripts = append(scripts, script)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return scripts, nil
}

func scanDesktopScript(scanner desktopScriptScanner) (DesktopScript, error) {
	var script DesktopScript
	var tagsJSON string

	err := scanner.Scan(
		&script.ID,
		&script.Name,
		&script.Description,
		&script.Content,
		&script.Language,
		&tagsJSON,
		&script.Executions,
		&script.Author,
		&script.CreatedAt,
		&script.UpdatedAt,
	)
	if err != nil {
		return DesktopScript{}, err
	}

	if strings.TrimSpace(tagsJSON) != "" {
		if err := json.Unmarshal([]byte(tagsJSON), &script.Tags); err != nil {
			script.Tags = []string{}
		}
	}

	if script.Tags == nil {
		script.Tags = []string{}
	}

	script.Version = scriptutil.Version(script.Language, script.Content)
	return script, nil
}

func scanDesktopBatchTask(scanner desktopScriptScanner) (DesktopBatchTask, error) {
	var task DesktopBatchTask
	var serverIDsJSON, parametersJSON string

	err := scanner.Scan(
		&task.ID,
		&task.TaskName,
		&task.TaskType,
		&task.Content,
		&task.ScriptID,
		&task.ScriptVersion,
		&parametersJSON,
		&serverIDsJSON,
		&task.ExecutionMode,
		&task.Status,
		&task.SuccessCount,
		&task.FailedCount,
		&task.StartedAt,
		&task.CompletedAt,
		&task.Duration,
		&task.CreatedAt,
		&task.UpdatedAt,
	)
	if err != nil {
		return DesktopBatchTask{}, err
	}

	if err := json.Unmarshal([]byte(parametersJSON), &task.Parameters); err != nil {
		return DesktopBatchTask{}, err
	}
	if strings.TrimSpace(serverIDsJSON) != "" {
		if err := json.Unmarshal([]byte(serverIDsJSON), &task.ServerIDs); err != nil {
			task.ServerIDs = []string{}
		}
	}

	if task.ServerIDs == nil {
		task.ServerIDs = []string{}
	}

	return task, nil
}

func newDesktopScriptID() string    { return uuid.NewString() }
func newDesktopBatchTaskID() string { return uuid.NewString() }
