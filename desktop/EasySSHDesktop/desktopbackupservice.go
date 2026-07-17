package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/backupcrypto"
	"github.com/easyssh/shared/backuputil"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	desktopBackupUserID   = "00000000-0000-4000-8000-000000000001"
	desktopBackupUsername = "desktop"
	desktopBackupEmail    = "desktop-local-owner@easyssh.local"
	// Desktop has no Web user system; this role is only for Web-compatible backup restore.
	desktopBackupWebCompatibleRole = "admin"
)

type DesktopBackupExportInput struct {
	IncludeConfig    bool     `json:"include_config"`
	IncludeDatabase  bool     `json:"include_database"`
	IncludeSensitive bool     `json:"include_sensitive"`
	AgePassphrase    string   `json:"age_passphrase"`
	AgeRecipients    []string `json:"age_recipients"`
}

type DesktopBackupRestoreInput struct {
	Content          string   `json:"content"`
	IncludeConfig    bool     `json:"include_config"`
	IncludeDatabase  bool     `json:"include_database"`
	ConflictStrategy string   `json:"conflict_strategy"`
	AgePassphrase    string   `json:"age_passphrase"`
	AgeIdentities    []string `json:"age_identities"`
}

type DesktopBackupExportResult struct {
	Filename string `json:"filename"`
	Content  string `json:"content"`
}

type DesktopBackupRestoreResult struct {
	Inserted int `json:"inserted"`
	Updated  int `json:"updated"`
	Skipped  int `json:"skipped"`
}

type desktopUnifiedBackup = backuputil.UnifiedBackup
type desktopBackupContents = backuputil.ContentSelection
type desktopBackupSection = backuputil.DataSection
type desktopBackupTable = backuputil.Table
type desktopBackupSensitivePayload = backuputil.SensitivePayload

type DesktopBackupService struct {
	mu            sync.Mutex
	db            *sql.DB
	notifications *DesktopNotificationService
	tasks         *DesktopTaskService
}

func NewDesktopBackupService(notifications *DesktopNotificationService, tasks *DesktopTaskService) *DesktopBackupService {
	return &DesktopBackupService{notifications: notifications, tasks: tasks}
}

func (s *DesktopBackupService) ServiceName() string {
	return "DesktopBackupService"
}

func (s *DesktopBackupService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	_, err := s.database()
	return err
}

func (s *DesktopBackupService) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return nil
	}

	err := s.db.Close()
	s.db = nil
	return err
}

func (s *DesktopBackupService) ExportBackup(input DesktopBackupExportInput) (DesktopBackupExportResult, error) {
	if !input.IncludeDatabase {
		return DesktopBackupExportResult{}, errors.New("desktop backup supports database data only")
	}
	if input.IncludeSensitive {
		if err := validateDesktopAgeEncryptionOptions(input.AgePassphrase, input.AgeRecipients); err != nil {
			return DesktopBackupExportResult{}, err
		}
	}

	database, err := s.database()
	if err != nil {
		return DesktopBackupExportResult{}, err
	}

	backup := desktopUnifiedBackup{
		Format:     backuputil.Format,
		Version:    backuputil.Version,
		ExportTime: time.Now().UTC().Format(time.RFC3339),
		Contents: desktopBackupContents{
			Config:    false,
			Database:  true,
			Sensitive: input.IncludeSensitive,
		},
		Database: &desktopBackupSection{
			Driver: "sqlite",
			Tables: []desktopBackupTable{},
		},
	}

	notifications, err := s.snapshotNotifications()
	if err != nil {
		return DesktopBackupExportResult{}, err
	}
	tables, err := exportDesktopBackupTables(database, notifications, backup.ExportTime)
	if err != nil {
		return DesktopBackupExportResult{}, err
	}
	backup.Database.Tables = tables

	if input.IncludeSensitive {
		baseSHA256, err := backuputil.BaseSHA256(&backup)
		if err != nil {
			return DesktopBackupExportResult{}, err
		}
		sensitivePayload, err := exportDesktopSensitivePayload(database, backup.ExportTime, baseSHA256)
		if err != nil {
			return DesktopBackupExportResult{}, err
		}
		ciphertext, err := encryptDesktopSensitivePayload(sensitivePayload, input.AgePassphrase, input.AgeRecipients)
		if err != nil {
			return DesktopBackupExportResult{}, err
		}
		backup.Sensitive = ciphertext
		backup.Warnings = append(backup.Warnings, sensitivePayload.Warnings...)
	}

	content, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		return DesktopBackupExportResult{}, err
	}

	prefix := "easyssh_desktop_backup"
	if input.IncludeSensitive {
		prefix = "easyssh_desktop_full_backup"
	}

	return DesktopBackupExportResult{
		Filename: fmt.Sprintf("%s_%s.json", prefix, time.Now().Format("20060102_150405")),
		Content:  string(content),
	}, nil
}

func (s *DesktopBackupService) RestoreBackup(input DesktopBackupRestoreInput) (DesktopBackupRestoreResult, error) {
	if strings.TrimSpace(input.Content) == "" {
		return DesktopBackupRestoreResult{}, errors.New("backup content is required")
	}
	if len(input.Content) > backuputil.MaxRestoreFileSizeBytes {
		return DesktopBackupRestoreResult{}, errors.New("backup file is too large")
	}
	if !input.IncludeDatabase {
		return DesktopBackupRestoreResult{}, errors.New("desktop restore supports database data only")
	}

	var backup desktopUnifiedBackup
	decoder := json.NewDecoder(bytes.NewReader([]byte(input.Content)))
	decoder.UseNumber()
	if err := decoder.Decode(&backup); err != nil {
		return DesktopBackupRestoreResult{}, fmt.Errorf("invalid backup file: %w", err)
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		return DesktopBackupRestoreResult{}, errors.New("invalid backup file: trailing data")
	}
	if err := backuputil.ValidateUnifiedBackup(&backup); err != nil {
		return DesktopBackupRestoreResult{}, err
	}
	if backup.Database == nil {
		return DesktopBackupRestoreResult{}, errors.New("backup file does not include database")
	}

	allowSensitiveDatabaseRestore := false
	if strings.TrimSpace(backup.Sensitive) != "" {
		if err := validateDesktopAgeDecryptionOptions(input.AgePassphrase, input.AgeIdentities); err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		sanitizeDesktopPlainSensitive(&backup)
		sensitivePayload, err := decryptDesktopSensitivePayload(backup.Sensitive, input.AgePassphrase, input.AgeIdentities)
		if err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		if err := backuputil.VerifySensitiveBaseSHA256(&backup, sensitivePayload); err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		if err := mergeDesktopSensitivePayload(&backup, sensitivePayload); err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		allowSensitiveDatabaseRestore = sensitivePayload.Database != nil
	}

	strategy, err := backuputil.ParseRestoreConflictStrategy(input.ConflictStrategy)
	if err != nil {
		return DesktopBackupRestoreResult{}, err
	}
	database, err := s.database()
	if err != nil {
		return DesktopBackupRestoreResult{}, err
	}

	tx, err := database.Begin()
	if err != nil {
		return DesktopBackupRestoreResult{}, err
	}
	defer tx.Rollback()

	var result DesktopBackupRestoreResult
	var notificationTable *desktopBackupTable
	taskDataRestored := false
	for _, table := range orderedDesktopBackupTables(backup.Database.Tables) {
		tableName := strings.ToLower(strings.TrimSpace(table.Name))
		if tableName == "inbox_notifications" {
			current := table
			notificationTable = &current
			continue
		}
		if tableName == "task_runs" || tableName == "task_events" {
			taskDataRestored = true
		}
		if err := restoreDesktopBackupTable(tx, table, strategy, &result, allowSensitiveDatabaseRestore); err != nil {
			return DesktopBackupRestoreResult{}, err
		}
	}

	notificationsLocked := false
	if notificationTable != nil && s.notifications != nil {
		s.notifications.mu.Lock()
		notificationsLocked = true
	}
	defer func() {
		if notificationsLocked {
			s.notifications.mu.Unlock()
		}
	}()

	var notificationStage string
	var restoredNotifications []DesktopNotification
	if notificationTable != nil {
		currentNotifications, err := readDesktopNotifications()
		if err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		restoredNotifications, err = restoreDesktopInboxNotifications(tx, *notificationTable, currentNotifications, strategy, &result)
		if err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		// Prewrite the JSON sidecar so a file error can still roll back the SQLite transaction.
		notificationStage, err = stageDesktopNotifications(restoredNotifications)
		if err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		defer func() {
			if notificationStage != "" {
				_ = os.Remove(notificationStage)
			}
		}()
	}

	if err := tx.Commit(); err != nil {
		return result, err
	}
	if notificationStage != "" {
		if err := commitDesktopNotificationsStage(notificationStage); err != nil {
			return result, fmt.Errorf("database restored but notifications restore failed: %w", err)
		}
		notificationStage = ""
		if s.notifications != nil {
			s.notifications.updateTrayTooltipLocked(restoredNotifications)
		}
	}
	if taskDataRestored && s.tasks != nil {
		s.tasks.emitChanged("task.restore.completed", "")
	}
	return result, nil
}

