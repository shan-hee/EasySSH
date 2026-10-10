package rest

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sort"
	"testing"

	"github.com/easyssh/shared/backupcrypto"
	"github.com/easyssh/shared/backuputil"
	"github.com/easyssh/shared/dbmigration"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const importTestOwner = "10000000-0000-4000-8000-000000000001"
const importTestSourceOwner = "00000000-0000-4000-8000-000000000001"

func newDesktopImportTestHandler(t *testing.T) *BackupHandler {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "import.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := dbmigration.Start(context.Background(), sqlDB, "server", "sqlite"); err != nil {
		t.Fatal(err)
	}
	if err := db.Table("users").Create(map[string]any{"id": importTestOwner, "username": "web-owner", "email": "owner@example.test", "password": "unchanged-hash", "role": "user"}).Error; err != nil {
		t.Fatal(err)
	}
	e, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	return NewBackupHandler(db, e)
}

func importTestTable(name string, row map[string]any) BackupTable {
	columns := make([]string, 0, len(row))
	for column := range row {
		columns = append(columns, column)
	}
	sort.Strings(columns)
	return BackupTable{Name: name, PrimaryKey: []string{"id"}, Columns: columns, Rows: []map[string]any{row}}
}

func desktopImportTestBackup(t *testing.T, sensitive bool) *UnifiedBackup {
	t.Helper()
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	key, err := ssh.NewPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	backup := &UnifiedBackup{
		Format: backuputil.Format, Version: backuputil.Version, Source: backuputil.SourceDesktop,
		Contents: BackupContentSelection{Database: true, Sensitive: sensitive},
		Database: &BackupDataSection{Driver: "sqlite", Tables: []BackupTable{
			importTestTable("users", map[string]any{"id": importTestSourceOwner, "username": "desktop", "email": "desktop-local-owner@easyssh.local", "role": "admin"}),
			importTestTable("ssh_keys", map[string]any{"id": 77, "user_id": importTestSourceOwner, "name": "key", "public_key": string(ssh.MarshalAuthorizedKey(key)), "fingerprint": ssh.FingerprintSHA256(key), "algorithm": "ed25519"}),
			importTestTable("servers", map[string]any{"id": "20000000-0000-4000-8000-000000000001", "user_id": importTestSourceOwner, "host": "example.test", "username": "root", "auth_method": "key", "ssh_key_id": 77}),
			importTestTable("scripts", map[string]any{"id": "30000000-0000-4000-8000-000000000001", "user_id": importTestSourceOwner, "name": "script", "content": "pwd"}),
		}},
	}
	if sensitive {
		digest, err := backuputil.BaseSHA256(backup)
		if err != nil {
			t.Fatal(err)
		}
		payload := &backuputil.SensitivePayload{
			Version: backuputil.SensitivePayloadVersion, Contents: backup.Contents, BaseSHA256: digest,
			Database: &BackupDataSection{Driver: "sqlite", Tables: []BackupTable{
				importTestTable("servers", map[string]any{"id": backup.Database.Tables[2].Rows[0]["id"], "user_id": importTestSourceOwner, "password": "test-password"}),
				importTestTable("ssh_keys", map[string]any{"id": 77, "user_id": importTestSourceOwner, "fingerprint": ssh.FingerprintSHA256(key), "private_key": "test-private-material"}),
			}},
		}
		backup.Sensitive, err = backupcrypto.EncryptJSONWithPassphrase(payload, "test-import-passphrase")
		if err != nil {
			t.Fatal(err)
		}
	}
	return backup
}

func desktopImportRequest(t *testing.T, h *BackupHandler, backup *UnifiedBackup, preview bool, strategy, owner string) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", "application-data.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewEncoder(file).Encode(backup); err != nil {
		t.Fatal(err)
	}
	for field, value := range map[string]string{"include_database": "true", "conflict_strategy": strategy, "age_passphrase": "test-import-passphrase"} {
		if err := writer.WriteField(field, value); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/backup/restore", &body)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	if owner != "" {
		c.Set("user_id", owner)
	}
	h.restoreApplicationData(c, preview)
	return recorder
}

func requireImportStatus(t *testing.T, response *httptest.ResponseRecorder, status int) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("HTTP %d, want %d: %s", response.Code, status, response.Body.String())
	}
}

func requireImportCount(t *testing.T, h *BackupHandler, table string, expected int64) {
	t.Helper()
	var count int64
	if err := h.db.Table(table).Count(&count).Error; err != nil || count != expected {
		t.Fatalf("%s count = %d, want %d: %v", table, count, expected, err)
	}
}

