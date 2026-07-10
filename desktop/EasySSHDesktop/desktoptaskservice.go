package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

const (
	desktopTaskChangedEvent         = "desktop:task-center-changed"
	desktopTaskRetentionInterval    = 24 * time.Hour
	desktopTaskSuccessRetentionDays = 90
	desktopTaskFailureRetentionDays = 180
)

var desktopTaskTerminalStatuses = []string{"succeeded", "failed", "partial_success", "canceled", "timeout"}

type DesktopTaskRun struct {
	ID                string `json:"id"`
	UserID            string `json:"user_id"`
	DefinitionID      string `json:"definition_id,omitempty"`
	RetryOfID         string `json:"retry_of_id,omitempty"`
	SourceType        string `json:"source_type,omitempty"`
	SourceID          string `json:"source_id,omitempty"`
	TaskType          string `json:"task_type"`
	Title             string `json:"title"`
	Description       string `json:"description,omitempty"`
	TriggerType       string `json:"trigger_type"`
	Runner            string `json:"runner"`
	Status            string `json:"status"`
	Stage             string `json:"stage,omitempty"`
	ServerID          string `json:"server_id,omitempty"`
	ServerName        string `json:"server_name,omitempty"`
	Resource          string `json:"resource,omitempty"`
	PayloadJSON       string `json:"payload_json,omitempty"`
	ResultJSON        string `json:"result_json,omitempty"`
	Progress          int    `json:"progress"`
	TotalCount        int    `json:"total_count"`
	SuccessCount      int    `json:"success_count"`
	FailureCount      int    `json:"failure_count"`
	BytesTotal        int64  `json:"bytes_total"`
	BytesProcessed    int64  `json:"bytes_processed"`
	ProgressJSON      string `json:"progress_json,omitempty"`
	Cancelable        bool   `json:"cancelable"`
	Retryable         bool   `json:"retryable"`
	Attempt           int    `json:"attempt"`
	MaxAttempts       int    `json:"max_attempts"`
	ErrorCode         string `json:"error_code,omitempty"`
	ErrorMessage      string `json:"error_message,omitempty"`
	CancelRequestedAt string `json:"cancel_requested_at,omitempty"`
	StartedAt         string `json:"started_at,omitempty"`
	FinishedAt        string `json:"finished_at,omitempty"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}

type DesktopTaskEvent struct {
	ID        int64  `json:"id"`
	TaskRunID string `json:"task_run_id"`
	UserID    string `json:"user_id"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	DataJSON  string `json:"data_json,omitempty"`
	CreatedAt string `json:"created_at"`
}

type DesktopTaskListInput struct {
	Statuses     []string `json:"status,omitempty"`
	TaskTypes    []string `json:"task_type,omitempty"`
	TriggerTypes []string `json:"trigger_type,omitempty"`
	Keyword      string   `json:"keyword,omitempty"`
	Page         int      `json:"page"`
	PageSize     int      `json:"page_size"`
}

type DesktopTaskRunList struct {
	Runs       []DesktopTaskRun `json:"runs"`
	Total      int64            `json:"total"`
	Page       int              `json:"page"`
	PageSize   int              `json:"page_size"`
	TotalPages int              `json:"total_pages"`
}

type DesktopTaskDetails struct {
	Run    DesktopTaskRun     `json:"run"`
	Events []DesktopTaskEvent `json:"events"`
}

type DesktopTaskStatistics struct {
	Total          int64 `json:"total"`
	Queued         int64 `json:"queued"`
	Running        int64 `json:"running"`
	Canceling      int64 `json:"canceling"`
	Succeeded      int64 `json:"succeeded"`
	Failed         int64 `json:"failed"`
	PartialSuccess int64 `json:"partial_success"`
	Canceled       int64 `json:"canceled"`
	Timeout        int64 `json:"timeout"`
}

type DesktopTaskCleanupResult struct {
	DeletedCount         int64 `json:"deleted_count"`
	DeletedEvents        int64 `json:"deleted_events"`
	DeletedNotifications int64 `json:"deleted_notifications"`
	RetentionDays        int   `json:"retention_days"`
}

