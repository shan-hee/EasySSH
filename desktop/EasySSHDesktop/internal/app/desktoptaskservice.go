package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/activitystats"
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

var desktopTaskTerminalStatuses = []string{"succeeded", "failed", "partial_success", "canceled", "timeout", "unknown"}

type DesktopTaskRun struct {
	WorkID            string         `json:"work_id"`
	ParentWorkID      string         `json:"parent_work_id,omitempty"`
	WorkStartedAt     string         `json:"work_started_at"`
	ID                string         `json:"id"`
	Actor             protocol.Actor `json:"actor"`
	DefinitionID      string         `json:"definition_id,omitempty"`
	RetryOfID         string         `json:"retry_of_id,omitempty"`
	SourceType        string         `json:"source_type,omitempty"`
	SourceID          string         `json:"source_id,omitempty"`
	TaskType          string         `json:"task_type"`
	Title             string         `json:"title"`
	Description       string         `json:"description,omitempty"`
	TriggerType       string         `json:"trigger_type"`
	Runner            string         `json:"runner"`
	Status            string         `json:"status"`
	Stage             string         `json:"stage,omitempty"`
	ServerID          string         `json:"server_id,omitempty"`
	ServerName        string         `json:"server_name,omitempty"`
	Resource          string         `json:"resource,omitempty"`
	PayloadJSON       string         `json:"payload_json,omitempty"`
	ResultJSON        string         `json:"result_json,omitempty"`
	Progress          int            `json:"progress"`
	TotalCount        int            `json:"total_count"`
	SuccessCount      int            `json:"success_count"`
	FailureCount      int            `json:"failure_count"`
	BytesTotal        int64          `json:"bytes_total"`
	BytesCompleted    int64          `json:"bytes_completed"`
	BytesProcessed    int64          `json:"bytes_processed"`
	ProgressJSON      string         `json:"progress_json,omitempty"`
	Cancelable        bool           `json:"cancelable"`
	Retryable         bool           `json:"retryable"`
	Attempt           int            `json:"attempt"`
	MaxAttempts       int            `json:"max_attempts"`
	ErrorCode         string         `json:"error_code,omitempty"`
	ErrorMessage      string         `json:"error_message,omitempty"`
	CancelRequestedAt string         `json:"cancel_requested_at,omitempty"`
	StartedAt         string         `json:"started_at,omitempty"`
	FinishedAt        string         `json:"finished_at,omitempty"`
	CreatedAt         string         `json:"created_at"`
	UpdatedAt         string         `json:"updated_at"`
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
	Runs       []DesktopTaskOverview `json:"runs"`
	Total      int64                 `json:"total"`
	Page       int                   `json:"page"`
	PageSize   int                   `json:"page_size"`
	TotalPages int                   `json:"total_pages"`
}

type DesktopTaskDetails struct {
	Run     DesktopTaskOverview  `json:"run"`
	Content protocol.TaskContent `json:"content"`
}

type DesktopTaskStatistics struct {
	Unknown        int64 `json:"unknown"`
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
	Transfer     *desktopTransferIntent
	ParentWorkID string
	Resources    []activitystats.Resource
	Actor        protocol.Actor
	ID           string
	RetryOfID    string
	SourceType   string
	SourceID     string
	TaskType     string
	Title        string
	Description  string
	TriggerType  string
	ServerID     string
	ServerName   string
	Resource     string
	PayloadJSON  string
	TotalCount   int
	BytesTotal   int64
	Cancelable   bool
	Retryable    bool
	Attempt      int
	MaxAttempts  int
}

type desktopTaskHandler interface {
	CancelDesktopTask(taskID string) bool
	RetryDesktopTask(run DesktopTaskRun) (string, error)
}

type desktopTaskScanner interface {
	Scan(dest ...any) error
}

