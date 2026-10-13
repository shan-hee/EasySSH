package datasync

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/server/internal/domain/useraiconfig"
	"github.com/easyssh/shared/aichatui"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/syncdata"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newSyncTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "sync.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { raw.Close() })
	if err := db.AutoMigrate(&State{}, &VaultDocument{}, &VaultObject{}, &useraiconfig.UserAIConfig{}, &runtime.AISessionRecord{}); err != nil {
		t.Fatal(err)
	}
	encryptor, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	path, err := filepath.Abs("../../../sync-runtime/engine.mjs")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("EASYSSH_SYNC_ENGINE", path)
	engine := &Engine{}
	t.Cleanup(engine.Close)
	return &Service{DB: db, Encryptor: encryptor, Engine: engine}
}

func TestSyncEnabledPreservesDocumentAndOtherOwners(t *testing.T) {
	s := newSyncTestService(t)
	ctx := context.Background()
	owner, other := uuid.New(), uuid.New()
	if enabled, err := s.Enabled(ctx, owner); err != nil || !enabled {
		t.Fatalf("default: %v %v", enabled, err)
	}
	if err := s.DB.Create(&State{UserID: owner, Document: "document", Revision: 7}).Error; err != nil {
		t.Fatal(err)
	}
	for _, enabled := range []bool{false, true, false} {
		if err := s.SetEnabled(ctx, owner, enabled); err != nil {
			t.Fatal(err)
		}
		actual, err := s.Enabled(ctx, owner)
		if err != nil || actual != enabled {
			t.Fatalf("toggle: %v %v", actual, err)
		}
	}
	var state State
	if err := s.DB.First(&state, "user_id=?", owner).Error; err != nil {
		t.Fatal(err)
	}
	if state.Document != "document" || state.Revision != 7 {
		t.Fatal("toggle overwrote sync history")
	}
	if enabled, err := s.Enabled(ctx, other); err != nil || !enabled {
		t.Fatalf("changed other owner: %v", err)
	}
}

func TestVaultObjectsAreEncryptedImmutableAndOwnerBound(t *testing.T) {
	s := newSyncTestService(t)
	ctx := context.Background()
	owner, other := uuid.New(), uuid.New()
	ref := uuid.NewString()
	p := syncdata.VaultPayload{Kind: "ai_config", AIConfig: &syncdata.AIConfig{Provider: "openai", APIKey: "secret-key"}}
	value := syncdata.JSON(p)
	if err := s.PutVaultObject(ctx, owner, p.Kind, ref, syncdata.AIConfigID, value); err != nil {
		t.Fatal(err)
	}
	if err := s.PutVaultObject(ctx, owner, p.Kind, ref, syncdata.AIConfigID, value); err != nil {
		t.Fatal(err)
	}
	var row VaultObject
	if err := s.DB.First(&row, "user_id=? AND id=?", owner, ref).Error; err != nil {
		t.Fatal(err)
	}
	if !crypto.HasEncryptedPrefix(string(row.Ciphertext)) || strings.Contains(string(row.Ciphertext), "secret-key") {
		t.Fatal("object not encrypted")
	}
	if _, err := s.GetVaultObject(ctx, other, ref); err == nil {
		t.Fatal("read another owner's object")
	}
	if _, err := s.vaultPayload(s.DB, owner, p.Kind, uuid.NewString(), ref); err == nil {
		t.Fatal("accepted object bound to another resource")
	}
	p.AIConfig.APIKey = "changed"
	if err := s.PutVaultObject(ctx, owner, p.Kind, ref, syncdata.AIConfigID, syncdata.JSON(p)); err == nil {
		t.Fatal("overwrote immutable object")
	}
	row.UserID = other
	if err := s.DB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetVaultObject(ctx, other, ref); err == nil {
		t.Fatal("AAD accepted ciphertext moved to another account")
	}
}