type desktopTaskCreateInput struct {
	ID          string
	RetryOfID   string
	SourceType  string
	SourceID    string
	TaskType    string
	Title       string
	Description string
	TriggerType string
	ServerID    string
	ServerName  string
	Resource    string
	PayloadJSON string
	TotalCount  int
	BytesTotal  int64
	Cancelable  bool
	Retryable   bool
	Attempt     int
	MaxAttempts int
}

type desktopTaskHandler interface {
	CancelDesktopTask(taskID string) bool
	RetryDesktopTask(run DesktopTaskRun) (string, error)
}

type desktopTaskScanner interface {
	Scan(dest ...any) error
}

type DesktopTaskService struct {
	mu            sync.Mutex
	db            *sql.DB
	closed        bool
	window        *application.WebviewWindow
	notifications *DesktopNotificationService
	handlers      map[string]desktopTaskHandler
	workerCancel  context.CancelFunc
	workerWG      sync.WaitGroup
}

func NewDesktopTaskService(notifications *DesktopNotificationService) *DesktopTaskService {
	return &DesktopTaskService{notifications: notifications, handlers: make(map[string]desktopTaskHandler)}
}

func (s *DesktopTaskService) ServiceName() string { return "DesktopTaskService" }

func (s *DesktopTaskService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.mu.Lock()
	s.closed = false
	s.mu.Unlock()
	if _, err := s.database(); err != nil {
		return err
	}
	if err := s.recoverInterrupted(); err != nil {
		return err
	}
	workerCtx, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	s.workerCancel = cancel
	s.workerWG.Add(1)
	s.mu.Unlock()
	go s.runRetentionWorker(workerCtx)
	return nil
}

func (s *DesktopTaskService) ServiceShutdown() error {
	s.mu.Lock()
	cancel := s.workerCancel
	s.workerCancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		s.workerWG.Wait()
	}
	s.mu.Lock()
	database := s.db
	s.db = nil
	s.closed = true
	s.mu.Unlock()
	if database != nil {
		return database.Close()
	}
	return nil
}

func (s *DesktopTaskService) attachWindow(window *application.WebviewWindow) {
	s.mu.Lock()
	s.window = window
	s.mu.Unlock()
}

func (s *DesktopTaskService) registerHandler(taskType string, handler desktopTaskHandler) {
	s.mu.Lock()
	s.handlers[strings.TrimSpace(taskType)] = handler
	s.mu.Unlock()
}

func (s *DesktopTaskService) List(input DesktopTaskListInput) (DesktopTaskRunList, error) {
	database, err := s.database()
	if err != nil {
		return DesktopTaskRunList{}, err
	}
	input = normalizeDesktopTaskListInput(input)
	where, args := buildDesktopTaskWhere(input)
	var total int64
	if err := database.QueryRow("SELECT COUNT(*) FROM desktop_task_runs WHERE "+where, args...).Scan(&total); err != nil {
		return DesktopTaskRunList{}, err
	}
	offset := (input.Page - 1) * input.PageSize
	queryArgs := append(append([]any{}, args...), input.PageSize, offset)
	rows, err := database.Query(desktopTaskSelectSQL+" WHERE "+where+" ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", queryArgs...)
	if err != nil {
		return DesktopTaskRunList{}, err
	}
	defer rows.Close()
	runs := make([]DesktopTaskRun, 0)
	for rows.Next() {
		run, err := scanDesktopTaskRun(rows)
		if err != nil {
			return DesktopTaskRunList{}, err
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		return DesktopTaskRunList{}, err
	}
	totalPages := 0
	if total > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(input.PageSize)))
	}
	return DesktopTaskRunList{Runs: runs, Total: total, Page: input.Page, PageSize: input.PageSize, TotalPages: totalPages}, nil
}