type DesktopTaskService struct {
	completionWG  sync.WaitGroup
	stopping      bool
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
	s.stopping = false
	s.mu.Unlock()
	if _, err := s.database(); err != nil {
		return err
	}
	if err := s.recoverInterrupted(ctx); err != nil {
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
	s.stopping = true
	s.workerCancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		s.workerWG.Wait()
	}
	s.completionWG.Wait()
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
	rows, err := database.Query(desktopTaskSummarySQL+" WHERE "+where+" ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", queryArgs...)
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
	if err := rows.Close(); err != nil {
		return DesktopTaskRunList{}, err
	}
	views := make([]DesktopTaskOverview, 0, len(runs))
	for i := range runs {
		views = append(views, desktopTaskOverview(runs[i]))
	}
	totalPages := 0
	if total > 0 {
		totalPages = int(math.Ceil(float64(total) / float64(input.PageSize)))
	}
	return DesktopTaskRunList{Runs: views, Total: total, Page: input.Page, PageSize: input.PageSize, TotalPages: totalPages}, nil
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
		case "unknown":
			stats.Unknown = count
		}
	}
	if err := rows.Err(); err != nil {
		return stats, err
	}
	if err := rows.Close(); err != nil {
		return stats, err
	}
	return stats, nil
}

func (s *DesktopTaskService) Get(id string) (DesktopTaskDetails, error) {
	return s.taskDetails(context.Background(), strings.TrimSpace(id))
}