func (s *DesktopBackupService) database() (*sql.DB, error) {
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

	if err := configureDesktopServerDatabase(database); err != nil {
		database.Close()
		return nil, err
	}
	if err := configureDesktopScriptDatabase(database); err != nil {
		database.Close()
		return nil, err
	}
	if err := configureActivityDatabase(database); err != nil {
		database.Close()
		return nil, err
	}
	if err := configureDesktopTaskDatabase(database); err != nil {
		database.Close()
		return nil, err
	}

	s.db = database
	return s.db, nil
}

func (s *DesktopBackupService) snapshotNotifications() ([]DesktopNotification, error) {
	if s.notifications == nil {
		return readDesktopNotifications()
	}
	s.notifications.mu.Lock()
	defer s.notifications.mu.Unlock()
	items, err := readDesktopNotifications()
	if err != nil {
		return nil, err
	}
	return append([]DesktopNotification(nil), items...), nil
}

func exportDesktopBackupTables(database *sql.DB, notifications []DesktopNotification, exportTime string) ([]desktopBackupTable, error) {
	tables := make([]desktopBackupTable, 0, 8)
	now := time.Now().UTC().Format(time.RFC3339Nano)

	tables = append(tables, desktopBackupTable{
		Name:       "users",
		PrimaryKey: []string{"id"},
		Columns: []string{
			"id", "username", "email", "role", "avatar", "language", "timezone",
			"notify_email_login", "notify_email_alert", "notify_browser", "notify_new_device",
			"notify_new_location", "notify_suspicious", "monitor_data_source", "created_at", "updated_at",
		},
		Rows: []map[string]any{{
			"id":                  desktopBackupUserID,
			"username":            desktopBackupUsername,
			"email":               desktopBackupEmail,
			"role":                desktopBackupWebCompatibleRole,
			"avatar":              "",
			"language":            "",
			"timezone":            "Asia/Shanghai",
			"notify_email_login":  true,
			"notify_email_alert":  true,
			"notify_browser":      true,
			"notify_new_device":   true,
			"notify_new_location": true,
			"notify_suspicious":   true,
			"monitor_data_source": "easyssh",
			"created_at":          now,
			"updated_at":          now,
		}},
	})

	servers, err := exportDesktopServers(database)
	if err != nil {
		return nil, err
	}
	tables = append(tables, servers)

	scripts, err := exportDesktopScripts(database)
	if err != nil {
		return nil, err
	}
	tables = append(tables, scripts)

	tasks, err := exportDesktopBatchTasks(database)
	if err != nil {
		return nil, err
	}
	tables = append(tables, tasks)

	records, err := exportDesktopOperationRecords(database)
	if err != nil {
		return nil, err
	}
	tables = append(tables, records)

	taskRuns, taskMapping, err := exportDesktopTaskRuns(database, exportTime)
	if err != nil {
		return nil, err
	}
	tables = append(tables, taskRuns)

	taskEvents, err := exportDesktopTaskEvents(database, taskMapping, exportTime)
	if err != nil {
		return nil, err
	}
	tables = append(tables, taskEvents)
	tables = append(tables, exportDesktopInboxNotifications(notifications, taskMapping))

	return tables, nil
}

func exportDesktopServers(database *sql.DB) (desktopBackupTable, error) {
	table := desktopBackupTable{
		Name:       "servers",
		PrimaryKey: []string{"id"},
		Columns: []string{
			"id", "user_id", "name", "host", "port", "username", "auth_method", "server_group",
			"tags", "status", "last_connected", "description", "os", "sort_order", "created_at", "updated_at",
		},
		Rows: []map[string]any{},
	}

	rows, err := database.Query(`
		SELECT id, name, host, port, username, auth_method, server_group, tags_json,
			status, last_connected, description, os, sort_order, created_at, updated_at
		FROM desktop_servers
		ORDER BY sort_order ASC, created_at ASC, id ASC`)
	if err != nil {
		return table, err
	}
	defer rows.Close()

	for rows.Next() {
		var id, name, host, username, authMethod, group, tagsJSON, status, lastConnected, description, osValue, createdAt, updatedAt string
		var port, sortOrder int
		if err := rows.Scan(&id, &name, &host, &port, &username, &authMethod, &group, &tagsJSON, &status, &lastConnected, &description, &osValue, &sortOrder, &createdAt, &updatedAt); err != nil {
			return table, err
		}
		backupID := desktopBackupUUID("server", id)
		table.Rows = append(table.Rows, map[string]any{
			"id":             backupID,
			"user_id":        desktopBackupUserID,
			"name":           name,
			"host":           host,
			"port":           port,
			"username":       username,
			"auth_method":    authMethod,
			"server_group":   group,
			"tags":           normalizeDesktopJSONText(tagsJSON),
			"status":         status,
			"last_connected": nullableDesktopString(lastConnected),
			"description":    description,
			"os":             osValue,
			"sort_order":     sortOrder,
			"created_at":     createdAt,
			"updated_at":     updatedAt,
		})
	}
	return table, rows.Err()
}

func exportDesktopScripts(database *sql.DB) (desktopBackupTable, error) {
	table := desktopBackupTable{
		Name:       "scripts",
		PrimaryKey: []string{"id"},
		Columns: []string{
			"id", "user_id", "name", "description", "content", "language", "tags", "executions",
			"author", "created_at", "updated_at",
		},
		Rows: []map[string]any{},
	}

	rows, err := database.Query(`
		SELECT id, name, description, content, language, tags_json, executions, author, created_at, updated_at
		FROM desktop_scripts
		ORDER BY updated_at DESC, created_at DESC, id DESC`)
	if err != nil {
		return table, err
	}
	defer rows.Close()

	for rows.Next() {
		var id, name, description, content, language, tagsJSON, author, createdAt, updatedAt string
		var executions int
		if err := rows.Scan(&id, &name, &description, &content, &language, &tagsJSON, &executions, &author, &createdAt, &updatedAt); err != nil {
			return table, err
		}
		backupID := desktopBackupUUID("script", id)
		table.Rows = append(table.Rows, map[string]any{
			"id":          backupID,
			"user_id":     desktopBackupUserID,
			"name":        name,
			"description": description,
			"content":     content,
			"language":    language,
			"tags":        normalizeDesktopJSONText(tagsJSON),
			"executions":  executions,
			"author":      author,
			"created_at":  createdAt,
			"updated_at":  updatedAt,
		})
	}
	return table, rows.Err()
}

