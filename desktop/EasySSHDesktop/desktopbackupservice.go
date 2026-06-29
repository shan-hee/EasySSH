package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/backupcrypto"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	desktopBackupFormat                  = "easyssh-unified-backup"
	desktopBackupVersion                 = "2.0"
	desktopBackupSensitivePayloadVersion = "2"
	desktopBackupRestoreMaxBytes         = 32 << 20
	desktopBackupUserID                  = "00000000-0000-4000-8000-000000000001"
	desktopBackupUsername                = "desktop"
	desktopBackupEmail                   = "desktop-local-owner@easyssh.local"
)

type DesktopBackupExportInput struct {
	IncludeConfig    bool   `json:"include_config"`
	IncludeDatabase  bool   `json:"include_database"`
	IncludeSensitive bool   `json:"include_sensitive"`
	BackupPassword   string `json:"backup_password"`
}

type DesktopBackupRestoreInput struct {
	Content          string `json:"content"`
	IncludeConfig    bool   `json:"include_config"`
	IncludeDatabase  bool   `json:"include_database"`
	ConflictStrategy string `json:"conflict_strategy"`
	BackupPassword   string `json:"backup_password"`
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

type desktopUnifiedBackup struct {
	Format     string                               `json:"format"`
	Version    string                               `json:"version"`
	ExportTime string                               `json:"export_time"`
	Contents   desktopBackupContents                `json:"contents"`
	Config     *desktopBackupSection                `json:"config,omitempty"`
	Database   *desktopBackupSection                `json:"database,omitempty"`
	Sensitive  *backupcrypto.BackupEncryptedPayload `json:"sensitive,omitempty"`
	Warnings   []string                             `json:"warnings,omitempty"`
}

type desktopBackupContents struct {
	Config    bool `json:"config"`
	Database  bool `json:"database"`
	Sensitive bool `json:"sensitive,omitempty"`
}

type desktopBackupSection struct {
	Driver string               `json:"driver"`
	Tables []desktopBackupTable `json:"tables"`
}

type desktopBackupTable struct {
	Name       string           `json:"name"`
	PrimaryKey []string         `json:"primary_key"`
	Columns    []string         `json:"columns"`
	Rows       []map[string]any `json:"rows"`
}

type desktopBackupSensitivePayload struct {
	Version    string                `json:"version"`
	ExportTime string                `json:"export_time"`
	Contents   desktopBackupContents `json:"contents"`
	BaseSHA256 string                `json:"base_sha256"`
	Config     *desktopBackupSection `json:"config,omitempty"`
	Database   *desktopBackupSection `json:"database,omitempty"`
	Warnings   []string              `json:"warnings,omitempty"`
}

type DesktopBackupService struct {
	mu sync.Mutex
	db *sql.DB
}

func NewDesktopBackupService() *DesktopBackupService {
	return &DesktopBackupService{}
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
	if input.IncludeSensitive && strings.TrimSpace(input.BackupPassword) == "" {
		return DesktopBackupExportResult{}, errors.New("backup password is required for sensitive backup")
	}

	database, err := s.database()
	if err != nil {
		return DesktopBackupExportResult{}, err
	}

	backup := desktopUnifiedBackup{
		Format:     desktopBackupFormat,
		Version:    desktopBackupVersion,
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

	tables, err := exportDesktopBackupTables(database)
	if err != nil {
		return DesktopBackupExportResult{}, err
	}
	backup.Database.Tables = tables

	if input.IncludeSensitive {
		baseSHA256, err := desktopBackupBaseSHA256(&backup)
		if err != nil {
			return DesktopBackupExportResult{}, err
		}
		sensitivePayload, err := exportDesktopSensitivePayload(database, backup.ExportTime, baseSHA256)
		if err != nil {
			return DesktopBackupExportResult{}, err
		}
		envelope, err := backupcrypto.EncryptBackupJSON(sensitivePayload, input.BackupPassword, desktopBackupSensitiveAAD())
		if err != nil {
			return DesktopBackupExportResult{}, err
		}
		backup.Sensitive = envelope
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
	if len(input.Content) > desktopBackupRestoreMaxBytes {
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
	if strings.TrimSpace(backup.Format) != desktopBackupFormat {
		return DesktopBackupRestoreResult{}, errors.New("unsupported backup format")
	}
	if strings.TrimSpace(backup.Version) != desktopBackupVersion {
		return DesktopBackupRestoreResult{}, errors.New("unsupported backup version")
	}
	if backup.Contents.Config != (backup.Config != nil) || backup.Contents.Database != (backup.Database != nil) {
		return DesktopBackupRestoreResult{}, errors.New("backup content metadata is inconsistent")
	}
	if backup.Contents.Sensitive != (backup.Sensitive != nil) {
		return DesktopBackupRestoreResult{}, errors.New("backup sensitive metadata is inconsistent")
	}
	if backup.Database == nil {
		return DesktopBackupRestoreResult{}, errors.New("backup file does not include database")
	}

	allowSensitiveDatabaseRestore := false
	if backup.Sensitive != nil {
		if strings.TrimSpace(input.BackupPassword) == "" {
			return DesktopBackupRestoreResult{}, errors.New("backup password is required for sensitive backup restore")
		}
		sanitizeDesktopPlainSensitive(&backup)
		sensitivePayload, err := decryptDesktopSensitivePayload(backup.Sensitive, input.BackupPassword)
		if err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		if err := verifyDesktopSensitiveBaseSHA256(&backup, sensitivePayload); err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		if err := mergeDesktopSensitivePayload(&backup, sensitivePayload); err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		allowSensitiveDatabaseRestore = sensitivePayload.Database != nil
	}

	strategy := normalizeDesktopRestoreStrategy(input.ConflictStrategy)
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
	for _, table := range backup.Database.Tables {
		if err := restoreDesktopBackupTable(tx, table, strategy, &result, allowSensitiveDatabaseRestore); err != nil {
			return DesktopBackupRestoreResult{}, err
		}
	}

	if err := tx.Commit(); err != nil {
		return DesktopBackupRestoreResult{}, err
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

	s.db = database
	return s.db, nil
}

func exportDesktopBackupTables(database *sql.DB) ([]desktopBackupTable, error) {
	tables := make([]desktopBackupTable, 0, 5)
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
			"role":                "admin",
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

func exportDesktopSensitivePayload(database *sql.DB, exportTime string, baseSHA256 string) (*desktopBackupSensitivePayload, error) {
	servers, err := exportDesktopSensitiveServers(database)
	if err != nil {
		return nil, err
	}

	return &desktopBackupSensitivePayload{
		Version:    desktopBackupSensitivePayloadVersion,
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

func desktopBackupSensitiveAAD() []byte {
	return []byte("easyssh:backup:sensitive:v2")
}

func desktopBackupBaseSHA256(backup *desktopUnifiedBackup) (string, error) {
	base := struct {
		Format     string                `json:"format"`
		Version    string                `json:"version"`
		ExportTime string                `json:"export_time"`
		Contents   desktopBackupContents `json:"contents"`
		Config     *desktopBackupSection `json:"config,omitempty"`
		Database   *desktopBackupSection `json:"database,omitempty"`
	}{
		Format:     backup.Format,
		Version:    backup.Version,
		ExportTime: backup.ExportTime,
		Contents:   backup.Contents,
		Config:     backup.Config,
		Database:   backup.Database,
	}

	data, err := json.Marshal(base)
	if err != nil {
		return "", fmt.Errorf("failed to serialize backup base digest: %w", err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

func decryptDesktopSensitivePayload(envelope *backupcrypto.BackupEncryptedPayload, password string) (*desktopBackupSensitivePayload, error) {
	var payload desktopBackupSensitivePayload
	if err := backupcrypto.DecryptBackupJSON(envelope, password, desktopBackupSensitiveAAD(), &payload); err != nil {
		return nil, err
	}
	if strings.TrimSpace(payload.Version) != desktopBackupSensitivePayloadVersion {
		return nil, fmt.Errorf("unsupported sensitive backup payload version: %s", payload.Version)
	}
	return &payload, nil
}

func verifyDesktopSensitiveBaseSHA256(backup *desktopUnifiedBackup, payload *desktopBackupSensitivePayload) error {
	expected := strings.TrimSpace(payload.BaseSHA256)
	if expected == "" {
		return errors.New("sensitive backup base digest is missing")
	}
	actual, err := desktopBackupBaseSHA256(backup)
	if err != nil {
		return err
	}
	if subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) != 1 {
		return errors.New("backup base content does not match encrypted sensitive payload")
	}
	return nil
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

func restoreDesktopBackupTable(tx *sql.Tx, table desktopBackupTable, strategy string, result *DesktopBackupRestoreResult, allowSensitive bool) error {
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
	}
	return nil
}

func restoreDesktopServerRow(tx *sql.Tx, row map[string]any, strategy string, result *DesktopBackupRestoreResult, allowSensitive bool) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := firstDesktopString(row, "id")
	if id == "" {
		id = newDesktopServerID()
	}
	values := map[string]any{
		"id":             id,
		"user_id":        "local",
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

func restoreDesktopScriptRow(tx *sql.Tx, row map[string]any, strategy string, result *DesktopBackupRestoreResult) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := firstDesktopString(row, "id")
	if id == "" {
		id = newDesktopScriptID()
	}
	values := map[string]any{
		"id":          id,
		"user_id":     "local",
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

func restoreDesktopBatchTaskRow(tx *sql.Tx, row map[string]any, strategy string, result *DesktopBackupRestoreResult) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	id := firstDesktopString(row, "id")
	if id == "" {
		id = newDesktopBatchTaskID()
	}
	values := map[string]any{
		"id":              id,
		"user_id":         "local",
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

func restoreDesktopActivityRow(tx *sql.Tx, row map[string]any, strategy string, result *DesktopBackupRestoreResult) error {
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

func restoreDesktopMappedRow(tx *sql.Tx, table string, id string, values map[string]any, strategy string, result *DesktopBackupRestoreResult) error {
	exists, err := desktopBackupRowExists(tx, table, id)
	if err != nil {
		return err
	}
	if exists {
		switch strategy {
		case "skip":
			result.Skipped++
			return nil
		case "error":
			return fmt.Errorf("table %s item already exists: id=%s", table, id)
		}
		if err := updateDesktopBackupRow(tx, table, id, values); err != nil {
			return err
		}
		result.Updated++
		return nil
	}
	if err := insertDesktopBackupRow(tx, table, values); err != nil {
		return err
	}
	result.Inserted++
	return nil
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

func normalizeDesktopRestoreStrategy(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "skip", "overwrite", "error":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "error"
	}
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

func desktopTimeValue(value any, fallback string) string {
	text := strings.TrimSpace(firstDesktopString(map[string]any{"value": value}, "value"))
	if text == "" {
		return fallback
	}
	return text
}

func normalizeDesktopBackupAuthMethod(value string) string {
	if strings.TrimSpace(value) == "key" {
		return "key"
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
	return "audit"
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
