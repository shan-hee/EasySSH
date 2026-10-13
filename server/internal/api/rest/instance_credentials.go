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
		{"system_config", []string{"google_client_secret"}, true},
		{"notification_config", []string{"smtp_config", "webhook_config", "ding_talk_config"}, true},
		{"ai_config", []string{"system_api_key"}, true},
		{"users", []string{"id", "nezha_api_token", "komari_api_token"}, true},
		{"servers", []string{"id", "user_id", "password"}, true},
		{"ssh_keys", []string{"user_id", "fingerprint", "private_key"}, false},
		{"user_ai_config", []string{"user_id", "custom_api_key"}, true},
		// MFA, signing keys and sync objects also cover retained inactive records.
		{"users", []string{"id", "two_factor_secret"}, false},
		{"oauth_signing_keys", []string{"id", "encrypted_private_pem"}, false},
		{"sync_vault_objects", []string{"user_id", "id", "ciphertext"}, false},
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
	case "system_config":
		return verify("google_client_secret", crypto.SecretAAD(table, "system", "google_client_secret"))
	case "ai_config":
		return verify("system_api_key", crypto.SecretAAD(table, "system", "system_api_key"))
	case "users":
		for _, column := range []string{"nezha_api_token", "komari_api_token", "two_factor_secret"} {
			if err := verify(column, crypto.SecretAAD(table, row["id"], column)); err != nil {
				return err
			}
		}
	case "servers":
		return verify("password", []byte(fmt.Sprintf("easyssh:servers:%s:%s:password", row["user_id"], row["id"])))
	case "ssh_keys":
		return verify("private_key", []byte(fmt.Sprintf("easyssh:ssh_keys:%s:%s:private_key", row["user_id"], row["fingerprint"])))
	case "user_ai_config":
		return verify("custom_api_key", crypto.SecretAAD(table, row["user_id"], "custom_api_key"))
	case "oauth_signing_keys":
		return verify("encrypted_private_pem", []byte("oauth-signing-key:"+row["id"]))
	case "sync_vault_objects":
		return verify("ciphertext", []byte("easyssh:sync-vault:"+row["user_id"]+":"+row["id"]))
	case "notification_config":
		for _, field := range []struct{ column, section, secret string }{
			{"smtp_config", "smtp", "password"},
			{"webhook_config", "webhook", "secret"},
			{"ding_talk_config", "dingtalk", "secret"},
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