func exportDesktopBatchTasks(database *sql.DB) (desktopBackupTable, error) {
	table := desktopBackupTable{
		Name:       "batch_tasks",
		PrimaryKey: []string{"id"},
		Columns: []string{
			"id", "user_id", "task_name", "task_type", "content", "script_id", "server_ids",
			"execution_mode", "status", "success_count", "failed_count", "started_at",
			"completed_at", "duration", "created_at", "updated_at",
		},
		Rows: []map[string]any{},
	}

	rows, err := database.Query(`
		SELECT id, task_name, task_type, content, script_id, server_ids_json, execution_mode,
			status, success_count, failed_count, started_at, completed_at, duration, created_at, updated_at
		FROM desktop_batch_tasks
		ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return table, err
	}
	defer rows.Close()

	for rows.Next() {
		var id, taskName, taskType, content, scriptID, serverIDsJSON, executionMode, status, startedAt, completedAt, createdAt, updatedAt string
		var successCount, failedCount, duration int
		if err := rows.Scan(&id, &taskName, &taskType, &content, &scriptID, &serverIDsJSON, &executionMode, &status, &successCount, &failedCount, &startedAt, &completedAt, &duration, &createdAt, &updatedAt); err != nil {
			return table, err
		}
		backupID := desktopBackupUUID("batch-task", id)
		table.Rows = append(table.Rows, map[string]any{
			"id":             backupID,
			"user_id":        desktopBackupUserID,
			"task_name":      taskName,
			"task_type":      taskType,
			"content":        content,
			"script_id":      nullableDesktopBackupUUID("script", scriptID),
			"server_ids":     desktopBackupServerIDsJSON(serverIDsJSON),
			"execution_mode": executionMode,
			"status":         status,
			"success_count":  successCount,
			"failed_count":   failedCount,
			"started_at":     nullableDesktopString(startedAt),
			"completed_at":   nullableDesktopString(completedAt),
			"duration":       duration,
			"created_at":     createdAt,
			"updated_at":     updatedAt,
		})
	}
	return table, rows.Err()
}

func exportDesktopOperationRecords(database *sql.DB) (desktopBackupTable, error) {
	table := desktopBackupTable{
		Name:       "operation_records",
		PrimaryKey: []string{"id"},
		Columns: []string{
			"id", "user_id", "username", "type", "category", "action", "status", "server_id",
			"server_name", "title", "resource", "source", "ip", "user_agent", "started_at", "finished_at",
			"duration_ms", "progress", "total_count", "success_count", "failure_count", "bytes_total",
			"bytes_processed", "speed_bps", "error_message", "detail_json", "source_table", "source_id",
			"created_at", "updated_at",
		},
		Rows: []map[string]any{},
	}

	rows, err := database.Query(`
		SELECT id, action, resource, status, COALESCE(server_id, ''), COALESCE(duration_ms, 0), COALESCE(detail, ''), created_at, updated_at
		FROM activity_logs
		ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return table, err
	}
	defer rows.Close()

	for rows.Next() {
		var id, action, resource, status, serverID, detail, createdAt, updatedAt string
		var durationMs int64
		if err := rows.Scan(&id, &action, &resource, &status, &serverID, &durationMs, &detail, &createdAt, &updatedAt); err != nil {
			return table, err
		}
		sourceID := id
		recordID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("easyssh-desktop-activity:"+sourceID)).String()
		successCount, failureCount := desktopRecordCounts(status)
		table.Rows = append(table.Rows, map[string]any{
			"id":              recordID,
			"user_id":         desktopBackupUserID,
			"username":        desktopBackupUsername,
			"type":            desktopRecordType(action),
			"category":        "activity",
			"action":          action,
			"status":          status,
			"server_id":       nullableDesktopBackupUUID("server", serverID),
			"server_name":     "",
			"title":           action,
			"resource":        resource,
			"source":          "desktop",
			"ip":              "",
			"user_agent":      "EasySSH",
			"started_at":      createdAt,
			"finished_at":     desktopFinishedAt(createdAt, durationMs),
			"duration_ms":     durationMs,
			"progress":        100,
			"total_count":     1,
			"success_count":   successCount,
			"failure_count":   failureCount,
			"bytes_total":     0,
			"bytes_processed": 0,
			"speed_bps":       0,
			"error_message":   desktopRecordError(status, detail),
			"detail_json":     detail,
			"source_table":    "desktop_activity_logs",
			"source_id":       sourceID,
			"created_at":      createdAt,
			"updated_at":      updatedAt,
		})
	}
	return table, rows.Err()
}

type desktopTaskBackupMapping struct {
	runIDs     map[string]string
	activeRuns map[string]struct{}
}