func (s *DesktopTaskService) Statistics() (DesktopTaskStatistics, error) {
	database, err := s.database()
	if err != nil {
		return DesktopTaskStatistics{}, err
	}
	stats := DesktopTaskStatistics{}
	rows, err := database.Query("SELECT status, COUNT(*) FROM desktop_task_runs GROUP BY status")
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var count int64
		if err := rows.Scan(&status, &count); err != nil {
			return stats, err
		}
		stats.Total += count
		switch status {
		case "queued":
			stats.Queued = count
		case "running":
			stats.Running = count
		case "canceling":
			stats.Canceling = count
		case "succeeded":
			stats.Succeeded = count
		case "failed":
			stats.Failed = count
		case "partial_success":
			stats.PartialSuccess = count
		case "canceled":
			stats.Canceled = count
		case "timeout":
			stats.Timeout = count
		}
	}
	return stats, rows.Err()
}

func (s *DesktopTaskService) Get(id string) (DesktopTaskDetails, error) {
	run, err := s.getRun(strings.TrimSpace(id))
	if err != nil {
		return DesktopTaskDetails{}, err
	}
	database, err := s.database()
	if err != nil {
		return DesktopTaskDetails{}, err
	}
	rows, err := database.Query(`SELECT id, task_run_id, user_id, level, message, data_json, created_at FROM desktop_task_events WHERE task_run_id = ? ORDER BY created_at ASC, id ASC`, run.ID)
	if err != nil {
		return DesktopTaskDetails{}, err
	}
	defer rows.Close()
	events := make([]DesktopTaskEvent, 0)
	for rows.Next() {
		var event DesktopTaskEvent
		if err := rows.Scan(&event.ID, &event.TaskRunID, &event.UserID, &event.Level, &event.Message, &event.DataJSON, &event.CreatedAt); err != nil {
			return DesktopTaskDetails{}, err
		}
		events = append(events, event)
	}
	return DesktopTaskDetails{Run: run, Events: events}, rows.Err()
}

func (s *DesktopTaskService) Cancel(id string) (DesktopTaskRun, error) {
	run, err := s.getRun(strings.TrimSpace(id))
	if err != nil {
		return DesktopTaskRun{}, err
	}
	if !run.Cancelable || (run.Status != "queued" && run.Status != "running") {
		return DesktopTaskRun{}, errors.New("task run is not cancelable")
	}
	handler := s.handler(run.TaskType)
	if handler == nil {
		return DesktopTaskRun{}, errors.New("task cancel handler is unavailable")
	}
	database, err := s.database()
	if err != nil {
		return DesktopTaskRun{}, err
	}
	now := desktopTaskNow()
	result, err := database.Exec(`UPDATE desktop_task_runs SET status = 'canceling', cancel_requested_at = ?, updated_at = ? WHERE id = ? AND status IN ('queued','running')`, now, now, run.ID)
	if err != nil {
		return DesktopTaskRun{}, err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return DesktopTaskRun{}, errors.New("task run is not cancelable")
	}
	s.appendEvent(run.ID, "warning", "已请求取消任务", "")
	if !handler.CancelDesktopTask(run.ID) {
		_, _ = database.Exec(`UPDATE desktop_task_runs SET status = ?, cancel_requested_at = '', updated_at = ? WHERE id = ? AND status = 'canceling'`, run.Status, desktopTaskNow(), run.ID)
		return DesktopTaskRun{}, errors.New("task cancel handler rejected the request")
	}
	if err := s.complete(run.ID, "canceled", "", "", "任务已取消", run.SuccessCount, run.FailureCount); err != nil {
		return DesktopTaskRun{}, err
	}
	return s.getRun(run.ID)
}

