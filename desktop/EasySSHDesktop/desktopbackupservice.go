package main

import (
	"bytes"
	"context"
	"database/sql"
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
	"github.com/easyssh/shared/backuputil"
	"github.com/easyssh/shared/instancebackup"
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
	Inserted      int      `json:"inserted"`
	Updated       int      `json:"updated"`
	Skipped       int      `json:"skipped"`
	IgnoredFields []string `json:"ignored_fields"`
}

type desktopUnifiedBackup = backuputil.UnifiedBackup
type desktopBackupContents = backuputil.ContentSelection
type desktopBackupSection = backuputil.DataSection
type desktopBackupTable = backuputil.Table
type desktopBackupSensitivePayload = backuputil.SensitivePayload

type desktopBackupQuery interface {
	Query(string, ...any) (*sql.Rows, error)
}

type DesktopBackupService struct {
	historyMu sync.Mutex
	history   *instancebackup.History
	mu        sync.Mutex
	db        *sql.DB
}

func NewDesktopBackupService() *DesktopBackupService { return &DesktopBackupService{} }

func (s *DesktopBackupService) ServiceName() string {
	return "DesktopBackupService"
}

func (s *DesktopBackupService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	_, err := s.database()
	return err
}

func (s *DesktopBackupService) ServiceShutdown() error {
	s.historyMu.Lock()
	if s.history != nil {
		s.history.Close()
	}
	s.historyMu.Unlock()
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

	tx, err := database.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return DesktopBackupExportResult{}, err
	}
	defer tx.Rollback()

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

	tables, err := exportDesktopBackupTables(tx)
	if err != nil {
		return DesktopBackupExportResult{}, err
	}
	backup.Database.Tables = tables

	if _, err := backuputil.NormalizeApplicationData(&backup); err != nil {
		return DesktopBackupExportResult{}, err
	}
	if input.IncludeSensitive {
		baseSHA256, err := backuputil.BaseSHA256(&backup)
		if err != nil {
			return DesktopBackupExportResult{}, err
		}
		sensitivePayload, err := exportDesktopSensitivePayload(tx, backup.ExportTime, baseSHA256)
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

	if _, err := backuputil.NormalizeApplicationData(&backup); err != nil {
		return DesktopBackupExportResult{}, err
	}
	content, err := json.MarshalIndent(backup, "", "  ")
	if err != nil {
		return DesktopBackupExportResult{}, err
	}
	if len(content) > backuputil.MaxRestoreFileSizeBytes {
		return DesktopBackupExportResult{}, errors.New("application data exceeds 32 MiB; use native backup")
	}

	prefix := "easyssh_desktop_application_data"
	if input.IncludeSensitive {
		prefix = "easyssh_desktop_application_data_encrypted"
	}

	if err := tx.Commit(); err != nil {
		return DesktopBackupExportResult{}, err
	}
	return DesktopBackupExportResult{
		Filename: fmt.Sprintf("%s_%s.json", prefix, time.Now().Format("20060102_150405")),
		Content:  string(content),
	}, nil
}

func (s *DesktopBackupService) RestoreBackup(input DesktopBackupRestoreInput) (DesktopBackupRestoreResult, error) {
	return s.restoreApplicationData(input, false)
}
func (s *DesktopBackupService) PreviewBackup(input DesktopBackupRestoreInput) (DesktopBackupRestoreResult, error) {
	return s.restoreApplicationData(input, true)
}
func (s *DesktopBackupService) restoreApplicationData(input DesktopBackupRestoreInput, preview bool) (DesktopBackupRestoreResult, error) {
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
		sensitivePayload, err := decryptDesktopSensitivePayload(backup.Sensitive, input.AgePassphrase, input.AgeIdentities)
		if err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		if err := backuputil.VerifySensitiveBaseSHA256(&backup, sensitivePayload); err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		sanitizeDesktopPlainSensitive(&backup)
		if err := mergeDesktopSensitivePayload(&backup, sensitivePayload); err != nil {
			return DesktopBackupRestoreResult{}, err
		}
		allowSensitiveDatabaseRestore = sensitivePayload.Database != nil
	}

	ignored, err := backuputil.NormalizeApplicationData(&backup)
	if err != nil {
		return DesktopBackupRestoreResult{}, err
	}
	supported := make([]desktopBackupTable, 0, len(backup.Database.Tables))
	for _, table := range backup.Database.Tables {
		switch table.Name {
		case "users", "ssh_keys", "servers", "scripts":
			supported = append(supported, table)
		default:
			ignored = append(ignored, table.Name+" (not supported on desktop)")
		}
	}
	backup.Database.Tables = supported

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

	result := DesktopBackupRestoreResult{IgnoredFields: ignored}
	if err := restoreDesktopSSHKeys(tx, &backup, strategy, &result, allowSensitiveDatabaseRestore); err != nil {
		return DesktopBackupRestoreResult{}, err
	}
	for _, table := range orderedDesktopBackupTables(backup.Database.Tables) {
		if err := restoreDesktopBackupTable(tx, table, strategy, &result, allowSensitiveDatabaseRestore); err != nil {
			return DesktopBackupRestoreResult{}, err
		}
	}
	if preview {
		return result, tx.Rollback()
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

	if err := configureDesktopDatabase(database); err != nil {
		database.Close()
		return nil, err
	}

	s.db = database
	return s.db, nil
}