func exportDesktopTaskRuns(database *sql.DB, exportTime string) (desktopBackupTable, desktopTaskBackupMapping, error) {
	table := desktopBackupTable{
		Name:       "task_runs",
		PrimaryKey: []string{"id"},
		Columns: []string{
			"id", "user_id", "definition_id", "retry_of_id", "source_type", "source_id", "task_type", "title",
			"description", "trigger_type", "runner", "status", "stage", "server_id", "server_name", "resource",
			"payload_json", "result_json", "progress", "total_count", "success_count", "failure_count", "bytes_total",
			"bytes_processed", "progress_json", "cancelable", "retryable", "attempt", "max_attempts", "error_code",
			"error_message", "cancel_requested_at", "started_at", "finished_at", "created_at", "updated_at",
		},
		Rows: []map[string]any{},
	}
	mapping := desktopTaskBackupMapping{runIDs: make(map[string]string), activeRuns: make(map[string]struct{})}
	rows, err := database.Query(desktopTaskSelectSQL + " ORDER BY created_at ASC, id ASC")
	if err != nil {
		return table, mapping, err
	}
	defer rows.Close()
	runs := make([]DesktopTaskRun, 0)
	for rows.Next() {
		run, scanErr := scanDesktopTaskRun(rows)
		if scanErr != nil {
			return table, mapping, scanErr
		}
		runs = append(runs, run)
		mapping.runIDs[run.ID] = desktopBackupUUID("task-run", run.ID)
		if !desktopTaskIsTerminal(run.Status) {
			mapping.activeRuns[run.ID] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return table, mapping, err
	}
	for _, run := range runs {
		backupID := mapping.runIDs[run.ID]
		status := run.Status
		errorCode := run.ErrorCode
		errorMessage := run.ErrorMessage
		cancelRequestedAt := nullableDesktopString(run.CancelRequestedAt)
		finishedAt := nullableDesktopString(run.FinishedAt)
		updatedAt := run.UpdatedAt
		if _, active := mapping.activeRuns[run.ID]; active {
			// A backup can preserve task history, but not the process, connection, or cancellation context.
			status = "failed"
			errorCode = "desktop_backup_interrupted"
			errorMessage = "任务执行上下文无法通过备份恢复"
			cancelRequestedAt = nil
			finishedAt = exportTime
			updatedAt = exportTime
		} else if run.FinishedAt == "" {
			finishedAt = firstNonEmptyDesktopString(run.UpdatedAt, run.CreatedAt, exportTime)
		}
		sourceID := run.SourceID
		switch run.SourceType {
		case "desktop_sftp":
			sourceID = backupID
		case "desktop_batch_task":
			sourceID = desktopBackupUUID("batch-task", sourceID)
		}
		table.Rows = append(table.Rows, map[string]any{
			"id":                  backupID,
			"user_id":             desktopBackupUserID,
			"definition_id":       nullableDesktopBackupUUID("task-definition", run.DefinitionID),
			"retry_of_id":         nullableDesktopTaskRunBackupID(mapping, run.RetryOfID),
			"source_type":         run.SourceType,
			"source_id":           sourceID,
			"task_type":           run.TaskType,
			"title":               run.Title,
			"description":         run.Description,
			"trigger_type":        run.TriggerType,
			"runner":              "desktop",
			"status":              status,
			"stage":               run.Stage,
			"server_id":           nullableDesktopBackupUUID("server", run.ServerID),
			"server_name":         run.ServerName,
			"resource":            run.Resource,
			"payload_json":        desktopBackupTaskPayloadJSON(run.PayloadJSON),
			"result_json":         run.ResultJSON,
			"progress":            run.Progress,
			"total_count":         run.TotalCount,
			"success_count":       run.SuccessCount,
			"failure_count":       run.FailureCount,
			"bytes_total":         run.BytesTotal,
			"bytes_processed":     run.BytesProcessed,
			"progress_json":       run.ProgressJSON,
			"cancelable":          run.Cancelable,
			"retryable":           run.Retryable,
			"attempt":             run.Attempt,
			"max_attempts":        run.MaxAttempts,
			"error_code":          errorCode,
			"error_message":       errorMessage,
			"cancel_requested_at": cancelRequestedAt,
			"started_at":          nullableDesktopString(run.StartedAt),
			"finished_at":         finishedAt,
			"created_at":          run.CreatedAt,
			"updated_at":          updatedAt,
		})
	}
	return table, mapping, nil
}

func exportDesktopTaskEvents(database *sql.DB, mapping desktopTaskBackupMapping, exportTime string) (desktopBackupTable, error) {
	table := desktopBackupTable{
		Name:       "task_events",
		PrimaryKey: []string{"id"},
		Columns:    []string{"id", "task_run_id", "user_id", "level", "message", "data_json", "created_at"},
		Rows:       []map[string]any{},
	}
	rows, err := database.Query(`SELECT task_run_id, level, message, data_json, created_at FROM desktop_task_events ORDER BY created_at ASC, id ASC`)
	if err != nil {
		return table, err
	}
	defer rows.Close()
	for rows.Next() {
		var taskRunID, level, message, dataJSON, createdAt string
		if err := rows.Scan(&taskRunID, &level, &message, &dataJSON, &createdAt); err != nil {
			return table, err
		}
		backupRunID, exists := mapping.runIDs[taskRunID]
		if !exists {
			continue
		}
		table.Rows = append(table.Rows, desktopTaskEventBackupRow(backupRunID, level, message, dataJSON, createdAt))
	}
	if err := rows.Err(); err != nil {
		return table, err
	}
	activeRunIDs := make([]string, 0, len(mapping.activeRuns))
	for taskRunID := range mapping.activeRuns {
		activeRunIDs = append(activeRunIDs, taskRunID)
	}
	sort.Strings(activeRunIDs)
	for _, taskRunID := range activeRunIDs {
		backupRunID := mapping.runIDs[taskRunID]
		table.Rows = append(table.Rows, desktopTaskEventBackupRow(backupRunID, "error", "任务执行上下文无法通过备份恢复", "", exportTime))
	}
	return table, nil
}

func desktopTaskEventBackupRow(taskRunID string, level string, message string, dataJSON string, createdAt string) map[string]any {
	return map[string]any{
		"id":          desktopBackupTaskEventID(taskRunID, level, message, dataJSON, createdAt),
		"task_run_id": taskRunID,
		"user_id":     desktopBackupUserID,
		"level":       level,
		"message":     message,
		"data_json":   dataJSON,
		"created_at":  createdAt,
	}
}

func exportDesktopInboxNotifications(items []DesktopNotification, mapping desktopTaskBackupMapping) desktopBackupTable {
	table := desktopBackupTable{
		Name:       "inbox_notifications",
		PrimaryKey: []string{"id"},
		Columns: []string{
			"id", "user_id", "event_type", "severity", "title", "message", "source_type", "source_id",
			"action_url", "data_json", "read_at", "created_at",
		},
		Rows: []map[string]any{},
	}
	for _, item := range items {
		sourceID := item.SourceID
		actionURL := item.ActionURL
		if item.SourceType == "task_run" {
			mappedID, exists := mapping.runIDs[item.SourceID]
			if !exists {
				continue
			}
			sourceID = mappedID
			actionURL = "/dashboard/tasks?run=" + mappedID
		}
		table.Rows = append(table.Rows, map[string]any{
			"id":          desktopBackupUUID("notification", item.ID),
			"user_id":     desktopBackupUserID,
			"event_type":  item.EventType,
			"severity":    item.Severity,
			"title":       item.Title,
			"message":     item.Message,
			"source_type": item.SourceType,
			"source_id":   sourceID,
			"action_url":  actionURL,
			"data_json":   "",
			"read_at":     nullableDesktopString(item.ReadAt),
			"created_at":  item.CreatedAt,
		})
	}
	return table
}

func exportDesktopSensitivePayload(database *sql.DB, exportTime string, baseSHA256 string) (*desktopBackupSensitivePayload, error) {
	servers, err := exportDesktopSensitiveServers(database)
	if err != nil {
		return nil, err
	}

	return &desktopBackupSensitivePayload{
		Version:    backuputil.SensitivePayloadVersion,
		ExportTime: exportTime,
		Contents: desktopBackupContents{
			Config:    false,
			Database:  true,
			Sensitive: true,
		},
		BaseSHA256: baseSHA256,
		Database: &desktopBackupSection{
			Driver: "sqlite",
			Tables: []desktopBackupTable{servers},
		},
		Warnings: []string{
			"desktop server passwords and private keys are encrypted with the backup password.",
			"web-only sensitive tables are ignored by desktop restore.",
		},
	}, nil
}

func exportDesktopSensitiveServers(database *sql.DB) (desktopBackupTable, error) {
	table := desktopBackupTable{
		Name:       "servers",
		PrimaryKey: []string{"id"},
		Columns:    []string{"id", "user_id", "password", "private_key"},
		Rows:       []map[string]any{},
	}

	rows, err := database.Query(`
		SELECT id, password, private_key
		FROM desktop_servers
		ORDER BY sort_order ASC, created_at ASC, id ASC`)
	if err != nil {
		return table, err
	}
	defer rows.Close()

	for rows.Next() {
		var id, password, privateKey string
		if err := rows.Scan(&id, &password, &privateKey); err != nil {
			return table, err
		}
		table.Rows = append(table.Rows, map[string]any{
			"id":          desktopBackupUUID("server", id),
			"user_id":     desktopBackupUserID,
			"password":    password,
			"private_key": privateKey,
		})
	}
	return table, rows.Err()
}

func validateDesktopAgeEncryptionOptions(passphrase string, recipients []string) error {
	hasPassphrase := strings.TrimSpace(passphrase) != ""
	hasRecipients := len(recipients) != 0
	if hasPassphrase == hasRecipients {
		return errors.New("exactly one age encryption method is required: passphrase or X25519 recipients")
	}
	return nil
}

func validateDesktopAgeDecryptionOptions(passphrase string, identities []string) error {
	hasPassphrase := strings.TrimSpace(passphrase) != ""
	hasIdentities := len(identities) != 0
	if hasPassphrase == hasIdentities {
		return errors.New("exactly one age decryption method is required: passphrase or X25519 identities")
	}
	return nil
}

func encryptDesktopSensitivePayload(payload *desktopBackupSensitivePayload, passphrase string, recipients []string) (string, error) {
	if strings.TrimSpace(passphrase) != "" {
		return backupcrypto.EncryptJSONWithPassphrase(payload, passphrase)
	}
	return backupcrypto.EncryptJSONWithRecipients(payload, recipients)
}

func decryptDesktopSensitivePayload(ciphertext string, passphrase string, identities []string) (*desktopBackupSensitivePayload, error) {
	var payload desktopBackupSensitivePayload
	if err := backupcrypto.DecryptJSON(ciphertext, passphrase, identities, &payload); err != nil {
		return nil, err
	}
	if strings.TrimSpace(payload.Version) != backuputil.SensitivePayloadVersion {
		return nil, fmt.Errorf("unsupported sensitive backup payload version: %s", payload.Version)
	}
	return &payload, nil
}

func sanitizeDesktopPlainSensitive(backup *desktopUnifiedBackup) {
	if backup.Database == nil {
		return
	}
	for tableIndex := range backup.Database.Tables {
		table := &backup.Database.Tables[tableIndex]
		if !strings.EqualFold(table.Name, "servers") {
			continue
		}
		table.Columns = removeDesktopBackupColumns(table.Columns, "password", "private_key")
		for rowIndex := range table.Rows {
			delete(table.Rows[rowIndex], "password")
			delete(table.Rows[rowIndex], "private_key")
		}
	}
}

func mergeDesktopSensitivePayload(backup *desktopUnifiedBackup, payload *desktopBackupSensitivePayload) error {
	if payload == nil {
		return nil
	}
	if payload.Contents.Config != backup.Contents.Config || payload.Contents.Database != backup.Contents.Database || !payload.Contents.Sensitive {
		return errors.New("sensitive backup contents do not match desktop backup")
	}
	if backup.Database == nil || payload.Database == nil {
		return errors.New("sensitive database payload has no matching database section")
	}

	targetTables := make(map[string]*desktopBackupTable, len(backup.Database.Tables))
	for i := range backup.Database.Tables {
		targetTables[strings.ToLower(strings.TrimSpace(backup.Database.Tables[i].Name))] = &backup.Database.Tables[i]
	}

	for _, sensitiveTable := range payload.Database.Tables {
		if !strings.EqualFold(sensitiveTable.Name, "servers") {
			continue
		}
		targetTable := targetTables["servers"]
		if targetTable == nil {
			return errors.New("sensitive servers payload has no matching base table")
		}
		if err := mergeDesktopSensitiveServerTable(targetTable, sensitiveTable); err != nil {
			return err
		}
	}
	backup.Contents.Sensitive = true
	return nil
}

func mergeDesktopSensitiveServerTable(target *desktopBackupTable, sensitive desktopBackupTable) error {
	for _, column := range sensitive.Columns {
		if !desktopBackupColumnAllowed(column, "id", "user_id", "password", "private_key") {
			return fmt.Errorf("sensitive servers table contains unsupported column %s", column)
		}
	}

	target.Columns = appendDesktopBackupColumn(target.Columns, "password")
	target.Columns = appendDesktopBackupColumn(target.Columns, "private_key")

	for _, sensitiveRow := range sensitive.Rows {
		targetRow := findDesktopBackupRowByID(target.Rows, firstDesktopString(sensitiveRow, "id"))
		if targetRow == nil {
			return fmt.Errorf("sensitive servers row is missing in base backup: id=%s", firstDesktopString(sensitiveRow, "id"))
		}
		if value, ok := sensitiveRow["password"]; ok {
			targetRow["password"] = value
		}
		if value, ok := sensitiveRow["private_key"]; ok {
			targetRow["private_key"] = value
		}
	}
	return nil
}

func findDesktopBackupRowByID(rows []map[string]any, id string) map[string]any {
	for _, row := range rows {
		if firstDesktopString(row, "id") == id {
			return row
		}
	}
	return nil
}

func appendDesktopBackupColumn(columns []string, column string) []string {
	for _, current := range columns {
		if strings.EqualFold(current, column) {
			return columns
		}
	}
	return append(columns, column)
}

func removeDesktopBackupColumns(columns []string, removed ...string) []string {
	result := make([]string, 0, len(columns))
	for _, column := range columns {
		if desktopBackupColumnAllowed(column, removed...) {
			continue
		}
		result = append(result, column)
	}
	return result
}

func desktopBackupColumnAllowed(column string, allowed ...string) bool {
	for _, current := range allowed {
		if strings.EqualFold(strings.TrimSpace(column), current) {
			return true
		}
	}
	return false
}

func restoreDesktopBackupTable(tx *sql.Tx, table desktopBackupTable, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult, allowSensitive bool) error {
	switch strings.ToLower(strings.TrimSpace(table.Name)) {
	case "servers":
		for _, row := range table.Rows {
			if err := restoreDesktopServerRow(tx, row, strategy, result, allowSensitive); err != nil {
				return err
			}
		}
	case "scripts":
		for _, row := range table.Rows {
			if err := restoreDesktopScriptRow(tx, row, strategy, result); err != nil {
				return err
			}
		}
	case "batch_tasks":
		for _, row := range table.Rows {
			if err := restoreDesktopBatchTaskRow(tx, row, strategy, result); err != nil {
				return err
			}
		}
	case "operation_records":
		for _, row := range table.Rows {
			if err := restoreDesktopActivityRow(tx, row, strategy, result); err != nil {
				return err
			}
		}
	case "task_runs":
		for _, row := range table.Rows {
			if err := restoreDesktopTaskRunRow(tx, row, strategy, result); err != nil {
				return err
			}
		}
	case "task_events":
		for _, row := range table.Rows {
			if err := restoreDesktopTaskEventRow(tx, row, strategy, result); err != nil {
				return err
			}
		}
	}
	return nil
}

func orderedDesktopBackupTables(tables []desktopBackupTable) []desktopBackupTable {
	priorities := []string{"users", "servers", "scripts", "batch_tasks", "operation_records", "task_runs", "task_events", "inbox_notifications"}
	ordered := make([]desktopBackupTable, 0, len(tables))
	used := make([]bool, len(tables))
	for _, name := range priorities {
		for index, table := range tables {
			if !used[index] && strings.EqualFold(strings.TrimSpace(table.Name), name) {
				ordered = append(ordered, table)
				used[index] = true
			}
		}
	}
	for index, table := range tables {
		if !used[index] {
			ordered = append(ordered, table)
		}
	}
	return ordered
}

func restoreDesktopServerRow(tx *sql.Tx, row map[string]any, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult, allowSensitive bool) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := firstDesktopString(row, "id")
	if id == "" {
		id = newDesktopServerID()
	}
	values := map[string]any{
		"id":             id,
		"user_id":        desktopLocalDataUserID,
		"name":           firstDesktopString(row, "name"),
		"host":           firstDesktopString(row, "host"),
		"port":           desktopIntValue(row["port"], 22),
		"username":       firstDesktopString(row, "username"),
		"auth_method":    normalizeDesktopBackupAuthMethod(firstDesktopString(row, "auth_method")),
		"server_group":   firstDesktopString(row, "server_group", "group"),
		"tags_json":      desktopJSONText(row["tags"]),
		"status":         normalizeDesktopBackupServerStatus(firstDesktopString(row, "status")),
		"last_connected": firstDesktopString(row, "last_connected"),
		"description":    firstDesktopString(row, "description"),
		"os":             firstDesktopString(row, "os"),
		"sort_order":     desktopIntValue(row["sort_order"], 0),
		"created_at":     desktopTimeValue(row["created_at"], now),
		"updated_at":     desktopTimeValue(row["updated_at"], now),
	}
	if allowSensitive {
		if _, ok := row["password"]; ok {
			values["password"] = firstDesktopString(row, "password")
		}
		if _, ok := row["private_key"]; ok {
			values["private_key"] = firstDesktopString(row, "private_key")
		}
	}
	return restoreDesktopMappedRow(tx, "desktop_servers", id, values, strategy, result)
}