func (s *DesktopTaskService) Retry(id string) (map[string]string, error) {
	run, err := s.getRun(strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	if !run.Retryable || !desktopTaskIsRetryableStatus(run.Status) {
		return nil, errors.New("task run is not retryable")
	}
	handler := s.handler(run.TaskType)
	if handler == nil {
		return nil, errors.New("task retry handler is unavailable")
	}
	newID, err := handler.RetryDesktopTask(run)
	if err != nil {
		return nil, err
	}
	return map[string]string{"id": newID, "retry_of_id": run.ID}, nil
}

func (s *DesktopTaskService) Cleanup(retentionDays int) (DesktopTaskCleanupResult, error) {
	if retentionDays < 1 || retentionDays > 3650 {
		return DesktopTaskCleanupResult{}, errors.New("retention days must be between 1 and 3650")
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -retentionDays).Format(time.RFC3339Nano)
	result, err := s.cleanupWhere("finished_at != '' AND finished_at < ? AND status IN ("+desktopSQLPlaceholders(len(desktopTaskTerminalStatuses))+")", append([]any{cutoff}, desktopStringsToAny(desktopTaskTerminalStatuses)...)...)
	result.RetentionDays = retentionDays
	return result, err
}

func (s *DesktopTaskService) create(input desktopTaskCreateInput) (string, error) {
	database, err := s.database()
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(input.ID) == "" {
		input.ID = uuid.NewString()
	}
	if input.TriggerType == "" {
		input.TriggerType = "manual"
	}
	if input.Attempt < 1 {
		input.Attempt = 1
	}
	if input.MaxAttempts < 1 {
		input.MaxAttempts = 1
	}
	now := desktopTaskNow()
	result, err := database.Exec(`INSERT OR IGNORE INTO desktop_task_runs (
		id, user_id, definition_id, retry_of_id, source_type, source_id, task_type, title, description,
		trigger_type, runner, status, stage, server_id, server_name, resource, payload_json, result_json,
		progress, total_count, success_count, failure_count, bytes_total, bytes_processed, progress_json,
		cancelable, retryable, attempt, max_attempts, error_code, error_message, cancel_requested_at,
		started_at, finished_at, created_at, updated_at
	) VALUES (?, 'local_owner', '', ?, ?, ?, ?, ?, ?, ?, 'desktop', 'queued', '', ?, ?, ?, ?, '', 0, ?, 0, 0, ?, 0, '', ?, ?, ?, ?, '', '', '', '', '', ?, ?)`,
		input.ID, input.RetryOfID, input.SourceType, input.SourceID, input.TaskType, input.Title, input.Description,
		input.TriggerType, input.ServerID, input.ServerName, input.Resource, input.PayloadJSON, input.TotalCount,
		input.BytesTotal, desktopTaskBool(input.Cancelable), desktopTaskBool(input.Retryable), input.Attempt, input.MaxAttempts, now, now)
	if err != nil {
		return "", err
	}
	if changed, _ := result.RowsAffected(); changed > 0 {
		s.appendEvent(input.ID, "info", "任务已进入队列", "")
		s.emitChanged("task.created", input.ID)
	}
	return input.ID, nil
}

func (s *DesktopTaskService) setPayload(id string, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	database, err := s.database()
	if err != nil {
		return err
	}
	_, err = database.Exec(`UPDATE desktop_task_runs SET payload_json = ?, updated_at = ? WHERE id = ?`, string(encoded), desktopTaskNow(), id)
	return err
}

func (s *DesktopTaskService) updateMetadata(id string, serverID string, serverName string, resource string, totalCount int, bytesTotal int64) error {
	database, err := s.database()
	if err != nil {
		return err
	}
	_, err = database.Exec(`UPDATE desktop_task_runs SET
		server_id = CASE WHEN ? != '' THEN ? ELSE server_id END,
		server_name = CASE WHEN ? != '' THEN ? ELSE server_name END,
		resource = CASE WHEN ? != '' THEN ? ELSE resource END,
		total_count = CASE WHEN ? > 0 THEN ? ELSE total_count END,
		bytes_total = CASE WHEN ? > 0 THEN ? ELSE bytes_total END,
		updated_at = ? WHERE id = ?`,
		serverID, serverID, serverName, serverName, resource, resource,
		totalCount, totalCount, bytesTotal, bytesTotal, desktopTaskNow(), id)
	return err
}

func (s *DesktopTaskService) setRetryMetadata(id string, retryOfID string, attempt int) error {
	if attempt < 1 {
		attempt = 1
	}
	database, err := s.database()
	if err != nil {
		return err
	}
	_, err = database.Exec(`UPDATE desktop_task_runs SET retry_of_id = ?, attempt = ?, max_attempts = CASE WHEN max_attempts < ? THEN ? ELSE max_attempts END, updated_at = ? WHERE id = ?`, retryOfID, attempt, attempt, attempt, desktopTaskNow(), id)
	return err
}

func (s *DesktopTaskService) start(id string, stage string) error {
	database, err := s.database()
	if err != nil {
		return err
	}
	now := desktopTaskNow()
	result, err := database.Exec(`UPDATE desktop_task_runs SET status = 'running', stage = ?, started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`, stage, now, now, id)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed > 0 {
		s.appendEvent(id, "info", "任务开始执行", "")
		s.emitChanged("task.updated", id)
	}
	return nil
}

func (s *DesktopTaskService) updateProgress(id string, progress int, stage string, processed int64, total int64, successCount int, failureCount int) error {
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	database, err := s.database()
	if err != nil {
		return err
	}
	_, err = database.Exec(`UPDATE desktop_task_runs SET progress = ?, stage = ?, bytes_processed = ?, bytes_total = CASE WHEN ? > 0 THEN ? ELSE bytes_total END, success_count = ?, failure_count = ?, updated_at = ? WHERE id = ? AND status IN ('queued','running','canceling')`, progress, stage, processed, total, total, successCount, failureCount, desktopTaskNow(), id)
	if err == nil {
		s.emitChanged("task.updated", id)
	}
	return err
}

func (s *DesktopTaskService) complete(id string, status string, resultJSON string, errorCode string, errorMessage string, successCount int, failureCount int) error {
	if !desktopTaskIsTerminal(status) {
		return fmt.Errorf("invalid terminal task status: %s", status)
	}
	database, err := s.database()
	if err != nil {
		return err
	}
	now := desktopTaskNow()
	progress := 100
	if status == "failed" || status == "canceled" || status == "timeout" {
		progress = -1
	}
	query := `UPDATE desktop_task_runs SET status = ?, progress = CASE WHEN ? >= 0 THEN ? ELSE progress END, result_json = ?, error_code = ?, error_message = ?, success_count = ?, failure_count = ?, finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('queued','running','canceling')`
	result, err := database.Exec(query, status, progress, progress, resultJSON, errorCode, errorMessage, successCount, failureCount, now, now, id)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return nil
	}
	level, message := desktopTaskCompletionEvent(status)
	s.appendEvent(id, level, message, "")
	run, findErr := s.getRun(id)
	if findErr == nil {
		s.notifyCompletion(run)
	}
	s.emitChanged("task.completed", id)
	return nil
}

