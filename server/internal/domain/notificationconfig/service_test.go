package notificationconfig

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"

	"github.com/easyssh/shared/protocol"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func notificationFixture(t *testing.T) (*gorm.DB, Repository, Service) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "notifications.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	raw.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = raw.Close() })
	if err := db.AutoMigrate(&NotificationConfig{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	key, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db)
	return db, repo, NewService(repo, key)
}

func configPtr[T any](v T) *T { return &v }

func TestNotificationUpdateEncryptionAndClear(t *testing.T) {
	_, repo, service := notificationFixture(t)
	ctx := notificationContext(t)
	password, secret := "smtp-password-fixture", "signing-secret-fixture"
	address := "https://example.test/hook?token=private-fixture"
	input := &protocol.NotificationConfigUpdate{
		SMTP:     &protocol.SMTPConfigUpdate{Password: &password, UseTLS: configPtr(true)},
		Webhook:  &protocol.WebhookConfigUpdate{Enabled: configPtr(true), URL: &address, Secret: &secret},
		DingTalk: &protocol.DingTalkConfigUpdate{WebhookURL: &address, Secret: &secret},
		WeCom:    &protocol.WeComConfigUpdate{WebhookURL: &address},
	}
	if err := service.SaveAllConfig(ctx, input); err != nil {
		t.Fatal(err)
	}
	before, err := repo.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	stored, _ := json.Marshal(before)
	for _, value := range []string{password, secret, address, "private-fixture"} {
		if bytes.Contains(stored, []byte(value)) {
			t.Fatal("plaintext secret in stored row")
		}
	}
	current, err := service.GetAllConfig(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if current.SMTP.Password != password || current.Webhook.URL != address || current.WeCom.WebhookURL != address {
		t.Fatal("roundtrip lost credentials")
	}
	public, _ := json.Marshal(current.Public())
	for _, field := range []string{`"password":`, `"secret":`, `"url":`, `"webhook_url":`} {
		if bytes.Contains(public, []byte(field)) {
			t.Fatalf("public view exposes %s", field)
		}
	}
	if !current.Public().SMTP.HasPassword || !current.Public().WeCom.HasWebhookURL {
		t.Fatal("missing configured flags")
	}
	if err := service.SaveAllConfig(ctx, input); err != nil {
		t.Fatal(err)
	}
	same, err := repo.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if same.SMTPConfig != before.SMTPConfig || same.WebhookConfig != before.WebhookConfig || same.DingTalkConfig != before.DingTalkConfig || same.WeComConfig != before.WeComConfig || !same.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatal("unchanged update rewrote storage")
	}
	if err := service.SaveAllConfig(ctx, &protocol.NotificationConfigUpdate{
		SMTP:    &protocol.SMTPConfigUpdate{UseTLS: configPtr(false)},
		Webhook: &protocol.WebhookConfigUpdate{Enabled: configPtr(false)},
	}); err != nil {
		t.Fatal(err)
	}
	current, err = service.GetAllConfig(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if current.SMTP.UseTLS || current.Webhook.Enabled || current.SMTP.Password != password || current.Webhook.Secret != secret {
		t.Fatal("omission/false update lost configuration")
	}
	if err := service.SaveAllConfig(ctx, &protocol.NotificationConfigUpdate{
		SMTP:    &protocol.SMTPConfigUpdate{Password: configPtr("")},
		Webhook: &protocol.WebhookConfigUpdate{URL: configPtr(""), Secret: configPtr("")},
	}); err != nil {
		t.Fatal(err)
	}
	current, err = service.GetAllConfig(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if current.Public().SMTP.HasPassword || current.Public().Webhook.HasURL || current.Public().Webhook.HasSecret {
		t.Fatal("explicit empty value retained credentials")
	}
}

func TestNotificationUpdateIsAtomic(t *testing.T) {
	db, repo, service := notificationFixture(t)
	ctx := notificationContext(t)
	before, err := repo.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	err = service.SaveAllConfig(ctx, &protocol.NotificationConfigUpdate{
		SMTP:  &protocol.SMTPConfigUpdate{Host: configPtr("new.example")},
		WeCom: &protocol.WeComConfigUpdate{Enabled: configPtr(true)},
	})
	if !errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("expected validation failure: %v", err)
	}
	after, err := repo.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after.SMTPConfig != before.SMTPConfig {
		t.Fatal("earlier channel committed after validation failure")
	}
	if err := db.Exec(`CREATE TRIGGER fail_notification_update BEFORE UPDATE ON notification_config BEGIN SELECT RAISE(ABORT, 'write failed'); END`).Error; err != nil {
		t.Fatal(err)
	}
	err = service.SaveAllConfig(ctx, &protocol.NotificationConfigUpdate{SMTP: &protocol.SMTPConfigUpdate{Host: configPtr("new.example")}})
	if err == nil || errors.Is(err, ErrInvalidConfig) {
		t.Fatalf("write failure classified as input: %v", err)
	}
	after, err = repo.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if after.SMTPConfig != before.SMTPConfig {
		t.Fatal("failed write changed configuration")
	}
}

func TestRobotTestUsesStoredSignatureAndRequiresAcknowledgement(t *testing.T) {
	_, repo, service := notificationFixture(t)
	ctx := notificationContext(t)
	const secret = "saved-signature-key"
	responses := []string{`{"errcode":0}`, `{"errcode":310000,"errmsg":"private-token"}`, `{}`, `null`, `not json`}
	var requests atomic.Int32
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		index := int(requests.Add(1)) - 1
		q := r.URL.Query()
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(q.Get("timestamp") + "\n" + secret))
		if q.Get("timestamp") == "" || q.Get("sign") != base64.StdEncoding.EncodeToString(mac.Sum(nil)) {
			t.Error("missing or invalid saved signature")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(responses[index]))
	}))
	defer endpoint.Close()
	if err := service.SaveAllConfig(ctx, &protocol.NotificationConfigUpdate{DingTalk: &protocol.DingTalkConfigUpdate{Enabled: configPtr(true), WebhookURL: configPtr(endpoint.URL + "?token=private"), Secret: configPtr(secret)}}); err != nil {
		t.Fatal(err)
	}
	before, err := repo.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.TestDingTalkConnection(ctx, &protocol.DingTalkConfigUpdate{}); err != nil {
		t.Fatal(err)
	}
	for range responses[1:] {
		err := service.TestDingTalkConnection(ctx, &protocol.DingTalkConfigUpdate{})
		if !errors.Is(err, ErrConnectionTest) || strings.Contains(err.Error(), "private") {
			t.Fatalf("invalid/unsafe result: %v", err)
		}
	}
	after, err := repo.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 5 || after.DingTalkConfig != before.DingTalkConfig || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatal("connection test changed saved configuration")
	}
}