func exportDesktopBackupTables(database desktopBackupQuery) ([]desktopBackupTable, error) {
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
	keys, err := exportDesktopSSHKeys(database, false)
	if err != nil {
		return nil, err
	}
	tables = append(tables, keys, servers)

	scripts, err := exportDesktopScripts(database)
	if err != nil {
		return nil, err
	}
	tables = append(tables, scripts)

	return tables, nil
}

func exportDesktopServers(database desktopBackupQuery) (desktopBackupTable, error) {
	table := desktopBackupTable{
		Name:       "servers",
		PrimaryKey: []string{"id"},
		Columns: []string{
			"id", "user_id", "name", "host", "port", "username", "auth_method", "ssh_key_id", "server_group",
			"tags", "status", "last_connected", "description", "os", "sort_order", "created_at", "updated_at",
		},
		Rows: []map[string]any{},
	}

	rows, err := database.Query(`
		SELECT id, name, host, port, username, auth_method, ssh_key_id, server_group, tags_json,
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
		var keyID sql.NullInt64
		if err := rows.Scan(&id, &name, &host, &port, &username, &authMethod, &keyID, &group, &tagsJSON, &status, &lastConnected, &description, &osValue, &sortOrder, &createdAt, &updatedAt); err != nil {
			return table, err
		}
		backupID := desktopBackupUUID("server", id)
		var keyRef any
		if keyID.Valid {
			keyRef = keyID.Int64
		}
		table.Rows = append(table.Rows, map[string]any{
			"id":             backupID,
			"user_id":        desktopBackupUserID,
			"name":           name,
			"host":           host,
			"port":           port,
			"username":       username,
			"auth_method":    authMethod,
			"ssh_key_id":     keyRef,
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

func exportDesktopScripts(database desktopBackupQuery) (desktopBackupTable, error) {
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

func exportDesktopSensitivePayload(database desktopBackupQuery, exportTime string, baseSHA256 string) (*desktopBackupSensitivePayload, error) {
	servers, err := exportDesktopSensitiveServers(database)
	if err != nil {
		return nil, err
	}

	keys, err := exportDesktopSSHKeys(database, true)
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
			Tables: []desktopBackupTable{servers, keys},
		},
		Warnings: []string{
			"desktop server passwords and private keys are encrypted with the backup password.",
		},
	}, nil
}

func exportDesktopSensitiveServers(database desktopBackupQuery) (desktopBackupTable, error) {
	table := desktopBackupTable{
		Name:       "servers",
		PrimaryKey: []string{"id"},
		Columns:    []string{"id", "user_id", "password"},
		Rows:       []map[string]any{},
	}

	rows, err := database.Query(`
		SELECT id, password
		FROM desktop_servers
		ORDER BY sort_order ASC, created_at ASC, id ASC`)
	if err != nil {
		return table, err
	}
	defer rows.Close()

	for rows.Next() {
		var id, password string
		if err := rows.Scan(&id, &password); err != nil {
			return table, err
		}
		password, err = decryptDesktopCredential(password, "desktop_servers", id, "password")
		if err != nil {
			return table, err
		}
		table.Rows = append(table.Rows, map[string]any{
			"id":       desktopBackupUUID("server", id),
			"user_id":  desktopBackupUserID,
			"password": password,
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
		if !strings.EqualFold(table.Name, "servers") && !strings.EqualFold(table.Name, "ssh_keys") {
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
		if !strings.EqualFold(sensitiveTable.Name, "servers") && !strings.EqualFold(sensitiveTable.Name, "ssh_keys") {
			continue
		}
		targetTable := targetTables[strings.ToLower(sensitiveTable.Name)]
		if targetTable == nil {
			return errors.New("sensitive credential payload has no matching base table")
		}
		if err := mergeDesktopSensitiveCredentialTable(targetTable, sensitiveTable); err != nil {
			return err
		}
	}
	backup.Contents.Sensitive = true
	return nil
}

func mergeDesktopSensitiveCredentialTable(target *desktopBackupTable, sensitive desktopBackupTable) error {
	secret := "password"
	allowed := []string{"id", "user_id", "password"}
	if strings.EqualFold(target.Name, "ssh_keys") {
		secret = "private_key"
		allowed = []string{"id", "user_id", "fingerprint", "private_key"}
	}
	for _, column := range sensitive.Columns {
		if !desktopBackupColumnAllowed(column, allowed...) {
			return fmt.Errorf("sensitive credential table contains unsupported column %s", column)
		}
	}

	target.Columns = appendDesktopBackupColumn(target.Columns, secret)

	for _, sensitiveRow := range sensitive.Rows {
		targetRow := findDesktopBackupRowByID(target.Rows, firstDesktopString(sensitiveRow, "id"))
		if targetRow == nil {
			return fmt.Errorf("sensitive credential row is missing in base backup: id=%s", firstDesktopString(sensitiveRow, "id"))
		}
		if value, ok := sensitiveRow[secret]; ok {
			targetRow[secret] = value
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
	case "ssh_keys":
		return nil // Restored first, with key IDs remapped by fingerprint.
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

	}
	return nil
}

func orderedDesktopBackupTables(tables []desktopBackupTable) []desktopBackupTable {
	priorities := []string{"users", "ssh_keys", "servers", "scripts"}
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
		"ssh_key_id":     row["ssh_key_id"],
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
		if raw, ok := row["password"]; ok {
			password, valid := raw.(string)
			if !valid {
				return errors.New("backup password must be a string")
			}
			encrypted, err := encryptDesktopCredential(password, "desktop_servers", id, "password")
			if err != nil {
				return err
			}
			values["password"] = encrypted
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
	case uint:
		return int(typed)
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
