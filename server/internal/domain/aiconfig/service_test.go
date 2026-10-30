package aiconfig

import (
	"bytes"
	"context"
	"encoding/base64"
	"github.com/easyssh/server/internal/testutil"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/secretcrypto"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestOwnerAIConfigPersistsOneEncryptedValueAndReset(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&Config{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	encryptor, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db, encryptor)
	service := NewService(repo, encryptor)
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}, time.Now().Add(time.Hour), aiConfigAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := access.WithScope(context.Background(), scope)
	initial, err := service.Get(ctx)
	if err != nil || initial.Enabled {
		t.Fatalf("invalid default: %+v %v", initial, err)
	}
	var count int64
	if err := db.Model(&Config{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("read created config: %d %v", count, err)
	}
	secret := "owner-secret"
	input := protocol.AIConfigInput{Enabled: true, Provider: "openai", Endpoint: "https://provider.example/v1", APIKey: &secret, Models: []string{"a", "b"}}
	public, err := service.Save(ctx, input)
	if err != nil || !public.HasAPIKey || !public.Enabled {
		t.Fatalf("save failed: %+v %v", public, err)
	}
	if _, err := service.Save(ctx, input); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.Get(ctx)
	if err != nil || stored.ID != ConfigID || stored.APIKey == secret || !slices.Equal(stored.Models, input.Models) {
		t.Fatalf("storage lost singleton/encryption/models: %v", err)
	}
	if _, err := encryptor.DecryptSecret(stored.APIKey, crypto.SecretAAD("ai_config", "2", "api_key")); err == nil {
		t.Fatal("ciphertext not bound to singleton record")
	}
	input.APIKey, input.Enabled = nil, false
	if _, err := service.Save(ctx, input); err != nil {
		t.Fatal(err)
	}
	disabled, err := service.Get(ctx)
	if err != nil || disabled.Enabled || disabled.APIKey != secret {
		t.Fatalf("disabled edit did not retain key: %v", err)
	}
	if err := service.Reset(ctx); err != nil {
		t.Fatal(err)
	}
	if err := service.Reset(ctx); err != nil {
		t.Fatal(err)
	}
	reset, err := service.Get(ctx)
	if err != nil || reset.Enabled || reset.APIKey != "" || len(reset.Models) != 0 {
		t.Fatalf("reset retained configuration: %+v %v", reset, err)
	}
	if err := db.Model(&Config{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("reset must leave one syncable disabled value: %d %v", count, err)
	}
	var facts []operationrecord.OperationRecord
	if err := db.Order("created_at,id").Find(&facts).Error; err != nil || len(facts) != 3 {
		t.Fatalf("AI changes or replay counted incorrectly: %d %v", len(facts), err)
	}
	for _, fact := range facts {
		if fact.Actor != scope.Actor() || fact.Source != "manual" || fact.Action != "ai_config_update" || strings.Contains(fact.DetailJSON, secret) || strings.Contains(fact.DetailJSON, input.Endpoint) {
			t.Fatalf("invalid AI activity: %+v", fact)
		}
	}
	before, err := repo.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TRIGGER reject_ai_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.Save(ctx, protocol.AIConfigInput{Enabled: true, Provider: "openai", APIKey: &secret, Models: []string{"new-model"}}); err == nil {
		t.Fatal("AI config saved without its activity")
	}
	after, err := repo.Get(ctx)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("AI configuration not rolled back: %v", err)
	}
	if err := db.Create(&Config{ID: 2, Provider: "openai", Models: []string{}}).Error; err == nil {
		t.Fatal("database accepted another AI config")
	}
}

// The service is invoked behind the owner's authenticated route.
type aiConfigAuthority struct {
	testutil.AccessPolicy
}

func (aiConfigAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