func (s *DesktopTaskService) Cancel(id string) (DesktopTaskOverview, error) {
	run, err := s.getOverview(strings.TrimSpace(id))
	if err != nil {
		return DesktopTaskOverview{}, err
	}
	if !run.Cancelable || (run.Status != "queued" && run.Status != "running") {
		return DesktopTaskOverview{}, errors.New("task run is not cancelable")
	}
	handler := s.handler(run.TaskType)
	if handler == nil {
		return DesktopTaskOverview{}, errors.New("task cancel handler is unavailable")
	}
	changed, err := s.requestCancel(run.ID)
	if err != nil {
		return DesktopTaskOverview{}, err
	}
	if !changed {
		return s.getOverview(run.ID)
	}
	if !handler.CancelDesktopTask(run.ID) {
		_, revertErr := s.transition(run.ID, `UPDATE desktop_task_runs SET status=?, cancel_requested_at='', updated_at=? WHERE id=? AND status='canceling'`, []any{run.Status, desktopTaskNow(), run.ID}, "warning", "执行器未接受取消请求")
		if revertErr != nil {
			return DesktopTaskOverview{}, revertErr
		}
		return DesktopTaskOverview{}, errors.New("task cancel handler rejected the request")
	}
	return s.getOverview(run.ID)
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
	transfer := input.TaskType == "sftp_upload" || input.TaskType == "sftp_download" || input.TaskType == "sftp_transfer"
	if transfer != (input.Transfer != nil) {
		return "", errors.New("transfer intent must accompany transfer tasks")
	}
	if input.Actor != desktopLocalActor() && (input.ParentWorkID == "" || !input.Actor.Valid() || input.Actor.Kind != protocol.Owner || input.Actor.ID != desktopLocalActor().ID || input.Actor.GrantID != "") {
		return "", errors.New("action is not permitted")
	}
	database, err := s.database()
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(input.ID) == "" {
		input.ID = uuid.NewString()
	}
	if parsed, parseErr := uuid.Parse(input.ID); parseErr != nil || parsed == uuid.Nil || parsed.String() != input.ID {
		return "", errors.New("invalid task ID")
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
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := database.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var active int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM desktop_task_runs WHERE status IN ('queued','running','canceling')`).Scan(&active); err != nil {
		return "", err
	}
	if active >= 128 {
		return "", errors.New("task capacity reached")
	}
	if input.ServerID != "" && input.ServerName == "" {
		err := tx.QueryRow(`SELECT name FROM desktop_servers WHERE id=?`, input.ServerID).Scan(&input.ServerName)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}
	workID, workStartedAt, parentWorkID := uuid.NewString(), now, ""
	if input.ParentWorkID != "" {
		parent, err := scanDesktopAIExecution(tx.QueryRow(desktopAIExecutionSelect+" WHERE id=?", input.ParentWorkID))
		if err != nil {
			return "", err
		}
		if parent.Status != DesktopAITaskRunning || parent.Actor != input.Actor || parent.ServerID != input.ServerID || input.RetryOfID != "" {
			return "", errors.New("invalid AI parent work")
		}
		parentWorkID, workStartedAt = parent.ID, parent.CreatedAt
		if input.ServerName == "" {
			input.ServerName = parent.ServerName
		}
		input.Retryable = false
	}

	if input.RetryOfID != "" {
		previous, err := scanDesktopTaskRun(tx.QueryRow(desktopTaskSelectSQL+" WHERE id=?", input.RetryOfID))
		if err != nil {
			return "", err
		}
		if !previous.Retryable || !desktopTaskIsRetryableStatus(previous.Status) || previous.TaskType != input.TaskType || previous.Actor.Kind != input.Actor.Kind || previous.Actor.ID != input.Actor.ID || input.Attempt != previous.Attempt+1 {
			return "", errors.New("invalid retry relationship")
		}
		workID, workStartedAt, parentWorkID = previous.WorkID, previous.WorkStartedAt, previous.ParentWorkID
		if input.MaxAttempts < input.Attempt {
			input.MaxAttempts = input.Attempt
		}
	}
	_, err = tx.Exec(`INSERT INTO desktop_task_runs (
		id, work_id, parent_work_id, work_started_at, actor_kind, actor_id, actor_session_id, actor_grant_id, definition_id, retry_of_id, source_type, source_id, task_type, title, description,
		trigger_type, runner, status, stage, server_id, server_name, resource, payload_json, result_json,
		progress, total_count, success_count, failure_count, bytes_total, bytes_processed, progress_json,
		cancelable, retryable, attempt, max_attempts, error_code, error_message, cancel_requested_at,
		started_at, finished_at, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 'desktop', 'queued', '', ?, ?, ?, ?, '', 0, ?, 0, 0, ?, 0, '', ?, ?, ?, ?, '', '', '', '', '', ?, ?)`,
		input.ID, workID, parentWorkID, workStartedAt, input.Actor.Kind, input.Actor.ID, input.Actor.SessionID, input.Actor.GrantID, input.RetryOfID, input.SourceType, input.SourceID, input.TaskType, input.Title, input.Description,
		input.TriggerType, input.ServerID, input.ServerName, input.Resource, input.PayloadJSON, input.TotalCount,
		input.BytesTotal, desktopTaskBool(input.Cancelable), desktopTaskBool(input.Retryable), input.Attempt, input.MaxAttempts, now, now)
	if err != nil {
		return "", err
	}
	if input.Transfer != nil {
		if input.SourceType != "transfer_job" || input.SourceID != input.ID || input.TaskType != desktopSFTPTaskCenterType(input.Transfer.Kind) {
			return "", errors.New("invalid transfer intent")
		}
		if err := insertDesktopTransfer(tx, input.ID, *input.Transfer); err != nil {
			return "", err
		}
	} else if input.SourceType == "transfer_job" {
		return "", errors.New("transfer intent required")
	}
	if err := saveDesktopTaskBody(context.Background(), tx, protocol.TaskBody{TaskRunID: uuid.MustParse(input.ID), Description: input.Description, PayloadJSON: input.PayloadJSON}); err != nil {
		return "", err
	}
	if err := projectDesktopTask(tx, input.ID); err != nil {
		return "", err
	}
	if err := addDesktopActivityResources(tx, "desktop_task_runs", input.ID, input.Resources); err != nil {
		return "", err
	}
	if err := appendDesktopTaskEvent(tx, input.ID, "info", "任务已进入队列", ""); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	s.emitChanged("task.created", input.ID)
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
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	run, err := scanDesktopTaskRun(tx.QueryRow(desktopTaskSelectSQL+" WHERE id=?", id))
	if err != nil {
		return err
	}
	if err := loadDesktopTaskBody(context.Background(), tx, &run); err != nil {
		return err
	}
	if run.PayloadJSON == string(encoded) {
		return nil
	}
	run.PayloadJSON = string(encoded)
	if err := saveDesktopTaskBody(context.Background(), tx, desktopTaskBody(run)); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE desktop_task_runs SET updated_at=? WHERE id=?`, desktopTaskNow(), id); err != nil {
		return err
	}
	if err := projectDesktopTask(tx, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *DesktopTaskService) start(id string, stage string) error {
	now := desktopTaskNow()
	changed, err := s.transition(id, `UPDATE desktop_task_runs SET status='running',stage=?,started_at=?,updated_at=? WHERE id=? AND status='queued'`, []any{stage, now, now, id}, "info", "任务开始执行")
	if changed {
		s.emitChanged("task.updated", id)
	}
	if err == nil && !changed {
		return errors.New("task is not queued")
	}
	return err
}

func (s *DesktopTaskService) updateProgress(id string, progress int, stage string, processed int64, total int64, successCount int, failureCount int) error {
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	_, err := s.transition(id, `UPDATE desktop_task_runs SET progress = ?, stage = ?, bytes_processed = ?, bytes_total = CASE WHEN ? > 0 THEN ? ELSE bytes_total END, success_count = ?, failure_count = ?, updated_at = ? WHERE id = ? AND status IN ('queued','running','canceling')`, []any{progress, stage, processed, total, total, successCount, failureCount, desktopTaskNow(), id}, "", "")
	if err == nil {
		s.emitChanged("task.updated", id)
	}
	return err
}

func (s *DesktopTaskService) complete(id string, status string, resultJSON string, errorCode string, errorMessage string, successCount int, failureCount int) error {
	return s.completeOutcome(id, desktopTaskCompletion{Status: status, ResultJSON: resultJSON, ErrorCode: errorCode, ErrorMessage: errorMessage, SuccessCount: successCount, FailureCount: failureCount})
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
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := database.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return DesktopTaskRun{}, err
	}
	defer tx.Rollback()
	run, err := scanDesktopTaskRun(tx.QueryRow(desktopTaskSelectSQL+" WHERE id=?", id))
	if err != nil {
		return DesktopTaskRun{}, err
	}
	if err := loadDesktopTaskBody(context.Background(), tx, &run); err != nil {
		return DesktopTaskRun{}, err
	}
	return run, tx.Commit()
}