func TestDesktopImportBindsResourcesWithoutRestoringUser(t *testing.T) {
	for _, sensitive := range []bool{false, true} {
		name := "plain"
		if sensitive {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			h := newDesktopImportTestHandler(t)
			backup := desktopImportTestBackup(t, sensitive)
			preview := desktopImportRequest(t, h, backup, true, "error", importTestOwner)
			requireImportStatus(t, preview, http.StatusOK)
			for _, table := range []string{"servers", "scripts", "ssh_keys"} {
				requireImportCount(t, h, table, 0)
			}
			result := desktopImportRequest(t, h, backup, false, "error", importTestOwner)
			requireImportStatus(t, result, http.StatusOK)
			for _, response := range []*httptest.ResponseRecorder{preview, result} {
				var report struct {
					Summary map[string]restoreSectionSummary `json:"summary"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &report); err != nil {
					t.Fatal(err)
				}
				if report.Summary["database"].Inserted != 3 {
					t.Fatalf("unexpected import counts: %+v", report.Summary)
				}
			}
			requireImportCount(t, h, "users", 1)
			var user struct{ Username, Role, Password string }
			if err := h.db.Table("users").Where("id = ?", importTestOwner).Take(&user).Error; err != nil {
				t.Fatal(err)
			}
			if user.Username != "web-owner" || user.Role != "user" || user.Password != "unchanged-hash" {
				t.Fatal("import changed the signed-in user's profile or credentials")
			}
			var server struct {
				ID, UserID, Password string
				SSHKeyID             uint
			}
			var key struct {
				ID                              uint
				UserID, Fingerprint, PrivateKey string
			}
			if err := h.db.Table("servers").Take(&server).Error; err != nil {
				t.Fatal(err)
			}
			if err := h.db.Table("ssh_keys").Take(&key).Error; err != nil {
				t.Fatal(err)
			}
			for _, table := range []string{"servers", "scripts", "ssh_keys"} {
				var foreign int64
				if err := h.db.Table(table).Where("user_id <> ?", importTestOwner).Count(&foreign).Error; err != nil || foreign != 0 {
					t.Fatalf("%s retained foreign ownership: %v", table, err)
				}
			}
			if server.SSHKeyID != key.ID || key.ID == 77 {
				t.Fatal("server retained source SSH key ID")
			}
			if sensitive {
				password, err := h.encryptor.DecryptSecret(server.Password, serverCredentialAAD(importTestOwner, server.ID, "password"))
				if err != nil || password != "test-password" {
					t.Fatalf("password not encrypted for target owner: %v", err)
				}
				private, err := h.encryptor.DecryptSecret(key.PrivateKey, sshKeyPrivateKeyAAD(importTestOwner, key.Fingerprint))
				if err != nil || private != "test-private-material" {
					t.Fatalf("private key not encrypted for target owner: %v", err)
				}
			}
			for _, strategy := range []string{"skip", "overwrite"} {
				for _, preview := range []bool{true, false} {
					requireImportStatus(t, desktopImportRequest(t, h, backup, preview, strategy, importTestOwner), http.StatusOK)
				}
			}
			for _, table := range []string{"users", "servers", "scripts", "ssh_keys"} {
				requireImportCount(t, h, table, 1)
			}
		})
	}
}

func TestDesktopImportRejectsForeignOwnerAndRollsBack(t *testing.T) {
	h := newDesktopImportTestHandler(t)
	backup := desktopImportTestBackup(t, false)
	row := backup.Database.Tables[2].Rows[0]
	if err := h.db.Table("servers").Create(map[string]any{"id": row["id"], "user_id": "foreign-owner", "host": "original.test", "username": "user", "auth_method": "password"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, strategy := range []string{"skip", "overwrite", "error"} {
		for _, preview := range []bool{true, false} {
			requireImportStatus(t, desktopImportRequest(t, h, backup, preview, strategy, importTestOwner), http.StatusConflict)
			requireImportCount(t, h, "ssh_keys", 0)
			requireImportCount(t, h, "scripts", 0)
		}
	}
	var original struct{ UserID, Host string }
	if err := h.db.Table("servers").Take(&original).Error; err != nil {
		t.Fatal(err)
	}
	if original.UserID != "foreign-owner" || original.Host != "original.test" {
		t.Fatal("foreign resource was modified")
	}
}

func TestDesktopImportRequiresAuthenticatedOwner(t *testing.T) {
	h := newDesktopImportTestHandler(t)
	for _, preview := range []bool{true, false} {
		requireImportStatus(t, desktopImportRequest(t, h, desktopImportTestBackup(t, false), preview, "skip", ""), http.StatusUnauthorized)
	}
}

func TestServerImportRetainsSourceUserMapping(t *testing.T) {
	h := newDesktopImportTestHandler(t)
	backup := desktopImportTestBackup(t, false)
	backup.Source = backuputil.SourceServer
	requireImportStatus(t, desktopImportRequest(t, h, backup, false, "error", importTestOwner), http.StatusOK)
	requireImportCount(t, h, "users", 2)
	var server struct{ UserID string }
	if err := h.db.Table("servers").Take(&server).Error; err != nil {
		t.Fatal(err)
	}
	if server.UserID != importTestSourceOwner {
		t.Fatal("server import unexpectedly rebound source ownership")
	}
}