func (s *DesktopTaskService) handler(taskType string) desktopTaskHandler {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.handlers[taskType]
}

func (s *DesktopTaskService) getRun(id string) (DesktopTaskRun, error) {
	database, err := s.database()
	if err != nil {
		return DesktopTaskRun{}, err
	}
	return scanDesktopTaskRun(database.QueryRow(desktopTaskSelectSQL+" WHERE id = ?", id))
}

func (s *DesktopTaskService) appendEvent(taskID string, level string, message string, dataJSON string) {
	database, err := s.database()
	if err != nil {
		return
	}
	_, _ = database.Exec(`INSERT INTO desktop_task_events (task_run_id, user_id, level, message, data_json, created_at) VALUES (?, 'local_owner', ?, ?, ?, ?)`, taskID, level, message, dataJSON, desktopTaskNow())
}

func (s *DesktopTaskService) notifyCompletion(run DesktopTaskRun) {
	if s.notifications == nil {
		return
	}
	severity, eventType, title := "error", "task.failed", "任务执行失败"
	switch run.Status {
	case "succeeded":
		severity, eventType, title = "success", "task.succeeded", "任务执行成功"
	case "partial_success":
		severity, eventType, title = "warning", "task.partial_success", "任务部分成功"
	case "canceled":
		severity, eventType, title = "warning", "task.canceled", "任务已取消"
	}
	message := run.Title
	if run.Resource != "" {
		message += " · " + run.Resource
	}
	if run.ErrorMessage != "" {
		message += "：" + run.ErrorMessage
	}
	_ = s.notifications.publishLinked(eventType, severity, title, message, "desktop://tasks/"+run.ID, "task_run", run.ID)
}

