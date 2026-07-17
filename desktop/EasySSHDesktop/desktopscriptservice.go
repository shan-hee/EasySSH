package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

type DesktopScript struct {
	ID          string   `json:"id"`
	UserID      string   `json:"user_id"`
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
	ID            string   `json:"id"`
	UserID        string   `json:"user_id"`
	TaskName      string   `json:"task_name"`
	TaskType      string   `json:"task_type"`
	Content       string   `json:"content"`
	ScriptID      string   `json:"script_id,omitempty"`
	ServerIDs     []string `json:"server_ids"`
	ExecutionMode string   `json:"execution_mode"`
	Status        string   `json:"status"`
	SuccessCount  int      `json:"success_count"`
	FailedCount   int      `json:"failed_count"`
	StartedAt     string   `json:"started_at,omitempty"`
	CompletedAt   string   `json:"completed_at,omitempty"`
	Duration      int      `json:"duration,omitempty"`
	CreatedAt     string   `json:"created_at"`
	UpdatedAt     string   `json:"updated_at"`
}

type DesktopBatchTaskInput struct {
	TaskName      string   `json:"task_name"`
	TaskType      string   `json:"task_type"`
	Content       string   `json:"content,omitempty"`
	ScriptID      string   `json:"script_id,omitempty"`
	ServerIDs     []string `json:"server_ids"`
	ExecutionMode string   `json:"execution_mode,omitempty"`
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
	Message string `json:"message"`
}

type desktopBatchTaskResult struct {
	ID           string
	TaskID       string
	ServerID     string
	ServerName   string
	ServerHost   string
	Status       string
	ExitCode     int
	Output       string
	ErrorMessage string
	StartedAt    string
	CompletedAt  string
	DurationMs   int64
}

type DesktopScriptService struct {
	mu             sync.Mutex
	db             *sql.DB
	serverService  *DesktopServerService
	activityLogger *ActivityLogService
	taskCenter     *DesktopTaskService
}

func NewDesktopScriptService(serverService *DesktopServerService, activityLogger *ActivityLogService, taskCenter *DesktopTaskService) *DesktopScriptService {
	return &DesktopScriptService{
		serverService:  serverService,
		activityLogger: activityLogger,
		taskCenter:     taskCenter,
	}
}

func (s *DesktopScriptService) ServiceName() string {
	return "DesktopScriptService"
}

func (s *DesktopScriptService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	_, err := s.database()
	return err
}