func TestNotificationSecretsRequireEncryptor(t *testing.T) {
	_, repo, _ := notificationFixture(t)
	ctx := notificationContext(t)
	service := NewService(repo, nil)
	err := service.SaveAllConfig(ctx, &protocol.NotificationConfigUpdate{WeCom: &protocol.WeComConfigUpdate{WebhookURL: configPtr("https://example.test/?secret=private")}})
	if err == nil {
		t.Fatal("saved secret without encryption")
	}
	row, err := repo.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(row.WeComConfig, "private") {
		t.Fatal("stored plaintext on encryption failure")
	}
}

type notificationAuthority struct {
	testutil.AccessPolicy
}

func (notificationAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func notificationContext(t *testing.T) context.Context {
	t.Helper()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}, time.Now().Add(time.Hour), notificationAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}

func TestNotificationActivityCountsChangedChannelsAndRollsBack(t *testing.T) {
	db, repo, service := notificationFixture(t)
	ctx := notificationContext(t)
	input := &protocol.NotificationConfigUpdate{
		SMTP:  &protocol.SMTPConfigUpdate{Password: configPtr("private-password")},
		WeCom: &protocol.WeComConfigUpdate{WebhookURL: configPtr("https://example.test/?secret=private")},
	}
	for range 2 {
		if err := service.SaveAllConfig(ctx, input); err != nil {
			t.Fatal(err)
		}
	}
	var facts []operationrecord.OperationRecord
	if err := db.Find(&facts).Error; err != nil || len(facts) != 1 {
		t.Fatalf("notification replay counted: %d %v", len(facts), err)
	}
	fact := facts[0]
	var detail struct {
		ChangedFields []string `json:"changed_fields"`
	}
	if err := json.Unmarshal([]byte(fact.DetailJSON), &detail); err != nil {
		t.Fatal(err)
	}
	if fact.Actor != access.Current(ctx).Actor() || fact.Action != "notification_settings_update" || !reflect.DeepEqual(detail.ChangedFields, []string{"smtp", "wecom"}) || strings.Contains(fact.DetailJSON, "private") {
		t.Fatalf("invalid notification activity: %+v", fact)
	}
	before, err := repo.Get(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TRIGGER reject_notification_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	input.SMTP.Password = configPtr("replacement-password")
	input.WeCom.WebhookURL = configPtr("https://other.test/?secret=replacement")
	if err := service.SaveAllConfig(ctx, input); err == nil || !strings.Contains(err.Error(), "activity unavailable") {
		t.Fatalf("expected activity rejection: %v", err)
	}
	after, err := repo.Get(ctx)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("notification channels not rolled back: %v", err)
	}
}