func (s *DesktopTaskService) emitChanged(eventType string, taskID string) {
	s.mu.Lock()
	window := s.window
	s.mu.Unlock()
	if window != nil {
		window.EmitEvent(desktopTaskChangedEvent, map[string]any{"type": eventType, "task_id": taskID})
	}
}

func (s *DesktopTaskService) runRetentionWorker(ctx context.Context) {
	defer s.workerWG.Done()
	_, _ = s.cleanupDefaultRetention()
	ticker := time.NewTicker(desktopTaskRetentionInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			_, _ = s.cleanupDefaultRetention()
		case <-ctx.Done():
			return
		}
	}
}

func (s *DesktopTaskService) cleanupDefaultRetention() (DesktopTaskCleanupResult, error) {
	now := time.Now().UTC()
	shortCutoff := now.AddDate(0, 0, -desktopTaskSuccessRetentionDays).Format(time.RFC3339Nano)
	longCutoff := now.AddDate(0, 0, -desktopTaskFailureRetentionDays).Format(time.RFC3339Nano)
	return s.cleanupWhere(`finished_at != '' AND ((status IN ('failed','partial_success','timeout') AND finished_at < ?) OR (status IN ('succeeded','canceled') AND finished_at < ?))`, longCutoff, shortCutoff)
}

func (s *DesktopTaskService) cleanupWhere(where string, args ...any) (DesktopTaskCleanupResult, error) {
	database, err := s.database()
	if err != nil {
		return DesktopTaskCleanupResult{}, err
	}
	tx, err := database.Begin()
	if err != nil {
		return DesktopTaskCleanupResult{}, err
	}
	defer tx.Rollback()
	rows, err := tx.Query("SELECT id FROM desktop_task_runs WHERE "+where, args...)
	if err != nil {
		return DesktopTaskCleanupResult{}, err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return DesktopTaskCleanupResult{}, err
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return DesktopTaskCleanupResult{}, err
	}
	result := DesktopTaskCleanupResult{}
	for start := 0; start < len(ids); start += 500 {
		end := start + 500
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[start:end]
		placeholders := desktopSQLPlaceholders(len(batch))
		batchArgs := desktopStringsToAny(batch)
		if _, err := tx.Exec("UPDATE desktop_task_runs SET retry_of_id = '' WHERE retry_of_id IN ("+placeholders+")", batchArgs...); err != nil {
			return DesktopTaskCleanupResult{}, err
		}
		deletedEvents, err := tx.Exec("DELETE FROM desktop_task_events WHERE task_run_id IN ("+placeholders+")", batchArgs...)
		if err != nil {
			return DesktopTaskCleanupResult{}, err
		}
		count, _ := deletedEvents.RowsAffected()
		result.DeletedEvents += count
		deleteArgs := append(append([]any{}, batchArgs...), desktopStringsToAny(desktopTaskTerminalStatuses)...)
		deletedRuns, err := tx.Exec("DELETE FROM desktop_task_runs WHERE id IN ("+placeholders+") AND status IN ("+desktopSQLPlaceholders(len(desktopTaskTerminalStatuses))+")", deleteArgs...)
		if err != nil {
			return DesktopTaskCleanupResult{}, err
		}
		count, _ = deletedRuns.RowsAffected()
		result.DeletedCount += count
	}
	if s.notifications != nil && len(ids) > 0 {
		result.DeletedNotifications, err = s.notifications.deleteBySourceIDs("task_run", ids)
		if err != nil {
			return result, err
		}
	}
	if err := tx.Commit(); err != nil {
		return result, err
	}
	if result.DeletedCount > 0 {
		s.emitChanged("task.cleanup.completed", "")
	}
	return result, nil
}

