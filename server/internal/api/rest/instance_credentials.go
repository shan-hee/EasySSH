package rest

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	crypto "github.com/easyssh/shared/secretcrypto"
	"gorm.io/gorm"
)

// VerifyStoredCredentials checks the root key before creating or activating an
// instance snapshot. It neither exports plaintext nor changes stored data.
func VerifyStoredCredentials(ctx context.Context, db *gorm.DB, encryptor *crypto.Encryptor) error {
	if encryptor == nil {
		return fmt.Errorf("credential encryptor is unavailable")
	}
	checks := []struct {
		table      string
		columns    []string
		activeOnly bool
	}{
		{"notification_config", []string{"smtp_config", "webhook_config", "ding_talk_config", "we_com_config"}, true},
		{"ai_config", []string{"api_key"}, false},
		{"owners", []string{"id", "nezha_api_token", "komari_api_token"}, false},
		{"server_auth", []string{"server_id", "password"}, false},
		{"ssh_keys", []string{"id", "private_key", "saved_passphrase"}, false},
		// MFA and sync objects also cover retained inactive records.
		{"owners", []string{"id", "two_factor_secret", "pending_two_factor_secret"}, false},
		{"sync_vault_objects", []string{"owner_id", "id", "ciphertext"}, false},
	}
	for _, check := range checks {
		query := db.WithContext(ctx).Table(check.table).Select(check.columns)
		if check.activeOnly {
			query = query.Where("deleted_at IS NULL")
		}
		if err := verifyInstanceCredentialRows(query, check.table, check.columns, encryptor); err != nil {
			return fmt.Errorf("stored credential verification failed in %s: %w", check.table, err)
		}
	}
	return nil
}

func verifyInstanceCredentialRows(query *gorm.DB, table string, columns []string, encryptor *crypto.Encryptor) error {
	rows, err := query.Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		values := make([]sql.NullString, len(columns))
		targets := make([]any, len(columns))
		for i := range values {
			targets[i] = &values[i]
		}
		if err := rows.Scan(targets...); err != nil {
			return err
		}
		row := make(map[string]string, len(columns))
		for i, column := range columns {
			row[column] = values[i].String
		}
		if err := verifyInstanceCredentialRow(table, row, encryptor); err != nil {
			return err
		}
	}
	return rows.Err()
}

func verifyInstanceCredentialRow(table string, row map[string]string, encryptor *crypto.Encryptor) error {
	verify := func(column string, aad []byte) error {
		if _, err := encryptor.DecryptSecret(row[column], aad); err != nil {
			return fmt.Errorf("%s cannot be decrypted: %w", column, err)
		}
		return nil
	}
	switch table {
	case "ai_config":
		return verify("api_key", crypto.SecretAAD(table, "1", "api_key"))
	case "owners":
		for _, column := range []string{"nezha_api_token", "komari_api_token", "two_factor_secret", "pending_two_factor_secret"} {
			if err := verify(column, crypto.SecretAAD(table, row["id"], column)); err != nil {
				return err
			}
		}
	case "server_auth":
		return verify("password", crypto.SecretAAD(table, row["server_id"], "password"))
	case "ssh_keys":
		if err := verify("private_key", crypto.SecretAAD(table, row["id"], "private_key")); err != nil {
			return err
		}
		return verify("saved_passphrase", crypto.SecretAAD(table, row["id"], "saved_passphrase"))
	case "sync_vault_objects":
		return verify("ciphertext", []byte("easyssh:sync-vault:"+row["owner_id"]+":"+row["id"]))
	case "notification_config":
		for _, field := range []struct{ column, section, secret string }{
			{"smtp_config", "smtp", "password"},
			{"webhook_config", "webhook", "secret"},
			{"webhook_config", "webhook", "url"},
			{"ding_talk_config", "dingtalk", "secret"},
			{"ding_talk_config", "dingtalk", "webhook_url"},
			{"we_com_config", "wecom", "webhook_url"},
		} {
			raw := row[field.column]
			if strings.TrimSpace(raw) == "" {
				continue
			}
			var config map[string]json.RawMessage
			if err := json.Unmarshal([]byte(raw), &config); err != nil {
				return fmt.Errorf("invalid %s JSON: %w", field.column, err)
			}
			var value string
			if rawSecret, ok := config[field.secret]; ok {
				if err := json.Unmarshal(rawSecret, &value); err != nil {
					return fmt.Errorf("invalid %s.%s: %w", field.column, field.secret, err)
				}
			}
			if _, err := encryptor.DecryptSecret(value, crypto.SecretAAD(table, field.section, field.secret)); err != nil {
				return fmt.Errorf("%s.%s cannot be decrypted: %w", field.column, field.secret, err)
			}
		}
	}
	return nil
}
