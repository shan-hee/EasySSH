package rest

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	api "github.com/easyssh/server/internal/api/openapi"
	"github.com/easyssh/server/internal/pkg/crypto"
	"github.com/easyssh/shared/backupcrypto"
	"github.com/easyssh/shared/backuputil"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type exportBackupOptions struct {
	IncludeConfig    bool
	IncludeDatabase  bool
	IncludeSensitive bool
	AgePassphrase    string
	AgeRecipients    []string
}

type BackupSensitivePayload = backuputil.SensitivePayload

type sensitiveTableSpec struct {
	Table            string
	Section          backupSection
	Columns          []string
	SensitiveColumns []string
}

var sensitiveBackupTables = []sensitiveTableSpec{
	{
		Table:            "system_config",
		Section:          backupSectionConfig,
		Columns:          []string{"id", "google_client_secret"},
		SensitiveColumns: []string{"google_client_secret"},
	},
	{
		Table:            "notification_config",
		Section:          backupSectionConfig,
		Columns:          []string{"id", "smtp_config", "webhook_config", "ding_talk_config"},
		SensitiveColumns: []string{"smtp_config", "webhook_config", "ding_talk_config"},
	},
	{
		Table:            "ai_config",
		Section:          backupSectionConfig,
		Columns:          []string{"id", "system_api_key"},
		SensitiveColumns: []string{"system_api_key"},
	},
	{
		Table:            "users",
		Section:          backupSectionDatabase,
		Columns:          []string{"id", "password", "two_factor_enabled", "two_factor_secret", "backup_codes", "nezha_api_token", "komari_api_token"},
		SensitiveColumns: []string{"password", "two_factor_enabled", "two_factor_secret", "backup_codes", "nezha_api_token", "komari_api_token"},
	},
	{
		Table:            "servers",
		Section:          backupSectionDatabase,
		Columns:          []string{"id", "user_id", "password", "private_key"},
		SensitiveColumns: []string{"password", "private_key"},
	},
	{
		Table:            "ssh_keys",
		Section:          backupSectionDatabase,
		Columns:          []string{"id", "user_id", "fingerprint", "private_key"},
		SensitiveColumns: []string{"private_key"},
	},
	{
		Table:            "user_ai_config",
		Section:          backupSectionDatabase,
		Columns:          []string{"id", "user_id", "custom_api_key"},
		SensitiveColumns: []string{"custom_api_key"},
	},
}

func parseExportBackupPostOptions(c *gin.Context) (exportBackupOptions, error) {
	options := exportBackupOptions{
		IncludeConfig:   true,
		IncludeDatabase: true,
	}

	var req api.BackupExportRequest
	contentType := strings.ToLower(c.GetHeader("Content-Type"))
	if strings.Contains(contentType, "application/json") {
		if err := c.ShouldBindJSON(&req); err != nil {
			return options, fmt.Errorf("invalid export request: %w", err)
		}
		applyExportRequestOptions(&options, req)
		return options, nil
	}

	options.IncludeConfig = parseBoolForm(c, "include_config", true)
	options.IncludeDatabase = parseBoolForm(c, "include_database", true)
	options.IncludeSensitive = parseBoolForm(c, "include_sensitive", false)
	options.AgePassphrase = c.PostForm("age_passphrase")
	options.AgeRecipients = c.PostFormArray("age_recipients")
	return options, nil
}

func applyExportRequestOptions(options *exportBackupOptions, req api.BackupExportRequest) {
	if req.IncludeConfig != nil {
		options.IncludeConfig = *req.IncludeConfig
	}
	if req.IncludeDatabase != nil {
		options.IncludeDatabase = *req.IncludeDatabase
	}
	if req.IncludeSensitive != nil {
		options.IncludeSensitive = *req.IncludeSensitive
	}
	if req.AgePassphrase != nil {
		options.AgePassphrase = *req.AgePassphrase
	}
	if req.AgeRecipients != nil {
		options.AgeRecipients = *req.AgeRecipients
	}
}