func restoreDesktopScriptRow(tx *sql.Tx, row map[string]any, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := firstDesktopString(row, "id")
	if id == "" {
		id = newDesktopScriptID()
	}
	values := map[string]any{
		"id":          id,
		"user_id":     desktopLocalDataUserID,
		"name":        firstDesktopString(row, "name"),
		"description": firstDesktopString(row, "description"),
		"content":     firstDesktopString(row, "content"),
		"language":    firstDesktopString(row, "language"),
		"tags_json":   desktopJSONText(row["tags"]),
		"executions":  desktopIntValue(row["executions"], 0),
		"author":      firstNonEmptyDesktopString(firstDesktopString(row, "author"), "desktop"),
		"created_at":  desktopTimeValue(row["created_at"], now),
		"updated_at":  desktopTimeValue(row["updated_at"], now),
	}
	if strings.TrimSpace(fmt.Sprint(values["language"])) == "" {
		values["language"] = "bash"
	}
	return restoreDesktopMappedRow(tx, "desktop_scripts", id, values, strategy, result)
}

func restoreDesktopBatchTaskRow(tx *sql.Tx, row map[string]any, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := firstDesktopString(row, "id")
	if id == "" {
		id = newDesktopBatchTaskID()
	}
	values := map[string]any{
		"id":              id,
		"user_id":         desktopLocalDataUserID,
		"task_name":       firstDesktopString(row, "task_name"),
		"task_type":       firstNonEmptyDesktopString(firstDesktopString(row, "task_type"), "script"),
		"content":         firstDesktopString(row, "content"),
		"script_id":       firstDesktopString(row, "script_id"),
		"server_ids_json": desktopJSONText(row["server_ids"]),
		"execution_mode":  firstNonEmptyDesktopString(firstDesktopString(row, "execution_mode"), "parallel"),
		"status":          firstNonEmptyDesktopString(firstDesktopString(row, "status"), "pending"),
		"success_count":   desktopIntValue(row["success_count"], 0),
		"failed_count":    desktopIntValue(row["failed_count"], 0),
		"started_at":      firstDesktopString(row, "started_at"),
		"completed_at":    firstDesktopString(row, "completed_at"),
		"duration":        desktopIntValue(row["duration"], 0),
		"created_at":      desktopTimeValue(row["created_at"], now),
		"updated_at":      desktopTimeValue(row["updated_at"], now),
	}
	return restoreDesktopMappedRow(tx, "desktop_batch_tasks", id, values, strategy, result)
}