func (s *DesktopTaskService) recoverInterrupted() error {
	database, err := s.database()
	if err != nil {
		return err
	}
	now := desktopTaskNow()
	rows, err := database.Query(`SELECT id FROM desktop_task_runs WHERE status IN ('queued','running','canceling')`)
	if err != nil {
		return err
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	_, err = database.Exec(`UPDATE desktop_task_runs SET status = 'failed', error_code = 'desktop_restarted', error_message = '任务因桌面应用重启而中断', cancel_requested_at = '', finished_at = ?, updated_at = ? WHERE status IN ('queued','running','canceling')`, now, now)
	if err != nil {
		return err
	}
	for _, id := range ids {
		s.appendEvent(id, "error", "任务因桌面应用重启而中断", "")
		if run, findErr := s.getRun(id); findErr == nil {
			s.notifyCompletion(run)
		}
	}
	return nil
}

func (s *DesktopTaskService) database() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, errors.New("desktop task service is shut down")
	}
	if s.db != nil {
		return s.db, nil
	}
	if err := os.MkdirAll(desktopDataDir(), 0o755); err != nil {
		return nil, err
	}
	database, err := sql.Open("sqlite", filepath.Join(desktopDataDir(), "easyssh-desktop.sqlite"))
	if err != nil {
		return nil, err
	}
	if err := configureDesktopTaskDatabase(database); err != nil {
		database.Close()
		return nil, err
	}
	s.db = database
	return s.db, nil
}

func configureDesktopTaskDatabase(database *sql.DB) error {
	database.SetMaxOpenConns(1)
	statements := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
		`CREATE TABLE IF NOT EXISTS desktop_task_runs (
			id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'local_owner', definition_id TEXT NOT NULL DEFAULT '',
			retry_of_id TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '',
			task_type TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', trigger_type TEXT NOT NULL DEFAULT 'manual',
			runner TEXT NOT NULL DEFAULT 'desktop', status TEXT NOT NULL DEFAULT 'queued', stage TEXT NOT NULL DEFAULT '',
			server_id TEXT NOT NULL DEFAULT '', server_name TEXT NOT NULL DEFAULT '', resource TEXT NOT NULL DEFAULT '',
			payload_json TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '', progress INTEGER NOT NULL DEFAULT 0,
			total_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0,
			bytes_total INTEGER NOT NULL DEFAULT 0, bytes_processed INTEGER NOT NULL DEFAULT 0, progress_json TEXT NOT NULL DEFAULT '',
			cancelable INTEGER NOT NULL DEFAULT 0, retryable INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 1,
			max_attempts INTEGER NOT NULL DEFAULT 1, error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '',
			cancel_requested_at TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		)`,
		"CREATE INDEX IF NOT EXISTS idx_desktop_task_runs_status ON desktop_task_runs (status)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_task_runs_finished ON desktop_task_runs (finished_at)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_task_runs_created ON desktop_task_runs (created_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_task_runs_type ON desktop_task_runs (task_type)",
		`CREATE TABLE IF NOT EXISTS desktop_task_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT, task_run_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT 'local_owner',
			level TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
			FOREIGN KEY (task_run_id) REFERENCES desktop_task_runs(id) ON DELETE CASCADE
		)`,
		"CREATE INDEX IF NOT EXISTS idx_desktop_task_events_run ON desktop_task_events (task_run_id, created_at)",
	}
	for _, statement := range statements {
		if _, err := database.Exec(statement); err != nil {
			return err
		}
	}
	return database.Ping()
}

const desktopTaskSelectSQL = `SELECT id, user_id, definition_id, retry_of_id, source_type, source_id, task_type, title,
	description, trigger_type, runner, status, stage, server_id, server_name, resource, payload_json, result_json,
	progress, total_count, success_count, failure_count, bytes_total, bytes_processed, progress_json, cancelable,
	retryable, attempt, max_attempts, error_code, error_message, cancel_requested_at, started_at, finished_at,
	created_at, updated_at FROM desktop_task_runs`