func (h *BackupHandler) exportSensitivePayload(includeConfig bool, includeDatabase bool, exportTime string, baseSHA256 string) (*BackupSensitivePayload, error) {
	payload := &BackupSensitivePayload{
		Version:    backuputil.SensitivePayloadVersion,
		ExportTime: exportTime,
		BaseSHA256: baseSHA256,
		Contents: BackupContentSelection{
			Config:    includeConfig,
			Database:  includeDatabase,
			Sensitive: true,
		},
		Warnings: []string{
			"users.password is restored as bcrypt hash; plaintext passwords are not recoverable.",
			"users.backup_codes are restored as stored HMAC hashes and remain usable only with the same ENCRYPTION_KEY.",
		},
	}

	if includeConfig {
		section, err := h.exportSensitiveSection(backupSectionConfig)
		if err != nil {
			return nil, err
		}
		payload.Config = section
	}

	if includeDatabase {
		section, err := h.exportSensitiveSection(backupSectionDatabase)
		if err != nil {
			return nil, err
		}
		payload.Database = section
	}

	return payload, nil
}

func (h *BackupHandler) exportSensitiveSection(sectionType backupSection) (*BackupDataSection, error) {
	section := &BackupDataSection{
		Driver: h.db.Dialector.Name(),
		Tables: make([]BackupTable, 0),
	}

	for _, spec := range sensitiveBackupTables {
		if spec.Section != sectionType {
			continue
		}

		columns, err := h.existingSensitiveColumns(spec)
		if err != nil {
			return nil, err
		}
		if len(columns) == 0 {
			continue
		}

		policy, _ := backupPolicyForTable(spec.Table)
		rows, err := h.getStructuredTableRows(spec.Table, columns, policy, false)
		if err != nil {
			return nil, fmt.Errorf("failed to export sensitive rows for table %s: %w", spec.Table, err)
		}
		if len(rows) == 0 {
			continue
		}
		if err := h.decryptSensitiveRows(spec, rows); err != nil {
			return nil, err
		}

		primaryKey, err := h.getTablePrimaryKeys(h.db, spec.Table, columns)
		if err != nil {
			return nil, fmt.Errorf("failed to get primary key for table %s: %w", spec.Table, err)
		}
		section.Tables = append(section.Tables, BackupTable{
			Name:       spec.Table,
			PrimaryKey: primaryKey,
			Columns:    columns,
			Rows:       rows,
		})
	}

	return section, nil
}

func (h *BackupHandler) existingSensitiveColumns(spec sensitiveTableSpec) ([]string, error) {
	tableColumns, err := h.getTableColumns(spec.Table)
	if err != nil {
		return nil, fmt.Errorf("failed to inspect table %s: %w", spec.Table, err)
	}
	columns := make([]string, 0, len(spec.Columns))
	for _, column := range spec.Columns {
		if containsStringFold(tableColumns, column) {
			columns = append(columns, column)
		}
	}
	return columns, nil
}

func (h *BackupHandler) decryptSensitiveRows(spec sensitiveTableSpec, rows []map[string]interface{}) error {
	for index, row := range rows {
		var err error
		switch spec.Table {
		case "system_config":
			err = h.decryptRowSecret(row, "google_client_secret", crypto.SecretAAD("system_config", "system", "google_client_secret"))
		case "notification_config":
			err = h.decryptNotificationConfigRow(row)
		case "ai_config":
			err = h.decryptRowSecret(row, "system_api_key", crypto.SecretAAD("ai_config", "system", "system_api_key"))
		case "users":
			err = h.decryptUserSensitiveRow(row)
		case "servers":
			err = h.decryptServerSensitiveRow(row)
		case "ssh_keys":
			err = h.decryptSSHKeySensitiveRow(row)
		case "user_ai_config":
			err = h.decryptRowSecret(row, "custom_api_key", crypto.SecretAAD("user_ai_config", row["user_id"], "custom_api_key"))
		}
		if err != nil {
			return fmt.Errorf("failed to decrypt sensitive table %s row %d: %w", spec.Table, index+1, err)
		}
	}
	return nil
}

func (h *BackupHandler) decryptSensitivePayload(ciphertext string, passphrase string, identities []string) (*BackupSensitivePayload, error) {
	var payload BackupSensitivePayload
	if err := backupcrypto.DecryptJSON(ciphertext, passphrase, identities, &payload); err != nil {
		return nil, err
	}
	if strings.TrimSpace(payload.Version) != backuputil.SensitivePayloadVersion {
		return nil, fmt.Errorf("unsupported sensitive backup payload version: %s", payload.Version)
	}
	return &payload, nil
}