func (s *DesktopScriptService) ServiceShutdown() error {
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
		SELECT id, user_id, name, description, content, language, tags_json, executions, author, created_at, updated_at
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
		SELECT id, user_id, name, description, content, language, tags_json, executions, author, created_at, updated_at
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
	script.UserID = desktopLocalDataUserID
	script.Author = "desktop"
	script.CreatedAt = now
	script.UpdatedAt = now

	_, err = database.Exec(`
		INSERT INTO desktop_scripts (
			id, user_id, name, description, content, language, tags_json, executions, author, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		script.ID, script.UserID, script.Name, script.Description, script.Content, script.Language,
		tagsJSON, script.Executions, script.Author, script.CreatedAt, script.UpdatedAt)
	if err != nil {
		return DesktopScript{}, err
	}

	return s.GetById(script.ID)
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

	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := database.Exec(`
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

	return s.GetById(id)
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

	_, err = database.Exec("DELETE FROM desktop_scripts WHERE id = ?", id)
	return err
}

func (s *DesktopScriptService) Execute(id string) error {
	return s.incrementExecutions(id)
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

	if task.TaskType == "script" && task.Content == "" && task.ScriptID != "" {
		script, err := s.GetById(task.ScriptID)
		if err != nil {
			return DesktopBatchTask{}, err
		}
		task.Content = script.Content
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	task.ID = newDesktopBatchTaskID()
	task.UserID = desktopLocalDataUserID
	task.Status = "pending"
	task.CreatedAt = now
	task.UpdatedAt = now

	_, err = database.Exec(`
		INSERT INTO desktop_batch_tasks (
			id, user_id, task_name, task_type, content, script_id, server_ids_json,
			execution_mode, status, success_count, failed_count, started_at, completed_at,
			duration, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		task.ID, task.UserID, task.TaskName, task.TaskType, task.Content, task.ScriptID, serverIDsJSON,
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
		SELECT id, user_id, task_name, task_type, content, script_id, server_ids_json,
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
		SELECT id, user_id, task_name, task_type, content, script_id, server_ids_json,
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
	database, err := s.database()
	if err != nil {
		return DesktopBatchTaskStartResult{}, err
	}

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

	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := database.Exec(`
		UPDATE desktop_batch_tasks
		SET status = ?, started_at = ?, updated_at = ?
		WHERE id = ? AND status = 'pending'`, "running", now, now, id)
	if err != nil {
		return DesktopBatchTaskStartResult{}, err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return DesktopBatchTaskStartResult{}, errors.New("task is not in pending status")
	}

	if task.ScriptID != "" {
		if err := s.incrementExecutions(task.ScriptID); err != nil {
			desktopLogPrintf("failed to increment desktop script executions: %v", err)
		}
	}

	runID := ""
	if s.taskCenter != nil {
		runID, _ = s.taskCenter.create(desktopTaskCreateInput{
			TaskType: task.TaskType, Title: task.TaskName, SourceType: "desktop_batch_task", SourceID: task.ID,
			Resource: strings.Join(task.ServerIDs, ","), TotalCount: len(task.ServerIDs), Cancelable: false, Retryable: false,
		})
		if runID != "" {
			_ = s.taskCenter.setPayload(runID, task)
			_ = s.taskCenter.start(runID, "executing")
		}
	}

	go s.runBatchTask(id, runID)

	return DesktopBatchTaskStartResult{Message: "batch task started"}, nil
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

	if err := configureDesktopScriptDatabase(database); err != nil {
		database.Close()
		return nil, err
	}

	s.db = database
	return s.db, nil
}

func configureDesktopScriptDatabase(database *sql.DB) error {
	database.SetMaxOpenConns(1)

	statements := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
		`CREATE TABLE IF NOT EXISTS desktop_scripts (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'local',
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			content TEXT NOT NULL,
			language TEXT NOT NULL DEFAULT 'bash',
			tags_json TEXT NOT NULL DEFAULT '[]',
			executions INTEGER NOT NULL DEFAULT 0,
			author TEXT NOT NULL DEFAULT 'desktop',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		"CREATE INDEX IF NOT EXISTS idx_desktop_scripts_name ON desktop_scripts (name)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_scripts_language ON desktop_scripts (language)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_scripts_updated_at ON desktop_scripts (updated_at DESC)",
		`CREATE TABLE IF NOT EXISTS desktop_batch_tasks (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'local',
			task_name TEXT NOT NULL,
			task_type TEXT NOT NULL,
			content TEXT NOT NULL DEFAULT '',
			script_id TEXT NOT NULL DEFAULT '',
			server_ids_json TEXT NOT NULL DEFAULT '[]',
			execution_mode TEXT NOT NULL DEFAULT 'parallel',
			status TEXT NOT NULL DEFAULT 'pending',
			success_count INTEGER NOT NULL DEFAULT 0,
			failed_count INTEGER NOT NULL DEFAULT 0,
			started_at TEXT NOT NULL DEFAULT '',
			completed_at TEXT NOT NULL DEFAULT '',
			duration INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		"CREATE INDEX IF NOT EXISTS idx_desktop_batch_tasks_created_at ON desktop_batch_tasks (created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_batch_tasks_status ON desktop_batch_tasks (status)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_batch_tasks_type ON desktop_batch_tasks (task_type)",
		`CREATE TABLE IF NOT EXISTS desktop_batch_task_results (
			id TEXT PRIMARY KEY,
			task_id TEXT NOT NULL,
			server_id TEXT NOT NULL DEFAULT '',
			server_name TEXT NOT NULL DEFAULT '',
			server_host TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL,
			exit_code INTEGER NOT NULL DEFAULT 0,
			output TEXT NOT NULL DEFAULT '',
			error_message TEXT NOT NULL DEFAULT '',
			started_at TEXT NOT NULL,
			completed_at TEXT NOT NULL,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
		)`,
		"CREATE INDEX IF NOT EXISTS idx_desktop_batch_results_task ON desktop_batch_task_results (task_id)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_batch_results_server ON desktop_batch_task_results (server_id)",
	}

	for _, statement := range statements {
		if _, err := database.Exec(statement); err != nil {
			return err
		}
	}

	return database.Ping()
}

func (s *DesktopScriptService) runBatchTask(taskID string, runID string) {
	task, err := s.GetBatchTaskById(taskID)
	if err != nil {
		desktopLogPrintf("failed to load desktop batch task: %v", err)
		if s.taskCenter != nil && runID != "" {
			_ = s.taskCenter.complete(runID, "failed", "", "batch_task_load_failed", err.Error(), 0, 1)
		}
		return
	}

	command, err := s.resolveBatchTaskCommand(task)
	if err != nil {
		desktopLogPrintf("failed to resolve desktop batch task command: %v", err)
		_ = s.completeBatchTask(task.ID, 0, len(task.ServerIDs), "failed")
		if s.taskCenter != nil && runID != "" {
			_ = s.taskCenter.complete(runID, "failed", "", "batch_task_invalid", err.Error(), 0, len(task.ServerIDs))
		}
		return
	}

	if task.ExecutionMode == "sequential" {
		successCount := 0
		failedCount := 0
		for _, serverID := range task.ServerIDs {
			if s.executeBatchTaskOnServer(task, serverID, command) {
				successCount++
			} else {
				failedCount++
			}
			_ = s.updateBatchTaskProgress(task.ID, successCount, failedCount)
			s.updateTaskCenterBatchProgress(runID, successCount, failedCount, len(task.ServerIDs))
		}
		_ = s.completeBatchTask(task.ID, successCount, failedCount, desktopBatchTaskCompletionStatus(successCount, failedCount))
		s.completeTaskCenterBatch(runID, successCount, failedCount)
		return
	}

	var wg sync.WaitGroup
	results := make(chan bool, len(task.ServerIDs))
	for _, serverID := range task.ServerIDs {
		serverID := serverID
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- s.executeBatchTaskOnServer(task, serverID, command)
		}()
	}

	successCount := 0
	failedCount := 0
	go func() {
		wg.Wait()
		close(results)
	}()
	for ok := range results {
		if ok {
			successCount++
		} else {
			failedCount++
		}
		_ = s.updateBatchTaskProgress(task.ID, successCount, failedCount)
		s.updateTaskCenterBatchProgress(runID, successCount, failedCount, len(task.ServerIDs))
	}

	_ = s.completeBatchTask(task.ID, successCount, failedCount, desktopBatchTaskCompletionStatus(successCount, failedCount))
	s.completeTaskCenterBatch(runID, successCount, failedCount)
}

func (s *DesktopScriptService) updateTaskCenterBatchProgress(runID string, successCount int, failedCount int, total int) {
	if s.taskCenter == nil || runID == "" {
		return
	}
	processed := successCount + failedCount
	_ = s.taskCenter.updateProgress(runID, desktopSFTPProgressPercent(int64(processed), int64(total)), "executing", int64(processed), int64(total), successCount, failedCount)
}

func (s *DesktopScriptService) completeTaskCenterBatch(runID string, successCount int, failedCount int) {
	if s.taskCenter == nil || runID == "" {
		return
	}
	status := "failed"
	if successCount > 0 && failedCount == 0 {
		status = "succeeded"
	} else if successCount > 0 {
		status = "partial_success"
	}
	result, _ := json.Marshal(map[string]int{"success_count": successCount, "failure_count": failedCount})
	_ = s.taskCenter.complete(runID, status, string(result), "", "", successCount, failedCount)
}

func (s *DesktopScriptService) resolveBatchTaskCommand(task DesktopBatchTask) (string, error) {
	command := strings.TrimSpace(task.Content)
	if command != "" {
		return command, nil
	}

	if task.TaskType == "script" && task.ScriptID != "" {
		script, err := s.GetById(task.ScriptID)
		if err != nil {
			return "", err
		}
		command = strings.TrimSpace(script.Content)
	}

	if command == "" {
		return "", errors.New("batch task command is empty")
	}

	return command, nil
}

func (s *DesktopScriptService) executeBatchTaskOnServer(task DesktopBatchTask, serverID string, command string) bool {
	started := time.Now().UTC()
	result := desktopBatchTaskResult{
		ID:        newDesktopBatchTaskResultID(),
		TaskID:    task.ID,
		ServerID:  strings.TrimSpace(serverID),
		Status:    "failed",
		StartedAt: started.Format(time.RFC3339Nano),
	}

	server, err := s.serverService.GetById(serverID)
	if err != nil {
		result.ErrorMessage = err.Error()
		result.Output = err.Error()
		s.finishBatchTaskServerResult(result, started)
		return false
	}

	result.ServerName = server.Name
	result.ServerHost = server.Host

	commandResult, err := s.serverService.ExecuteCommand(DesktopServerCommandInput{
		ServerID:  serverID,
		Command:   command,
		TimeoutMs: 120000,
	})
	if err != nil {
		result.ErrorMessage = err.Error()
		result.Output = err.Error()
		s.finishBatchTaskServerResult(result, started)
		return false
	}

	result.ExitCode = commandResult.ExitCode
	result.Output = commandResult.Output
	if commandResult.ExitCode == 0 {
		result.Status = "success"
	} else {
		result.ErrorMessage = fmt.Sprintf("command exited with code %d", commandResult.ExitCode)
	}

	s.finishBatchTaskServerResult(result, started)
	return result.Status == "success"
}

func (s *DesktopScriptService) finishBatchTaskServerResult(result desktopBatchTaskResult, started time.Time) {
	completed := time.Now().UTC()
	result.CompletedAt = completed.Format(time.RFC3339Nano)
	result.DurationMs = completed.Sub(started).Milliseconds()

	if err := s.recordBatchTaskResult(result); err != nil {
		desktopLogPrintf("failed to record desktop batch task result: %v", err)
	}

	if s.activityLogger != nil {
		status := DesktopActivityLogSuccess
		detail := trimDesktopScriptDetail(result.Output)
		if result.Status != "success" {
			status = DesktopActivityLogFailure
			if result.ErrorMessage != "" {
				detail = result.ErrorMessage
			}
		}

		_, err := s.activityLogger.Record(DesktopActivityLogRecordInput{
			Action:     "script_execute",
			Resource:   result.TaskID,
			Status:     status,
			ServerID:   result.ServerID,
			DurationMs: result.DurationMs,
			Detail:     detail,
		})
		if err != nil {
			desktopLogPrintf("failed to record desktop script activity: %v", err)
		}
	}
}

func (s *DesktopScriptService) incrementExecutions(id string) error {
	database, err := s.database()
	if err != nil {
		return err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("script id is required")
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := database.Exec(`
		UPDATE desktop_scripts
		SET executions = executions + 1, updated_at = ?
		WHERE id = ?`, now, id)
	if err != nil {
		return err
	}

	if changed, _ := result.RowsAffected(); changed == 0 {
		return sql.ErrNoRows
	}

	return nil
}

func (s *DesktopScriptService) updateBatchTaskProgress(id string, successCount int, failedCount int) error {
	database, err := s.database()
	if err != nil {
		return err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = database.Exec(`
		UPDATE desktop_batch_tasks
		SET success_count = ?, failed_count = ?, updated_at = ?
		WHERE id = ?`, successCount, failedCount, now, id)
	return err
}

func (s *DesktopScriptService) completeBatchTask(id string, successCount int, failedCount int, status string) error {
	database, err := s.database()
	if err != nil {
		return err
	}

	task, err := s.GetBatchTaskById(id)
	if err != nil {
		return err
	}

	completed := time.Now().UTC()
	duration := 0
	if task.StartedAt != "" {
		if started, err := time.Parse(time.RFC3339Nano, task.StartedAt); err == nil {
			duration = int(completed.Sub(started).Seconds())
		}
	}

	_, err = database.Exec(`
		UPDATE desktop_batch_tasks
		SET status = ?, success_count = ?, failed_count = ?, completed_at = ?, duration = ?, updated_at = ?
		WHERE id = ?`, status, successCount, failedCount, completed.Format(time.RFC3339Nano), duration, completed.Format(time.RFC3339Nano), id)
	return err
}

func (s *DesktopScriptService) recordBatchTaskResult(result desktopBatchTaskResult) error {
	database, err := s.database()
	if err != nil {
		return err
	}

	_, err = database.Exec(`
		INSERT INTO desktop_batch_task_results (
			id, task_id, server_id, server_name, server_host, status, exit_code, output,
			error_message, started_at, completed_at, duration_ms, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		result.ID, result.TaskID, result.ServerID, result.ServerName, result.ServerHost,
		result.Status, result.ExitCode, result.Output, result.ErrorMessage, result.StartedAt,
		result.CompletedAt, result.DurationMs, result.CompletedAt)
	return err
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

	tags := normalizeDesktopScriptTags(input.Tags)
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
	if len(serverIDs) == 0 {
		return DesktopBatchTask{}, "", errors.New("server_ids cannot be empty")
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
		&script.UserID,
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

	return script, nil
}

func scanDesktopBatchTask(scanner desktopScriptScanner) (DesktopBatchTask, error) {
	var task DesktopBatchTask
	var serverIDsJSON string

	err := scanner.Scan(
		&task.ID,
		&task.UserID,
		&task.TaskName,
		&task.TaskType,
		&task.Content,
		&task.ScriptID,
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

func desktopBatchTaskCompletionStatus(successCount int, failedCount int) string {
	if successCount > 0 && failedCount == 0 {
		return "completed"
	}
	return "failed"
}

func trimDesktopScriptDetail(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 1000 {
		return value
	}
	return value[:1000]
}

func newDesktopScriptID() string {
	return newDesktopScriptPrefixedID("scr")
}

func newDesktopBatchTaskID() string {
	return newDesktopScriptPrefixedID("bt")
}

func newDesktopBatchTaskResultID() string {
	return newDesktopScriptPrefixedID("btr")
}

func newDesktopScriptPrefixedID(prefix string) string {
	var randomBytes [8]byte
	if _, err := rand.Read(randomBytes[:]); err == nil {
		return fmt.Sprintf("%s_%d_%s", prefix, time.Now().UnixNano(), hex.EncodeToString(randomBytes[:]))
	}
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}
