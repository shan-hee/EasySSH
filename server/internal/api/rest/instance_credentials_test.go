package rest

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/storage/schema"
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
		{"ai_config", "api_key", "", crypto.SecretAAD("ai_config", "1", "api_key"), map[string]any{"id": 1, "endpoint": "", "models": "[]"}},
		{"notification_config", "smtp_config", "password", crypto.SecretAAD("notification_config", "smtp", "password"), nil},
		{"notification_config", "webhook_config", "secret", crypto.SecretAAD("notification_config", "webhook", "secret"), nil},
		{"notification_config", "ding_talk_config", "secret", crypto.SecretAAD("notification_config", "dingtalk", "secret"), nil},
		{"notification_config", "webhook_config", "url", crypto.SecretAAD("notification_config", "webhook", "url"), nil},
		{"notification_config", "ding_talk_config", "webhook_url", crypto.SecretAAD("notification_config", "dingtalk", "webhook_url"), nil},
		{"notification_config", "we_com_config", "webhook_url", crypto.SecretAAD("notification_config", "wecom", "webhook_url"), nil},
		{"owners", "nezha_api_token", "", crypto.SecretAAD("owners", "owner", "nezha_api_token"), nil},
		{"owners", "komari_api_token", "", crypto.SecretAAD("owners", "owner", "komari_api_token"), nil},
		{"owners", "two_factor_secret", "", crypto.SecretAAD("owners", "owner", "two_factor_secret"), nil},
		{"server_auth", "password", "", crypto.SecretAAD("server_auth", "server", "password"), map[string]any{"server_id": "server", "auth_method": "password"}},
		{"ssh_keys", "private_key", "", crypto.SecretAAD("ssh_keys", "key", "private_key"), map[string]any{"id": "key", "fingerprint": "fingerprint", "name": "fixture", "algorithm": "ed25519", "public_key": "fixture"}},
		{"sync_vault_objects", "ciphertext", "", []byte("easyssh:sync-vault:owner:object"), map[string]any{"owner_id": "owner", "id": "object", "kind": "ai_config", "resource_id": "config"}},
		{"automation_tokens", "token_cipher", "", crypto.SecretAAD("automation_tokens", "token", "token_cipher"), map[string]any{"session_id": "token", "name": "fixture", "grant_id": "grant", "grant_version": 1, "token_hash": "hash", "created_at": "2026-01-01T00:00:00Z", "last_seen_at": "2026-01-01T00:00:00Z", "expires_at": "2027-01-01T00:00:00Z"}},
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
			if err := schema.Initialize(ctx, raw, "sqlite"); err != nil {
				t.Fatal(err)
			}
			if err := VerifyStoredCredentials(ctx, db, encryptor); err != nil {
				t.Fatalf("empty instance: %v", err)
			}
			if tc.table == "automation_tokens" {
				if err := schema.Migrate(ctx, raw, "sqlite", true); err != nil {
					t.Fatal(err)
				}
				if err := VerifyStoredCredentials(ctx, db, encryptor); err != nil {
					t.Fatalf("schema 3 must pass credential verification before upgrading: %v", err)
				}
				if err := schema.Migrate(ctx, raw, "sqlite", false); err != nil {
					t.Fatal(err)
				}
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
			if tc.table == "owners" {
				row = map[string]any{"slot": 1, "id": "owner", "username": "fixture", "email": "fixture@example.test", "password": "unusable"}
			}
			if tc.table == "server_auth" {
				if err := db.Table("servers").Create(map[string]any{"id": "server", "host": "example.test", "username": "root"}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if tc.table == "automation_tokens" {
				if err := db.Exec(`INSERT INTO grants (id,public_id,secret_hash,name,version,default_content,max_sessions,max_connections,created_at,updated_at) VALUES ('grant','public','hash','fixture',1,'files',1,1,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`).Error; err != nil {
					t.Fatal(err)
				}
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