func mergeSensitivePayload(backup *UnifiedBackup, payload *BackupSensitivePayload, includeConfig bool, includeDatabase bool) error {
	if payload == nil {
		return nil
	}
	if payload.Contents.Config != backup.Contents.Config || payload.Contents.Database != backup.Contents.Database || !payload.Contents.Sensitive {
		return errors.New("sensitive backup contents do not match base backup")
	}
	if includeConfig && payload.Config != nil {
		if backup.Config == nil {
			return errors.New("sensitive config payload has no matching config section")
		}
		if err := mergeSensitiveSection(backup.Config, payload.Config); err != nil {
			return err
		}
	}
	if includeDatabase && payload.Database != nil {
		if backup.Database == nil {
			return errors.New("sensitive database payload has no matching database section")
		}
		if err := mergeSensitiveSection(backup.Database, payload.Database); err != nil {
			return err
		}
	}
	backup.Contents.Sensitive = true
	return nil
}

func (h *BackupHandler) validatePlainBackupSections(backup *UnifiedBackup, includeConfig bool, includeDatabase bool) error {
	if includeConfig && backup.Config != nil {
		for _, table := range backup.Config.Tables {
			policy, ok := backupPolicyForTable(table.Name)
			if !ok {
				return fmt.Errorf("backup table %s has no policy", table.Name)
			}
			if policy.Section != backupSectionConfig || policy.RestoreMode != backupRestoreSingleton || !policy.Restorable {
				continue
			}
			if err := h.validateRestoreTable(h.db, &table, policy, false); err != nil {
				return err
			}
		}
	}

	if includeDatabase && backup.Database != nil {
		for _, table := range backup.Database.Tables {
			policy, ok := backupPolicyForTable(table.Name)
			if !ok {
				return fmt.Errorf("backup table %s has no policy", table.Name)
			}
			if policy.Section != backupSectionDatabase || policy.RestoreMode != backupRestoreEntity || !policy.Restorable {
				continue
			}
			if err := h.validateRestoreTable(h.db, &table, policy, false); err != nil {
				return err
			}
		}
	}

	return nil
}

func sanitizePlainBackupSections(backup *UnifiedBackup, includeConfig bool, includeDatabase bool) {
	if includeConfig && backup.Config != nil {
		sanitizePlainBackupSection(backup.Config)
	}
	if includeDatabase && backup.Database != nil {
		sanitizePlainBackupSection(backup.Database)
	}
}

func sanitizePlainBackupSection(section *BackupDataSection) {
	for tableIndex := range section.Tables {
		table := &section.Tables[tableIndex]
		for rowIndex := range table.Rows {
			table.Rows[rowIndex] = sanitizeStructuredExportRow(table.Name, table.Rows[rowIndex])
		}
	}
}

func mergeSensitiveSection(target *BackupDataSection, sensitive *BackupDataSection) error {
	targetTables := make(map[string]*BackupTable, len(target.Tables))
	for i := range target.Tables {
		targetTables[normalizeBackupTableName(target.Tables[i].Name)] = &target.Tables[i]
	}

	for _, sensitiveTable := range sensitive.Tables {
		targetTable := targetTables[normalizeBackupTableName(sensitiveTable.Name)]
		if targetTable == nil {
			return fmt.Errorf("sensitive table %s has no matching base table", sensitiveTable.Name)
		}
		spec, ok := sensitiveSpecForTable(sensitiveTable.Name)
		if !ok {
			return fmt.Errorf("sensitive table %s is not supported", sensitiveTable.Name)
		}
		if err := mergeSensitiveTable(targetTable, sensitiveTable, spec); err != nil {
			return err
		}
	}
	return nil
}

