package datasync

import (
	"context"
	"encoding/base64"
	"github.com/easyssh/shared/protocol"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/server/internal/domain/aiconfig"
	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/rdp"
	"github.com/easyssh/server/internal/domain/recyclebin"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/vnc"
	"github.com/easyssh/shared/aichatui"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/syncdata"
	"github.com/easyssh/shared/syncengine"
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
	if err := db.AutoMigrate(&recyclebin.Entry{}, &scheduledtask.ScheduledTask{}, &vnc.Config{}, &rdp.Config{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}, &content.Record{}, &State{}, &VaultDocument{}, &VaultObject{}, &aiconfig.Config{}, &runtime.AISessionRecord{}, &runtime.AIMessageRecord{}, &runtime.AIModelMessageRecord{}, &runtime.AISessionTaskRecord{}, &runtime.ToolExecutionRecord{}); err != nil {
		t.Fatal(err)
	}
	encryptor, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	bodies, err := content.New(db, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = bodies.Close() })
	return &Service{DB: db, Encryptor: encryptor, Content: bodies}
}

func TestSyncEnabledPreservesDocumentAndOtherOwners(t *testing.T) {
	s := newSyncTestService(t)
	ctx := context.Background()
	owner, other := uuid.New(), uuid.New()
	if enabled, err := s.Enabled(ctx, owner); err != nil || !enabled {
		t.Fatalf("default: %v %v", enabled, err)
	}
	if err := s.DB.Create(&State{OwnerID: owner, Document: "document", Revision: 7}).Error; err != nil {
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
	if err := s.DB.First(&state, "owner_id=?", owner).Error; err != nil {
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
	p := syncdata.VaultPayload{Kind: "ai_config", AIConfig: &protocol.AIConfigValue{Provider: "openai", APIKey: "secret-key"}}
	value := syncdata.JSON(p)
	if err := s.PutVaultObject(ctx, owner, p.Kind, ref, syncdata.AIConfigID, value); err != nil {
		t.Fatal(err)
	}
	if err := s.PutVaultObject(ctx, owner, p.Kind, ref, syncdata.AIConfigID, value); err != nil {
		t.Fatal(err)
	}
	var row VaultObject
	if err := s.DB.First(&row, "owner_id=? AND id=?", owner, ref).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(row.Ciphertext), "enc:v2:") || strings.Contains(string(row.Ciphertext), "secret-key") {
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
	row.OwnerID = other
	if err := s.DB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetVaultObject(ctx, other, ref); err == nil {
		t.Fatal("AAD accepted ciphertext moved to another account")
	}
}

func TestVaultAIConfigExchangeIsStable(t *testing.T) {
	s := newSyncTestService(t)
	owner := uuid.New()
	ctx := syncActivityContext(t, owner)
	ref := uuid.NewString()
	p := syncdata.VaultPayload{Kind: "ai_config", Source: "desktop", UpdatedAt: time.Now(), AIConfig: &protocol.AIConfigValue{Enabled: true, Provider: "openai", APIKey: "personal-key", Models: []string{"test-model"}}}
	if err := s.PutVaultObject(ctx, owner, p.Kind, ref, syncdata.AIConfigID, syncdata.JSON(p)); err != nil {
		t.Fatal(err)
	}
	peer, err := syncengine.Outgoing("", syncdata.Snapshot{syncdata.ValueKey: {"ref": ref}})
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.VaultExchange(ctx, owner, p.Kind, syncdata.AIConfigID, peer, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Conflicts) != 0 {
		t.Fatal("unexpected initial conflict")
	}
	var config aiconfig.Config
	if err := s.DB.First(&config, "id=?", aiconfig.ConfigID).Error; err != nil {
		t.Fatal(err)
	}
	if !config.Enabled {
		t.Fatal("owner config was not enabled")
	}
	plain, err := s.Encryptor.DecryptSecret(config.APIKey, aiconfig.APIKeyAAD())
	if err != nil || plain != "personal-key" {
		t.Fatalf("key round trip: %v", err)
	}
	var before int64
	s.DB.Model(&VaultObject{}).Count(&before)
	// Unrelated model timestamps must not create another secret version.
	if err := s.DB.Model(&config).UpdateColumn("updated_at", time.Now().Add(time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	var updated aiconfig.Config
	s.DB.First(&updated, "id=?", aiconfig.ConfigID)
	for i := 0; i < 3; i++ {
		result, err := s.VaultExchange(ctx, owner, p.Kind, syncdata.AIConfigID, Peer{Cursor: first.Response.Cursor}, nil)
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
	var final aiconfig.Config
	s.DB.First(&final, "id=?", aiconfig.ConfigID)
	if !final.UpdatedAt.Equal(updated.UpdatedAt) {
		t.Fatal("repeat sync reapplied unchanged configuration")
	}
}

func TestVaultConcurrentConversationsCanBeForkedWithoutExecution(t *testing.T) {
	s := newSyncTestService(t)
	ctx := context.Background()
	owner := uuid.New()
	id := uuid.NewString()
	makePeer := func(title string) (string, Peer) {
		t.Helper()
		ref := uuid.NewString()
		p := syncdata.VaultPayload{Kind: "ai_session", Source: "desktop", Conversation: &syncdata.Conversation{Title: title, CreatedAt: time.Now(), Messages: []aichatui.MessageView{{ID: uuid.NewString(), Role: "user", Content: title}}, Tasks: []aichatui.TaskView{{ID: "task", Status: aichatui.TaskStatusRunning, RequiresConfirmation: true}}}}
		if err := s.PutVaultObject(ctx, owner, p.Kind, ref, id, syncdata.JSON(p)); err != nil {
			t.Fatal(err)
		}
		peer, err := syncengine.Outgoing("", syncdata.Snapshot{syncdata.ValueKey: {"ref": ref}})
		if err != nil {
			t.Fatal(err)
		}
		return ref, peer
	}
	_, left := makePeer("left")
	rightRef, right := makePeer("right")
	if _, err := s.VaultExchange(ctx, owner, "ai_session", id, left, nil); err != nil {
		t.Fatal(err)
	}
	merged, err := s.VaultExchange(ctx, owner, "ai_session", id, right, nil)
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
	if fork.ListTitle != "right" || fork.MessageCount != 1 || fork.TaskCount != 1 || !strings.Contains(fork.SearchFolded, "right") {
		t.Fatalf("imported conversation missing list index: %+v", fork)
	}
	if fork.Title != "right" || fork.Status != "idle" || fork.PermissionMode != "readonly" {
		t.Fatalf("unsafe imported session: %+v", fork)
	}
	snapshot, err := runtime.NewGormSessionStore(s.DB, s.Content).Get(ctx, fork.Actor, fork.ID)
	if err != nil {
		t.Fatal(err)
	}
	tasks := snapshot.Tasks
	if len(tasks) != 1 || tasks[0].View.Status != aichatui.TaskStatusUnknown || tasks[0].View.RequiresConfirmation {
		t.Fatal("historical task remained executable")
	}
	if _, err := s.ForkVaultSession(ctx, uuid.New(), id, rightRef); err == nil {
		t.Fatal("copied another owner's conversation")
	}
}
