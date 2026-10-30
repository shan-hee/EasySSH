package security

import (
	"context"
	"encoding/json"
	"github.com/easyssh/server/internal/testutil"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type settingsAuthority struct {
	testutil.AccessPolicy
}

func (settingsAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func settingsContext(t *testing.T) context.Context {
	t.Helper()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}, time.Now().Add(time.Hour), settingsAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}

func TestSettingsActivityAtomicityAndFieldScope(t *testing.T) {
	for _, item := range []struct {
		name, field string
		save        func(Repository, context.Context, *SecurityConfig) error
		change      func(*SecurityConfig)
	}{
		{"workspace", "hibernate", func(r Repository, ctx context.Context, config *SecurityConfig) error {
			return r.SaveWorkspace(ctx, config)
		}, func(config *SecurityConfig) { config.Hibernate = false }},
		{"login_session", "remember_login", func(r Repository, ctx context.Context, config *SecurityConfig) error {
			return r.SaveLoginSession(ctx, config)
		}, func(config *SecurityConfig) { config.RememberLogin = false }},
		{"login_security", "login_limit", func(r Repository, ctx context.Context, config *SecurityConfig) error {
			return r.SaveLoginSecurity(ctx, config)
		}, func(config *SecurityConfig) { config.LoginLimit = 9 }},
		{"web_security", "cookie_domain", func(r Repository, ctx context.Context, config *SecurityConfig) error {
			return r.SaveWebSecurity(ctx, config)
		}, func(config *SecurityConfig) { config.CookieDomain = "example.test" }},
		{"cors", "cors_config", func(r Repository, ctx context.Context, config *SecurityConfig) error { return r.SaveCORS(ctx, config) }, func(config *SecurityConfig) { config.CORSConfig = `{"allowed_origins":["https://example.test"]}` }},
		{"access_control", "blocklist_ips", func(r Repository, ctx context.Context, config *SecurityConfig) error {
			return r.SaveAccessControl(ctx, config)
		}, func(config *SecurityConfig) { config.BlocklistIPs = "192.0.2.1" }},
	} {
		t.Run(item.name, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			raw, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			raw.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = raw.Close() })
			if err := db.AutoMigrate(&SecurityConfig{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
				t.Fatal(err)
			}
			repo, ctx := NewRepository(db), settingsContext(t)
			before, err := repo.Get(ctx)
			if err != nil {
				t.Fatal(err)
			}
			change := *before
			item.change(&change)
			if err := db.Exec(`CREATE TRIGGER reject_settings_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
				t.Fatal(err)
			}
			if err := item.save(repo, ctx, &change); err == nil || !strings.Contains(err.Error(), "activity unavailable") {
				t.Fatalf("expected activity rejection: %v", err)
			}
			unchanged, err := repo.Get(ctx)
			if err != nil || !reflect.DeepEqual(before, unchanged) {
				t.Fatalf("configuration not rolled back: %v", err)
			}
			if err := db.Exec("DROP TRIGGER reject_settings_activity").Error; err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err := item.save(repo, ctx, &change); err != nil {
					t.Fatal(err)
				}
			}
			var facts []operationrecord.OperationRecord
			if err := db.Find(&facts).Error; err != nil || len(facts) != 1 {
				t.Fatalf("settings replay counted: %d %v", len(facts), err)
			}
			fact := facts[0]
			var detail struct {
				ResourceKind  string   `json:"resource_kind"`
				ChangedFields []string `json:"changed_fields"`
			}
			if err := json.Unmarshal([]byte(fact.DetailJSON), &detail); err != nil {
				t.Fatal(err)
			}
			if fact.Actor != access.Current(ctx).Actor() || fact.Action != "security_settings_update" || fact.Source != "manual" || detail.ResourceKind != "security_config" || !reflect.DeepEqual(detail.ChangedFields, []string{item.field}) {
				t.Fatalf("wrong settings activity: %+v", fact)
			}
			if strings.Contains(fact.DetailJSON, "example.test") || strings.Contains(fact.DetailJSON, "192.0.2.1") || strings.Contains(fact.DetailJSON, "Renamed") {
				t.Fatal("settings values copied into activity")
			}
		})
	}
}