func mergeSensitiveTable(target *BackupTable, sensitive BackupTable, spec sensitiveTableSpec) error {
	keyColumns := sensitive.PrimaryKey
	if len(keyColumns) == 0 {
		keyColumns = target.PrimaryKey
	}
	if len(keyColumns) == 0 {
		keyColumns = fallbackPrimaryKey(sensitive.Columns)
	}
	if len(keyColumns) == 0 {
		return fmt.Errorf("sensitive table %s has no key for merge", sensitive.Name)
	}

	for _, column := range sensitive.Columns {
		if !containsStringFold(spec.Columns, column) {
			return fmt.Errorf("sensitive table %s contains unsupported column %s", sensitive.Name, column)
		}
	}
	for _, column := range spec.SensitiveColumns {
		if containsStringFold(sensitive.Columns, column) && !containsStringFold(target.Columns, column) {
			target.Columns = append(target.Columns, column)
		}
	}

	for _, sensitiveRow := range sensitive.Rows {
		targetRow := findBackupRowByColumns(target.Rows, keyColumns, sensitiveRow)
		if targetRow == nil {
			return fmt.Errorf("sensitive table %s row is missing in base backup: %s", sensitive.Name, formatConflictColumns(keyColumns, sensitiveRow))
		}
		for _, column := range spec.SensitiveColumns {
			if value, ok := sensitiveRow[column]; ok {
				targetRow[column] = value
			}
		}
	}

	return nil
}

func sensitiveSpecForTable(table string) (sensitiveTableSpec, bool) {
	for _, spec := range sensitiveBackupTables {
		if strings.EqualFold(spec.Table, table) {
			return spec, true
		}
	}
	return sensitiveTableSpec{}, false
}

func findBackupRowByColumns(rows []map[string]interface{}, columns []string, wanted map[string]interface{}) map[string]interface{} {
	for _, row := range rows {
		matched := true
		for _, column := range columns {
			if !backupValuesEqual(row[column], wanted[column]) {
				matched = false
				break
			}
		}
		if matched {
			return row
		}
	}
	return nil
}

func backupValuesEqual(left interface{}, right interface{}) bool {
	return fmt.Sprint(left) == fmt.Sprint(right)
}

func (h *BackupHandler) decryptRowSecret(row map[string]interface{}, column string, aad []byte) error {
	value := backupStringValue(row[column])
	if strings.TrimSpace(value) == "" || h.encryptor == nil {
		return nil
	}
	plaintext, err := h.encryptor.DecryptSecret(value, aad)
	if err != nil {
		return err
	}
	row[column] = plaintext
	return nil
}

func (h *BackupHandler) decryptUserSensitiveRow(row map[string]interface{}) error {
	userID := row["id"]
	if err := h.decryptUserTwoFactorSecret(row, userID); err != nil {
		return err
	}
	if err := h.decryptRowSecret(row, "nezha_api_token", crypto.SecretAAD("users", userID, "nezha_api_token")); err != nil {
		return err
	}
	return h.decryptRowSecret(row, "komari_api_token", crypto.SecretAAD("users", userID, "komari_api_token"))
}

func (h *BackupHandler) decryptUserTwoFactorSecret(row map[string]interface{}, userID interface{}) error {
	value := backupStringValue(row["two_factor_secret"])
	if strings.TrimSpace(value) == "" {
		return nil
	}
	plaintext, err := h.encryptor.DecryptSecret(value, crypto.SecretAAD("users", userID, "two_factor_secret"))
	if err != nil {
		return err
	}
	row["two_factor_secret"] = plaintext
	return nil
}

func (h *BackupHandler) decryptServerSensitiveRow(row map[string]interface{}) error {
	serverID := row["id"]
	userID := row["user_id"]
	if err := h.decryptRowSecret(row, "password", serverCredentialAAD(userID, serverID, "password")); err != nil {
		return err
	}
	return h.decryptRowSecret(row, "private_key", serverCredentialAAD(userID, serverID, "private_key"))
}

func (h *BackupHandler) decryptSSHKeySensitiveRow(row map[string]interface{}) error {
	return h.decryptRowSecret(row, "private_key", sshKeyPrivateKeyAAD(row["user_id"], row["fingerprint"]))
}

func (h *BackupHandler) decryptNotificationConfigRow(row map[string]interface{}) error {
	if err := h.transformJSONSecret(row, "smtp_config", "password", notificationConfigAAD("smtp", "password"), false); err != nil {
		return err
	}
	if err := h.transformJSONSecret(row, "webhook_config", "secret", notificationConfigAAD("webhook", "secret"), false); err != nil {
		return err
	}
	if err := h.transformJSONSecret(row, "ding_talk_config", "secret", notificationConfigAAD("dingtalk", "secret"), false); err != nil {
		return err
	}
	return nil
}

func sanitizeStructuredExportRow(table string, row map[string]interface{}) map[string]interface{} {
	if !strings.EqualFold(table, "notification_config") {
		return row
	}
	clearJSONSecret(row, "smtp_config", "password")
	clearJSONSecret(row, "webhook_config", "secret")
	clearJSONSecret(row, "ding_talk_config", "secret")
	return row
}