func restoreDesktopActivityRow(tx *sql.Tx, row map[string]any, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := firstDesktopString(row, "id")
	if strings.EqualFold(firstDesktopString(row, "source_table"), "desktop_activity_logs") {
		id = firstNonEmptyDesktopString(firstDesktopString(row, "source_id"), id)
	}
	if id == "" {
		id = newActivityLogID()
	}
	status := normalizeDesktopActivityStatus(firstDesktopString(row, "status"))
	values := map[string]any{
		"id":          id,
		"action":      firstDesktopString(row, "action"),
		"resource":    firstDesktopString(row, "resource", "title"),
		"status":      status,
		"server_id":   nullableRestoreString(firstDesktopString(row, "server_id")),
		"duration_ms": desktopInt64Value(row["duration_ms"], 0),
		"detail":      firstDesktopString(row, "detail_json", "error_message"),
		"created_at":  desktopTimeValue(row["created_at"], now),
		"updated_at":  desktopTimeValue(row["updated_at"], now),
	}
	return restoreDesktopMappedRow(tx, "activity_logs", id, values, strategy, result)
}

func restoreDesktopTaskRunRow(tx *sql.Tx, row map[string]any, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := desktopBackupUUID("task-run", firstDesktopString(row, "id"))
	if id == "" {
		id = uuid.NewString()
	}
	status, interrupted := normalizeDesktopRestoredTaskStatus(firstDesktopString(row, "status"))
	errorCode := firstDesktopString(row, "error_code")
	errorMessage := firstDesktopString(row, "error_message")
	cancelRequestedAt := firstDesktopString(row, "cancel_requested_at")
	finishedAt := firstDesktopString(row, "finished_at")
	if interrupted {
		errorCode = "desktop_restore_interrupted"
		errorMessage = "任务执行上下文无法通过备份恢复"
		cancelRequestedAt = ""
		finishedAt = now
	} else if finishedAt == "" {
		finishedAt = firstNonEmptyDesktopString(firstDesktopString(row, "updated_at"), firstDesktopString(row, "created_at"), now)
	}
	attempt := desktopIntValue(row["attempt"], 1)
	if attempt < 1 {
		attempt = 1
	}
	maxAttempts := desktopIntValue(row["max_attempts"], attempt)
	if maxAttempts < attempt {
		maxAttempts = attempt
	}
	sourceType := firstDesktopString(row, "source_type")
	sourceID := firstDesktopString(row, "source_id")
	switch sourceType {
	case "desktop_sftp":
		sourceID = id
	case "desktop_batch_task":
		sourceID = desktopBackupUUID("batch-task", sourceID)
	}
	taskType := firstNonEmptyDesktopString(firstDesktopString(row, "task_type"), "task")
	serverID := firstDesktopString(row, "server_id")
	payloadJSON := desktopBackupRawJSONText(row["payload_json"])
	retryable := desktopBoolValue(row["retryable"], false) && taskType == "sftp_recursive_delete"
	if retryable {
		if serverID == "" {
			retryable = false
		} else {
			serverExists, findErr := desktopBackupRowExists(tx, "desktop_servers", serverID)
			if findErr != nil {
				return findErr
			}
			retryable = serverExists
		}
	}
	values := map[string]any{
		"id":                  id,
		"user_id":             "local_owner",
		"definition_id":       firstDesktopString(row, "definition_id"),
		"retry_of_id":         desktopBackupUUID("task-run", firstDesktopString(row, "retry_of_id")),
		"source_type":         sourceType,
		"source_id":           sourceID,
		"task_type":           taskType,
		"title":               firstNonEmptyDesktopString(firstDesktopString(row, "title"), "任务记录"),
		"description":         firstDesktopString(row, "description"),
		"trigger_type":        normalizeDesktopTaskTrigger(firstDesktopString(row, "trigger_type")),
		"runner":              "desktop",
		"status":              status,
		"stage":               firstDesktopString(row, "stage"),
		"server_id":           serverID,
		"server_name":         firstDesktopString(row, "server_name"),
		"resource":            firstDesktopString(row, "resource"),
		"payload_json":        payloadJSON,
		"result_json":         desktopBackupRawJSONText(row["result_json"]),
		"progress":            normalizeDesktopTaskProgress(desktopIntValue(row["progress"], 0)),
		"total_count":         desktopIntValue(row["total_count"], 0),
		"success_count":       desktopIntValue(row["success_count"], 0),
		"failure_count":       desktopIntValue(row["failure_count"], 0),
		"bytes_total":         desktopInt64Value(row["bytes_total"], 0),
		"bytes_processed":     desktopInt64Value(row["bytes_processed"], 0),
		"progress_json":       desktopBackupRawJSONText(row["progress_json"]),
		"cancelable":          0,
		"retryable":           desktopTaskBool(retryable),
		"attempt":             attempt,
		"max_attempts":        maxAttempts,
		"error_code":          errorCode,
		"error_message":       errorMessage,
		"cancel_requested_at": cancelRequestedAt,
		"started_at":          firstDesktopString(row, "started_at"),
		"finished_at":         finishedAt,
		"created_at":          desktopTimeValue(row["created_at"], now),
		"updated_at":          desktopTimeValue(row["updated_at"], now),
	}
	outcome, err := restoreDesktopMappedRowOutcome(tx, "desktop_task_runs", id, values, strategy, result)
	if err != nil || !interrupted || outcome == "skipped" {
		return err
	}
	message := "任务执行上下文无法通过备份恢复"
	eventValues := map[string]any{
		"id":          desktopBackupTaskEventID(id, "error", message, "", now),
		"task_run_id": id,
		"user_id":     "local_owner",
		"level":       "error",
		"message":     message,
		"data_json":   "",
		"created_at":  now,
	}
	return restoreDesktopMappedRow(tx, "desktop_task_events", fmt.Sprint(eventValues["id"]), eventValues, backuputil.RestoreConflictOverwrite, result)
}