func scanDesktopTaskRun(scanner desktopTaskScanner) (DesktopTaskRun, error) {
	var run DesktopTaskRun
	var cancelable, retryable int
	err := scanner.Scan(
		&run.ID, &run.UserID, &run.DefinitionID, &run.RetryOfID, &run.SourceType, &run.SourceID, &run.TaskType, &run.Title,
		&run.Description, &run.TriggerType, &run.Runner, &run.Status, &run.Stage, &run.ServerID, &run.ServerName, &run.Resource,
		&run.PayloadJSON, &run.ResultJSON, &run.Progress, &run.TotalCount, &run.SuccessCount, &run.FailureCount, &run.BytesTotal,
		&run.BytesProcessed, &run.ProgressJSON, &cancelable, &retryable, &run.Attempt, &run.MaxAttempts, &run.ErrorCode,
		&run.ErrorMessage, &run.CancelRequestedAt, &run.StartedAt, &run.FinishedAt, &run.CreatedAt, &run.UpdatedAt,
	)
	run.Cancelable = cancelable != 0
	run.Retryable = retryable != 0
	return run, err
}

func normalizeDesktopTaskListInput(input DesktopTaskListInput) DesktopTaskListInput {
	if input.Page < 1 {
		input.Page = 1
	}
	if input.PageSize < 1 {
		input.PageSize = 50
	}
	if input.PageSize > 100 {
		input.PageSize = 100
	}
	input.Statuses = normalizeDesktopTaskStrings(input.Statuses)
	input.TaskTypes = normalizeDesktopTaskStrings(input.TaskTypes)
	input.TriggerTypes = normalizeDesktopTaskStrings(input.TriggerTypes)
	input.Keyword = strings.TrimSpace(input.Keyword)
	return input
}

func buildDesktopTaskWhere(input DesktopTaskListInput) (string, []any) {
	clauses := []string{"1 = 1"}
	args := make([]any, 0)
	appendIn := func(column string, values []string) {
		if len(values) == 0 {
			return
		}
		clauses = append(clauses, column+" IN ("+desktopSQLPlaceholders(len(values))+")")
		args = append(args, desktopStringsToAny(values)...)
	}
	appendIn("status", input.Statuses)
	appendIn("task_type", input.TaskTypes)
	appendIn("trigger_type", input.TriggerTypes)
	if input.Keyword != "" {
		like := "%" + strings.ToLower(input.Keyword) + "%"
		clauses = append(clauses, "(LOWER(title) LIKE ? OR LOWER(task_type) LIKE ? OR LOWER(resource) LIKE ? OR LOWER(server_name) LIKE ? OR LOWER(error_message) LIKE ?)")
		args = append(args, like, like, like, like, like)
	}
	return strings.Join(clauses, " AND "), args
}

func normalizeDesktopTaskStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{})
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func desktopTaskCompletionEvent(status string) (string, string) {
	switch status {
	case "succeeded":
		return "info", "任务执行完成"
	case "partial_success":
		return "warning", "任务部分成功"
	case "canceled":
		return "warning", "任务已取消"
	default:
		return "error", "任务执行失败"
	}
}

func desktopTaskIsTerminal(status string) bool {
	for _, candidate := range desktopTaskTerminalStatuses {
		if status == candidate {
			return true
		}
	}
	return false
}

func desktopTaskIsRetryableStatus(status string) bool {
	return status == "failed" || status == "partial_success" || status == "canceled" || status == "timeout"
}

func desktopSQLPlaceholders(count int) string {
	if count <= 0 {
		return "NULL"
	}
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

func desktopStringsToAny(values []string) []any {
	result := make([]any, len(values))
	for index := range values {
		result[index] = values[index]
	}
	return result
}

func desktopTaskBool(value bool) int {
	if value {
		return 1
	}
	return 0
}

func desktopTaskNow() string { return time.Now().UTC().Format(time.RFC3339Nano) }