func (h *BackupHandler) preserveNotificationSecrets(tx *gorm.DB, table string, row map[string]interface{}) error {
	if !strings.EqualFold(table, "notification_config") {
		return nil
	}

	existing, err := h.getExistingNotificationConfigRow(tx, row)
	if err != nil {
		return err
	}
	if existing == nil {
		return nil
	}

	copyJSONSecretIfBlank(row, existing, "smtp_config", "password")
	copyJSONSecretIfBlank(row, existing, "webhook_config", "secret")
	copyJSONSecretIfBlank(row, existing, "ding_talk_config", "secret")
	return nil
}

func (h *BackupHandler) getExistingNotificationConfigRow(tx *gorm.DB, row map[string]interface{}) (map[string]interface{}, error) {
	columns, err := h.getTableColumnsForDB(tx, "notification_config")
	if err != nil {
		return nil, err
	}
	selectColumns := filterExistingColumns(columns, []string{"id", "smtp_config", "webhook_config", "ding_talk_config"})
	if len(selectColumns) == 0 {
		return nil, nil
	}

	query := tx.Table("notification_config").Select(strings.Join(quoteColumns(tx.Dialector.Name(), selectColumns), ", ")).Limit(1)
	if id, ok := row["id"]; ok && id != nil {
		query = query.Where(fmt.Sprintf("%s = ?", quoteIdentifier(tx.Dialector.Name(), "id")), id)
	}

	rows, err := query.Rows()
	if err != nil {
		return nil, fmt.Errorf("failed to read existing notification config: %w", err)
	}
	defer rows.Close()

	if !rows.Next() {
		return nil, nil
	}
	values := make([]interface{}, len(selectColumns))
	scanTargets := make([]interface{}, len(selectColumns))
	for i := range values {
		scanTargets[i] = &values[i]
	}
	if err := rows.Scan(scanTargets...); err != nil {
		return nil, fmt.Errorf("failed to scan existing notification config: %w", err)
	}
	result := make(map[string]interface{}, len(selectColumns))
	for i, column := range selectColumns {
		result[column] = normalizeBackupValue(values[i])
	}
	return result, nil
}

func (h *BackupHandler) prepareSensitiveRestoreRow(table string, row map[string]interface{}) error {
	if h.encryptor == nil {
		return nil
	}
	switch normalizeBackupTableName(table) {
	case "system_config":
		return h.encryptRestoreSecret(row, "google_client_secret", crypto.SecretAAD("system_config", "system", "google_client_secret"))
	case "notification_config":
		return h.encryptNotificationConfigRow(row)
	case "ai_config":
		return h.encryptRestoreSecret(row, "system_api_key", crypto.SecretAAD("ai_config", "system", "system_api_key"))
	case "users":
		return h.encryptUserRestoreSecrets(row)
	case "servers":
		return h.encryptServerRestoreSecrets(row)
	case "ssh_keys":
		return h.encryptRestoreSecret(row, "private_key", sshKeyPrivateKeyAAD(row["user_id"], row["fingerprint"]))
	case "user_ai_config":
		return h.encryptRestoreSecret(row, "custom_api_key", crypto.SecretAAD("user_ai_config", row["user_id"], "custom_api_key"))
	default:
		return nil
	}
}

func (h *BackupHandler) encryptRestoreSecret(row map[string]interface{}, column string, aad []byte) error {
	value := backupStringValue(row[column])
	if strings.TrimSpace(value) == "" {
		return nil
	}
	encrypted, err := h.encryptor.EncryptSecret(value, aad)
	if err != nil {
		return fmt.Errorf("failed to encrypt %s: %w", column, err)
	}
	row[column] = encrypted
	return nil
}

func (h *BackupHandler) encryptUserRestoreSecrets(row map[string]interface{}) error {
	userID := row["id"]
	if err := h.encryptRestoreSecret(row, "two_factor_secret", crypto.SecretAAD("users", userID, "two_factor_secret")); err != nil {
		return err
	}
	if err := h.encryptRestoreSecret(row, "nezha_api_token", crypto.SecretAAD("users", userID, "nezha_api_token")); err != nil {
		return err
	}
	return h.encryptRestoreSecret(row, "komari_api_token", crypto.SecretAAD("users", userID, "komari_api_token"))
}