func restoreDesktopTaskEventRow(tx *sql.Tx, row map[string]any, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult) error {
	taskRunID := desktopBackupUUID("task-run", firstDesktopString(row, "task_run_id"))
	if taskRunID == "" {
		result.Skipped++
		return nil
	}
	exists, err := desktopBackupRowExists(tx, "desktop_task_runs", taskRunID)
	if err != nil {
		return err
	}
	if !exists {
		result.Skipped++
		return nil
	}
	level := normalizeDesktopTaskEventLevel(firstDesktopString(row, "level"))
	message := firstNonEmptyDesktopString(firstDesktopString(row, "message"), "任务事件")
	dataJSON := desktopBackupRawJSONText(row["data_json"])
	createdAt := desktopTimeValue(row["created_at"], time.Now().UTC().Format(time.RFC3339Nano))
	id := desktopBackupTaskEventID(taskRunID, level, message, dataJSON, createdAt)
	values := map[string]any{
		"id":          id,
		"task_run_id": taskRunID,
		"user_id":     "local_owner",
		"level":       level,
		"message":     message,
		"data_json":   dataJSON,
		"created_at":  createdAt,
	}
	return restoreDesktopMappedRow(tx, "desktop_task_events", fmt.Sprint(id), values, strategy, result)
}

func restoreDesktopInboxNotifications(tx *sql.Tx, table desktopBackupTable, current []DesktopNotification, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult) ([]DesktopNotification, error) {
	items := append([]DesktopNotification(nil), current...)
	indexes := make(map[string]int, len(items))
	for index, item := range items {
		indexes[item.ID] = index
	}
	for _, row := range table.Rows {
		id := desktopBackupUUID("notification", firstDesktopString(row, "id"))
		if id == "" {
			id = uuid.NewString()
		}
		sourceType := firstDesktopString(row, "source_type")
		sourceID := firstDesktopString(row, "source_id")
		actionURL := firstDesktopString(row, "action_url")
		if sourceType == "task_run" {
			sourceID = desktopBackupUUID("task-run", sourceID)
			exists, err := desktopBackupRowExists(tx, "desktop_task_runs", sourceID)
			if err != nil {
				return nil, err
			}
			if !exists {
				result.Skipped++
				continue
			}
			actionURL = "desktop://tasks/" + sourceID
		}
		item := DesktopNotification{
			ID:         id,
			EventType:  firstNonEmptyDesktopString(firstDesktopString(row, "event_type"), "notification.restored"),
			Severity:   normalizeDesktopNotificationSeverity(firstDesktopString(row, "severity")),
			Title:      firstNonEmptyDesktopString(firstDesktopString(row, "title"), "通知"),
			Message:    firstDesktopString(row, "message"),
			SourceType: sourceType,
			SourceID:   sourceID,
			ActionURL:  actionURL,
			ReadAt:     firstDesktopString(row, "read_at"),
			CreatedAt:  desktopTimeValue(row["created_at"], time.Now().UTC().Format(time.RFC3339Nano)),
		}
		if index, exists := indexes[id]; exists {
			switch strategy {
			case backuputil.RestoreConflictSkip:
				result.Skipped++
				continue
			case backuputil.RestoreConflictError:
				return nil, fmt.Errorf("table inbox_notifications item already exists: id=%s", id)
			}
			items[index] = item
			result.Updated++
			continue
		}
		indexes[id] = len(items)
		items = append(items, item)
		result.Inserted++
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].CreatedAt == items[j].CreatedAt {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt < items[j].CreatedAt
	})
	return items, nil
}

func restoreDesktopMappedRow(tx *sql.Tx, table string, id string, values map[string]any, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult) error {
	_, err := restoreDesktopMappedRowOutcome(tx, table, id, values, strategy, result)
	return err
}

func restoreDesktopMappedRowOutcome(tx *sql.Tx, table string, id string, values map[string]any, strategy backuputil.RestoreConflictStrategy, result *DesktopBackupRestoreResult) (string, error) {
	exists, err := desktopBackupRowExists(tx, table, id)
	if err != nil {
		return "", err
	}
	if exists {
		switch strategy {
		case backuputil.RestoreConflictSkip:
			result.Skipped++
			return "skipped", nil
		case backuputil.RestoreConflictError:
			return "", fmt.Errorf("table %s item already exists: id=%s", table, id)
		}
		if err := updateDesktopBackupRow(tx, table, id, values); err != nil {
			return "", err
		}
		result.Updated++
		return "updated", nil
	}
	if err := insertDesktopBackupRow(tx, table, values); err != nil {
		return "", err
	}
	result.Inserted++
	return "inserted", nil
}

func desktopBackupRowExists(tx *sql.Tx, table string, id string) (bool, error) {
	var count int
	if err := tx.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE id = ?", table), id).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func insertDesktopBackupRow(tx *sql.Tx, table string, values map[string]any) error {
	columns := desktopBackupColumns(values)
	placeholders := make([]string, len(columns))
	args := make([]any, len(columns))
	for index, column := range columns {
		placeholders[index] = "?"
		args[index] = values[column]
	}
	_, err := tx.Exec(
		fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", table, strings.Join(columns, ", "), strings.Join(placeholders, ", ")),
		args...,
	)
	return err
}

func updateDesktopBackupRow(tx *sql.Tx, table string, id string, values map[string]any) error {
	columns := desktopBackupColumns(values)
	assignments := make([]string, 0, len(columns))
	args := make([]any, 0, len(columns))
	for _, column := range columns {
		if column == "id" {
			continue
		}
		assignments = append(assignments, column+" = ?")
		args = append(args, values[column])
	}
	if len(assignments) == 0 {
		return nil
	}
	args = append(args, id)
	_, err := tx.Exec(
		fmt.Sprintf("UPDATE %s SET %s WHERE id = ?", table, strings.Join(assignments, ", ")),
		args...,
	)
	return err
}

func desktopBackupColumns(values map[string]any) []string {
	columns := make([]string, 0, len(values))
	for column := range values {
		columns = append(columns, column)
	}
	preferred := []string{
		"id", "user_id", "name", "host", "port", "username", "auth_method", "password", "private_key",
		"server_group", "tags_json", "status", "last_connected", "description", "os", "sort_order",
		"task_name", "task_type", "content", "script_id", "server_ids_json", "execution_mode",
		"success_count", "failed_count", "started_at", "completed_at", "duration", "action",
		"resource", "server_id", "duration_ms", "detail", "language", "executions", "author",
		"created_at", "updated_at",
	}
	ordered := make([]string, 0, len(columns))
	seen := make(map[string]bool, len(columns))
	for _, column := range preferred {
		if _, ok := values[column]; ok {
			ordered = append(ordered, column)
			seen[column] = true
		}
	}
	for _, column := range columns {
		if !seen[column] {
			ordered = append(ordered, column)
		}
	}
	return ordered
}

