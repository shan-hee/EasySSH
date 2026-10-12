package rest

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/easyssh/shared/dbmigration"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestInstanceCredentialVerification(t *testing.T) {
	const secret = "credential-verification-fixture"
	encryptor, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	wrongKey, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{2}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		table, column, jsonField string
		aad                      []byte
		row                      map[string]any
	}{
		{"system_config", "google_client_secret", "", crypto.SecretAAD("system_config", "system", "google_client_secret"), nil},
		{"notification_config", "smtp_config", "password", crypto.SecretAAD("notification_config", "smtp", "password"), nil},
		{"notification_config", "webhook_config", "secret", crypto.SecretAAD("notification_config", "webhook", "secret"), nil},
		{"notification_config", "ding_talk_config", "secret", crypto.SecretAAD("notification_config", "dingtalk", "secret"), nil},
		{"users", "two_factor_secret", "", crypto.SecretAAD("users", "owner", "two_factor_secret"), nil},
		{"oauth_signing_keys", "encrypted_private_pem", "", []byte("oauth-signing-key:key"), map[string]any{"id": "key"}},
	}
	for _, tc := range cases {
		t.Run(tc.table+"/"+tc.column, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "instance.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			if err != nil {
				t.Fatal(err)
			}
			raw, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { raw.Close() })
			raw.SetMaxOpenConns(1)
			ctx := context.Background()
			if err := dbmigration.Up(ctx, raw, "server", "sqlite"); err != nil {
				t.Fatal(err)
			}
			if err := VerifyStoredCredentials(ctx, db, encryptor); err != nil {
				t.Fatalf("empty instance: %v", err)
			}
			encode := func(aad []byte) string {
				t.Helper()
				value, err := encryptor.EncryptSecret(secret, aad)
				if err != nil {
					t.Fatal(err)
				}
				if tc.jsonField != "" {
					data, err := json.Marshal(map[string]string{tc.jsonField: value, "host": "example.test"})
					if err != nil {
						t.Fatal(err)
					}
					value = string(data)
				}
				return value
			}
			row := tc.row
			if row == nil {
				row = map[string]any{}
			}
			if tc.table == "users" {
				row = map[string]any{"id": "owner", "username": "fixture", "email": "fixture@example.test", "password": "unusable"}
			}
			stored := encode(tc.aad)
			row[tc.column] = stored
			if err := db.Table(tc.table).Create(row).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Exec("PRAGMA query_only = ON").Error; err != nil {
				t.Fatal(err)
			}
			if err := VerifyStoredCredentials(ctx, db, encryptor); err != nil {
				t.Fatalf("valid credentials must verify without writing: %v", err)
			}
			var after string
			if err := db.Table(tc.table).Select(tc.column).Row().Scan(&after); err != nil || after != stored {
				t.Fatalf("verification changed stored ciphertext: %v", err)
			}
			assertRejected := func(key *crypto.Encryptor) {
				t.Helper()
				err := VerifyStoredCredentials(ctx, db, key)
				if err == nil || !strings.Contains(err.Error(), tc.table) || strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), stored) {
					t.Fatalf("expected credential rejection without leaking its value: %v", err)
				}
			}
			assertRejected(wrongKey)
			if err := db.Exec("PRAGMA query_only = OFF").Error; err != nil {
				t.Fatal(err)
			}
			// A valid ciphertext from another owner/resource must not be accepted.
			if err := db.Table(tc.table).Where("1 = 1").Update(tc.column, encode([]byte("another-resource"))).Error; err != nil {
				t.Fatal(err)
			}
			assertRejected(encryptor)
			if err := db.Table(tc.table).Where("1 = 1").Update(tc.column, "corrupted").Error; err != nil {
				t.Fatal(err)
			}
			assertRejected(encryptor)
		})
	}
}