// State and its event commit together; an event never invents a different Actor.
func appendDesktopTaskEvent(tx *sql.Tx, taskID, level, message, dataJSON string) error {
	_, err := tx.Exec(`INSERT INTO desktop_task_events(task_run_id,actor_kind,actor_id,actor_session_id,actor_grant_id,level,message,data_json,created_at) SELECT id,actor_kind,actor_id,actor_session_id,actor_grant_id,?,?,?,? FROM desktop_task_runs WHERE id=?`, level, message, dataJSON, desktopTaskNow(), taskID)
	return err
}

func (s *DesktopTaskService) transition(id, query string, args []any, level, message string) (bool, error) {
	db, err := s.database()
	if err != nil {
		return false, err
	}
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	result, err := tx.Exec(query, args...)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	if err != nil || count == 0 {
		return false, err
	}
	if err := projectDesktopTask(tx, id); err != nil {
		return false, err
	}
	if level != "" {
		if err := appendDesktopTaskEvent(tx, id, level, message, ""); err != nil {
			return false, err
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *DesktopTaskService) requestCancel(id string) (bool, error) {
	now := desktopTaskNow()
	changed, err := s.transition(id, `UPDATE desktop_task_runs SET status='canceling',cancel_requested_at=?,updated_at=? WHERE id=? AND status IN ('queued','running')`, []any{now, now, id}, "warning", "已请求取消任务")
	if changed {
		s.emitChanged("task.updated", id)
	}
	return changed, err
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
	if !waitForDesktopActivation(ctx) {
		return
	}
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
	return s.cleanupWhere(`finished_at != '' AND ((status IN ('failed','partial_success','timeout','unknown') AND finished_at < ?) OR (status IN ('succeeded','canceled') AND finished_at < ?))`, longCutoff, shortCutoff)
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
	for start := 0; start < len(ids); start += 500 {
		end := min(start+500, len(ids))
		deleted, err := tx.Exec("DELETE FROM desktop_notifications WHERE source_type='task_run' AND source_id IN ("+desktopSQLPlaceholders(end-start)+")", desktopStringsToAny(ids[start:end])...)
		if err != nil {
			return result, err
		}
		count, err := deleted.RowsAffected()
		if err != nil {
			return result, err
		}
		result.DeletedNotifications += count
	}

	if err := tx.Commit(); err != nil {
		return result, err
	}
	if result.DeletedCount > 0 {
		if s.notifications != nil {
			s.notifications.refreshTray()
		}
		s.emitChanged("task.cleanup.completed", "")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return result, cleanupDesktopContent(ctx, database)
}

func (s *DesktopTaskService) recoverInterrupted(ctx context.Context) error {
	database, err := s.database()
	if err != nil {
		return err
	}
	after := ""
	for {
		rows, err := database.QueryContext(ctx, `SELECT id FROM desktop_task_runs WHERE status IN ('queued','running','canceling') AND id>? ORDER BY id ASC LIMIT 100`, after)
		if err != nil {
			return err
		}
		ids := make([]string, 0, 100)
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		readErr := rows.Err()
		closeErr := rows.Close()
		if readErr != nil {
			return readErr
		}
		if closeErr != nil {
			return closeErr
		}
		for _, id := range ids {
			if err := ctx.Err(); err != nil {
				return err
			}
			after = id
			run, err := s.getOverview(id)
			if err != nil {
				return err
			}
			if desktopTaskIsTerminal(run.Status) {
				continue
			}
			if run.SourceType == "desktop_batch_task" {
				if err := database.QueryRowContext(ctx, `SELECT COALESCE(SUM(CASE WHEN status='success' THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END),0) FROM desktop_batch_task_results WHERE task_id=?`, run.SourceID).Scan(&run.SuccessCount, &run.FailureCount); err != nil {
					return err
				}
			}
			status, message := "unknown", "任务因重启中断，远端效果需核对；保留已有结果，未自动重放"
			if run.Status == "queued" {
				status, message = "canceled", "任务在执行前因重启而取消，未自动重放"
			}
			if err := s.completeOutcome(id, desktopTaskCompletion{PreserveResult: true, Status: status, ErrorCode: "desktop_restarted", ErrorMessage: message, SuccessCount: run.SuccessCount, FailureCount: run.FailureCount}); err != nil {
				return err
			}
		}
		if len(ids) < 100 {
			return nil
		}
	}
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
	if err := configureDesktopDatabase(database); err != nil {
		database.Close()
		return nil, err
	}
	s.db = database
	return s.db, nil
}

const desktopTaskSelectSQL = `SELECT id, work_id, parent_work_id, work_started_at, actor_kind, actor_id, actor_session_id, actor_grant_id, definition_id, retry_of_id, source_type, source_id, task_type, title,
	description, trigger_type, runner, status, stage, server_id, server_name, resource, payload_json, result_json,
	progress, total_count, success_count, failure_count, bytes_total, bytes_processed, bytes_completed, progress_json, cancelable,
	retryable, attempt, max_attempts, error_code, error_message, cancel_requested_at, started_at, finished_at,
	created_at, updated_at FROM desktop_task_runs`

func scanDesktopTaskRun(scanner desktopTaskScanner) (DesktopTaskRun, error) {
	var run DesktopTaskRun
	var cancelable, retryable int
	err := scanner.Scan(
		&run.ID, &run.WorkID, &run.ParentWorkID, &run.WorkStartedAt, &run.Actor.Kind, &run.Actor.ID, &run.Actor.SessionID, &run.Actor.GrantID, &run.DefinitionID, &run.RetryOfID, &run.SourceType, &run.SourceID, &run.TaskType, &run.Title,
		&run.Description, &run.TriggerType, &run.Runner, &run.Status, &run.Stage, &run.ServerID, &run.ServerName, &run.Resource,
		&run.PayloadJSON, &run.ResultJSON, &run.Progress, &run.TotalCount, &run.SuccessCount, &run.FailureCount, &run.BytesTotal,
		&run.BytesProcessed, &run.BytesCompleted, &run.ProgressJSON, &cancelable, &retryable, &run.Attempt, &run.MaxAttempts, &run.ErrorCode,
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
	case "unknown":
		return "warning", "任务结果待核对"
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