func nullableDesktopString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func desktopBackupUUID(kind string, value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if parsed, err := uuid.Parse(value); err == nil {
		return parsed.String()
	}
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("easyssh-desktop-backup:"+kind+":"+value)).String()
}

func nullableDesktopBackupUUID(kind string, value string) any {
	mapped := desktopBackupUUID(kind, value)
	if mapped == "" {
		return nil
	}
	return mapped
}

func nullableDesktopTaskRunBackupID(mapping desktopTaskBackupMapping, value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if mapped, exists := mapping.runIDs[value]; exists {
		return mapped
	}
	return desktopBackupUUID("task-run", value)
}

func desktopBackupTaskPayloadJSON(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var decoded any
	if err := json.Unmarshal([]byte(value), &decoded); err != nil {
		return value
	}
	decoded = remapDesktopBackupTaskPayload(decoded, "")
	encoded, err := json.Marshal(decoded)
	if err != nil {
		return value
	}
	return string(encoded)
}

func remapDesktopBackupTaskPayload(value any, key string) any {
	normalizedKey := strings.NewReplacer("_", "", "-", "").Replace(strings.ToLower(strings.TrimSpace(key)))
	switch typed := value.(type) {
	case string:
		switch normalizedKey {
		case "serverid", "sourceserverid", "targetserverid":
			return desktopBackupUUID("server", typed)
		case "taskid":
			return desktopBackupUUID("task-run", typed)
		case "scriptid":
			return desktopBackupUUID("script", typed)
		default:
			return typed
		}
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			itemKey := key
			if normalizedKey == "serverids" {
				itemKey = "serverId"
			}
			result[index] = remapDesktopBackupTaskPayload(item, itemKey)
		}
		return result
	case map[string]any:
		result := make(map[string]any, len(typed))
		for childKey, item := range typed {
			result[childKey] = remapDesktopBackupTaskPayload(item, childKey)
		}
		return result
	default:
		return value
	}
}

func desktopBackupTaskEventID(taskRunID string, level string, message string, dataJSON string, createdAt string) int64 {
	value := strings.Join([]string{taskRunID, level, message, dataJSON, createdAt}, "\x00")
	identifier := uuid.NewSHA1(uuid.NameSpaceOID, []byte("easyssh-desktop-task-event:"+value))
	numeric := binary.BigEndian.Uint64(identifier[:8]) & ((1 << 52) - 1)
	if numeric == 0 {
		numeric = 1
	}
	return int64(numeric)
}

func desktopBackupServerIDsJSON(value string) string {
	value = normalizeDesktopJSONText(value)
	var serverIDs []string
	if err := json.Unmarshal([]byte(value), &serverIDs); err != nil {
		return "[]"
	}

	for index, serverID := range serverIDs {
		serverIDs[index] = desktopBackupUUID("server", serverID)
	}
	data, err := json.Marshal(serverIDs)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func nullableRestoreString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func normalizeDesktopJSONText(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "[]"
	}
	return value
}

func desktopJSONText(value any) string {
	if value == nil {
		return "[]"
	}
	switch typed := value.(type) {
	case string:
		return normalizeDesktopJSONText(typed)
	case []any:
		data, err := json.Marshal(typed)
		if err != nil {
			return "[]"
		}
		return string(data)
	case []string:
		data, err := json.Marshal(typed)
		if err != nil {
			return "[]"
		}
		return string(data)
	default:
		data, err := json.Marshal(typed)
		if err != nil {
			return "[]"
		}
		return string(data)
	}
}

func firstDesktopString(row map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := row[key]; ok && value != nil {
			switch typed := value.(type) {
			case string:
				if strings.TrimSpace(typed) != "" {
					return typed
				}
			case json.Number:
				return typed.String()
			default:
				text := strings.TrimSpace(fmt.Sprint(typed))
				if text != "" && text != "<nil>" {
					return text
				}
			}
		}
	}
	return ""
}

func firstNonEmptyDesktopString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func desktopIntValue(value any, fallback int) int {
	if value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(math.Round(typed))
	case json.Number:
		if parsed, err := typed.Int64(); err == nil {
			return int(parsed)
		}
	case string:
		var parsed int
		if _, err := fmt.Sscanf(strings.TrimSpace(typed), "%d", &parsed); err == nil {
			return parsed
		}
	}
	return fallback
}

func desktopInt64Value(value any, fallback int64) int64 {
	if value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(math.Round(typed))
	case json.Number:
		if parsed, err := typed.Int64(); err == nil {
			return parsed
		}
	case string:
		var parsed int64
		if _, err := fmt.Sscanf(strings.TrimSpace(typed), "%d", &parsed); err == nil {
			return parsed
		}
	}
	return fallback
}

func desktopBoolValue(value any, fallback bool) bool {
	if value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	case json.Number:
		parsed, err := typed.Int64()
		return err == nil && parsed != 0
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return fallback
}

func desktopBackupRawJSONText(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(encoded)
}

func normalizeDesktopRestoredTaskStatus(value string) (string, bool) {
	switch strings.TrimSpace(value) {
	case "succeeded", "failed", "partial_success", "canceled", "timeout":
		return strings.TrimSpace(value), false
	case "queued", "running", "canceling":
		return "failed", true
	default:
		return "failed", true
	}
}

func normalizeDesktopTaskTrigger(value string) string {
	switch strings.TrimSpace(value) {
	case "scheduled", "system", "api":
		return strings.TrimSpace(value)
	default:
		return "manual"
	}
}

func normalizeDesktopTaskProgress(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func normalizeDesktopTaskEventLevel(value string) string {
	switch strings.TrimSpace(value) {
	case "warning", "error":
		return strings.TrimSpace(value)
	default:
		return "info"
	}
}

func normalizeDesktopNotificationSeverity(value string) string {
	switch strings.TrimSpace(value) {
	case "success", "warning", "error":
		return strings.TrimSpace(value)
	default:
		return "info"
	}
}

func desktopTimeValue(value any, fallback string) string {
	text := strings.TrimSpace(firstDesktopString(map[string]any{"value": value}, "value"))
	if text == "" {
		return fallback
	}
	return text
}

func normalizeDesktopBackupAuthMethod(value string) string {
	method := normalizeDesktopServerAuthMethod(DesktopServerAuthMethod(strings.TrimSpace(value)))
	if method.IsValid() {
		return string(method)
	}
	return "password"
}

func normalizeDesktopBackupServerStatus(value string) string {
	if strings.TrimSpace(value) == "online" {
		return "online"
	}
	return "offline"
}

func normalizeDesktopActivityStatus(value string) string {
	switch strings.TrimSpace(value) {
	case "failure":
		return "failure"
	case "warning":
		return "warning"
	default:
		return "success"
	}
}

func desktopRecordType(action string) string {
	if strings.HasPrefix(action, "ssh_") {
		return "connection"
	}
	if strings.HasPrefix(action, "sftp_") {
		return "transfer"
	}
	if strings.HasPrefix(action, "script_") {
		return "execution"
	}
	return "execution"
}

func desktopRecordCounts(status string) (int, int) {
	if status == "success" {
		return 1, 0
	}
	return 0, 1
}

func desktopRecordError(status string, detail string) string {
	if status == "failure" || status == "warning" {
		return detail
	}
	return ""
}

func desktopFinishedAt(createdAt string, durationMs int64) any {
	if strings.TrimSpace(createdAt) == "" {
		return nil
	}
	started, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		started, err = time.Parse(time.RFC3339, createdAt)
	}
	if err != nil {
		return createdAt
	}
	return started.Add(time.Duration(durationMs) * time.Millisecond).UTC().Format(time.RFC3339Nano)
}