func (h *BackupHandler) encryptServerRestoreSecrets(row map[string]interface{}) error {
	serverID := row["id"]
	userID := row["user_id"]
	if err := h.encryptRestoreSecret(row, "password", serverCredentialAAD(userID, serverID, "password")); err != nil {
		return err
	}
	return h.encryptRestoreSecret(row, "private_key", serverCredentialAAD(userID, serverID, "private_key"))
}

func (h *BackupHandler) encryptNotificationConfigRow(row map[string]interface{}) error {
	if err := h.transformJSONSecret(row, "smtp_config", "password", notificationConfigAAD("smtp", "password"), true); err != nil {
		return err
	}
	if err := h.transformJSONSecret(row, "webhook_config", "secret", notificationConfigAAD("webhook", "secret"), true); err != nil {
		return err
	}
	if err := h.transformJSONSecret(row, "ding_talk_config", "secret", notificationConfigAAD("dingtalk", "secret"), true); err != nil {
		return err
	}
	return nil
}

func (h *BackupHandler) transformJSONSecret(row map[string]interface{}, column string, field string, aad []byte, encrypt bool) error {
	raw := backupStringValue(row[column])
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return fmt.Errorf("invalid JSON in %s: %w", column, err)
	}
	value := backupStringValue(data[field])
	if strings.TrimSpace(value) == "" {
		return nil
	}

	var transformed string
	var err error
	if encrypt {
		transformed, err = h.encryptor.EncryptSecret(value, aad)
	} else {
		transformed, err = h.encryptor.DecryptSecret(value, aad)
	}
	if err != nil {
		return fmt.Errorf("failed to transform %s.%s: %w", column, field, err)
	}
	data[field] = transformed
	encoded, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to encode %s: %w", column, err)
	}
	row[column] = string(encoded)
	return nil
}

func clearJSONSecret(row map[string]interface{}, column string, field string) {
	raw := backupStringValue(row[column])
	if strings.TrimSpace(raw) == "" {
		return
	}
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		row[column] = ""
		return
	}
	if _, ok := data[field]; !ok {
		return
	}
	data[field] = ""
	if encoded, err := json.Marshal(data); err == nil {
		row[column] = string(encoded)
	}
}

func copyJSONSecretIfBlank(target map[string]interface{}, existing map[string]interface{}, column string, field string) {
	targetRaw := backupStringValue(target[column])
	existingRaw := backupStringValue(existing[column])
	if strings.TrimSpace(targetRaw) == "" || strings.TrimSpace(existingRaw) == "" {
		return
	}

	var targetData map[string]interface{}
	if err := json.Unmarshal([]byte(targetRaw), &targetData); err != nil {
		return
	}
	if strings.TrimSpace(backupStringValue(targetData[field])) != "" {
		return
	}

	var existingData map[string]interface{}
	if err := json.Unmarshal([]byte(existingRaw), &existingData); err != nil {
		return
	}
	existingSecret := backupStringValue(existingData[field])
	if strings.TrimSpace(existingSecret) == "" {
		return
	}
	targetData[field] = existingSecret
	if encoded, err := json.Marshal(targetData); err == nil {
		target[column] = string(encoded)
	}
}

func filterExistingColumns(existing []string, wanted []string) []string {
	result := make([]string, 0, len(wanted))
	for _, column := range wanted {
		if containsStringFold(existing, column) {
			result = append(result, column)
		}
	}
	return result
}

func quoteColumns(driver string, columns []string) []string {
	result := make([]string, len(columns))
	for i, column := range columns {
		result[i] = quoteIdentifier(driver, column)
	}
	return result
}

func serverCredentialAAD(userID interface{}, serverID interface{}, column string) []byte {
	return []byte(fmt.Sprintf("easyssh:servers:%v:%v:%s", userID, serverID, column))
}

func sshKeyPrivateKeyAAD(userID interface{}, fingerprint interface{}) []byte {
	return []byte(fmt.Sprintf("easyssh:ssh_keys:%v:%v:private_key", userID, fingerprint))
}

func notificationConfigAAD(section string, field string) []byte {
	return crypto.SecretAAD("notification_config", section, field)
}

func backupStringValue(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	case []byte:
		return string(v)
	default:
		return fmt.Sprint(v)
	}
}