func TestVaultAIConfigExchangeIsStable(t *testing.T) {
	s := newSyncTestService(t)
	ctx := context.Background()
	owner := uuid.New()
	ref := uuid.NewString()
	p := syncdata.VaultPayload{Kind: "ai_config", Source: "desktop", UpdatedAt: time.Now(), AIConfig: &syncdata.AIConfig{Enabled: true, Provider: "openai", APIKey: "personal-key", Models: "test-model"}}
	if err := s.PutVaultObject(ctx, owner, p.Kind, ref, syncdata.AIConfigID, syncdata.JSON(p)); err != nil {
		t.Fatal(err)
	}
	peer, err := s.Engine.Run(ctx, EngineInput{Current: syncdata.Snapshot{syncdata.ValueKey: {"ref": ref}}})
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.VaultExchange(ctx, owner, p.Kind, syncdata.AIConfigID, Peer{Document: peer.Document}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Conflicts) != 0 {
		t.Fatal("unexpected initial conflict")
	}
	var config useraiconfig.UserAIConfig
	if err := s.DB.First(&config, "user_id=?", owner).Error; err != nil {
		t.Fatal(err)
	}
	if config.UseSystemConfig || !config.CustomEnabled {
		t.Fatal("personal config replaced by system defaults")
	}
	plain, err := s.Encryptor.DecryptSecret(config.CustomAPIKey, crypto.SecretAAD("user_ai_config", owner.String(), "custom_api_key"))
	if err != nil || plain != "personal-key" {
		t.Fatalf("key round trip: %v", err)
	}
	var before int64
	s.DB.Model(&VaultObject{}).Count(&before)
	// Unrelated model timestamps must not create another secret version.
	if err := s.DB.Model(&config).UpdateColumn("updated_at", time.Now().Add(time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	var updated useraiconfig.UserAIConfig
	s.DB.First(&updated, "user_id=?", owner)
	for i := 0; i < 3; i++ {
		result, err := s.VaultExchange(ctx, owner, p.Kind, syncdata.AIConfigID, Peer{Heads: first.Response.Heads}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Conflicts) != 0 || result.Snapshot[syncdata.ValueKey]["ref"] != ref {
			t.Fatal("repeat exchange changed value")
		}
	}
	var after int64
	s.DB.Model(&VaultObject{}).Count(&after)
	if before != after {
		t.Fatalf("sync echo created objects: %d -> %d", before, after)
	}
	var final useraiconfig.UserAIConfig
	s.DB.First(&final, "user_id=?", owner)
	if !final.UpdatedAt.Equal(updated.UpdatedAt) {
		t.Fatal("repeat sync reapplied unchanged configuration")
	}
}

func TestVaultConcurrentConversationsCanBeForkedWithoutExecution(t *testing.T) {
	s := newSyncTestService(t)
	ctx := context.Background()
	owner := uuid.New()
	id := uuid.NewString()
	makePeer := func(title string) (string, EngineResult) {
		t.Helper()
		ref := uuid.NewString()
		p := syncdata.VaultPayload{Kind: "ai_session", Source: "desktop", Conversation: &syncdata.Conversation{Title: title, CreatedAt: time.Now(), Messages: []aichatui.MessageView{{ID: uuid.NewString(), Role: "user", Content: title}}, Tasks: []aichatui.TaskView{{ID: "task", Status: aichatui.TaskStatusRunning, RequiresConfirmation: true}}}}
		if err := s.PutVaultObject(ctx, owner, p.Kind, ref, id, syncdata.JSON(p)); err != nil {
			t.Fatal(err)
		}
		peer, err := s.Engine.Run(ctx, EngineInput{Current: syncdata.Snapshot{syncdata.ValueKey: {"ref": ref}}})
		if err != nil {
			t.Fatal(err)
		}
		return ref, peer
	}
	_, left := makePeer("left")
	rightRef, right := makePeer("right")
	if _, err := s.VaultExchange(ctx, owner, "ai_session", id, Peer{Document: left.Document}, nil); err != nil {
		t.Fatal(err)
	}
	merged, err := s.VaultExchange(ctx, owner, "ai_session", id, Peer{Document: right.Document}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(merged.Conflicts) != 1 || len(merged.Conflicts[0].Values) != 2 {
		t.Fatalf("lost conversation branch: %+v", merged.Conflicts)
	}
	forkID, err := s.ForkVaultSession(ctx, owner, id, rightRef)
	if err != nil {
		t.Fatal(err)
	}
	if forkID == id {
		t.Fatal("fork reused original session")
	}
	var fork runtime.AISessionRecord
	if err := s.DB.First(&fork, "id=?", forkID).Error; err != nil {
		t.Fatal(err)
	}
	if fork.Title != "right" || fork.Status != "idle" || fork.PermissionMode != "readonly" {
		t.Fatalf("unsafe imported session: %+v", fork)
	}
	var tasks []runtime.PersistedTask
	if err := json.Unmarshal(fork.Tasks, &tasks); err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].View.Status != aichatui.TaskStatusCancelled || tasks[0].View.RequiresConfirmation {
		t.Fatal("historical task remained executable")
	}
	if _, err := s.ForkVaultSession(ctx, uuid.New(), id, rightRef); err == nil {
		t.Fatal("copied another owner's conversation")
	}
}
