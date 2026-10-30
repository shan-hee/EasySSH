package auth

import (
	"context"
	"encoding/base64"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/storage/schema"
	"github.com/easyssh/shared/protocol"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/pquerna/otp/totp"
	"gorm.io/gorm"
)

const activityPassword = "Owner-Activity-Password9"

func ownerActivityFixture(t *testing.T) (*Service, context.Context, Owner, Session, *access.Lease) {
	t.Helper()
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
	if err := schema.Initialize(context.Background(), raw, "sqlite"); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("PRAGMA foreign_keys=ON").Error; err != nil {
		t.Fatal(err)
	}
	encryptor, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	runtime := access.NewRuntime()
	t.Cleanup(runtime.Close)
	s, err := NewService(db, encryptor, runtime)
	if err != nil {
		t.Fatal(err)
	}
	owner := Owner{ID: uuid.New(), Username: "owner", Email: "owner@example.test"}
	if err := owner.SetPassword(activityPassword); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	makeSession := func() (Session, access.Scope) {
		t.Helper()
		row := Session{ID: uuid.New(), OwnerID: owner.ID, TokenHash: ownerDigest(uuid.NewString()), CSRFHash: ownerDigest(uuid.NewString()), ExpiresAt: time.Now().UTC().Add(time.Hour)}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: owner.ID.String(), SessionID: row.ID.String()}, row.ExpiresAt, s)
		if err != nil {
			t.Fatal(err)
		}
		return row, scope
	}
	_, currentScope := makeSession()
	other, otherScope := makeSession()
	lease, err := runtime.Reserve(context.Background(), otherScope, access.Connection, 0, access.Requirement{Action: protocol.TerminalConnect, ServerID: uuid.NewString()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lease.Close(nil) })
	return s, access.WithScope(context.Background(), currentScope), owner, other, lease
}

func TestOwnerConfigurationActivityRollbackAndAttribution(t *testing.T) {
	for _, operation := range []string{"profile", "notification", "monitor", "password", "session", "other_sessions", "host_recovery"} {
		t.Run(operation, func(t *testing.T) {
			s, ctx, owner, other, lease := ownerActivityFixture(t)
			var before Owner
			if err := s.db.First(&before, "id=?", owner.ID).Error; err != nil {
				t.Fatal(err)
			}
			apply := func() error {
				switch operation {
				case "profile":
					return s.UpdateProfile(ctx, owner.ID, "renamed", owner.Email, "", "zh-CN", "Asia/Shanghai")
				case "notification":
					return s.UpdateNotificationSettings(ctx, owner.ID, map[string]bool{"notify_task_success": false, "notify_task_external": true})
				case "monitor":
					endpoint, token := "https://monitor.example.test", "private-monitor-token"
					return s.UpdateMonitorDataSource(ctx, owner.ID, protocol.OwnerMonitorInput{Source: "nezha", Endpoint: &endpoint, Token: &token, SetActive: true})
				case "password":
					return s.ChangePassword(ctx, owner.ID, activityPassword, "Replacement-Password9")
				case "session":
					return s.RevokeSession(ctx, owner.ID, other.ID)
				case "other_sessions":
					return s.RevokeAllOtherSessions(ctx, owner.ID, uuid.MustParse(access.Current(ctx).Actor().SessionID))
				case "host_recovery":
					return s.RecoverFromHost(context.Background(), "Recovered-Password9", true)
				}
				return errors.New("unknown operation")
			}
			if err := s.db.Exec(`CREATE TRIGGER reject_owner_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
				t.Fatal(err)
			}
			if err := apply(); err == nil || !strings.Contains(err.Error(), "activity unavailable") {
				t.Fatalf("expected activity rejection: %v", err)
			}
			var unchanged Owner
			if err := s.db.First(&unchanged, "id=?", owner.ID).Error; err != nil || !reflect.DeepEqual(before, unchanged) {
				t.Fatalf("owner mutation not rolled back: %v", err)
			}
			var session Session
			if err := s.db.First(&session, "id=?", other.ID).Error; err != nil || session.RevokedAt != nil || lease.Context().Err() != nil {
				t.Fatalf("failed mutation revoked live session: %v", err)
			}
			if err := s.db.Exec("DROP TRIGGER reject_owner_activity").Error; err != nil {
				t.Fatal(err)
			}
			if err := apply(); err != nil {
				t.Fatal(err)
			}
			security := operation == "password" || operation == "session" || operation == "other_sessions" || operation == "host_recovery"
			if security && !errors.Is(context.Cause(lease.Context()), access.ErrRevoked) {
				t.Fatal("committed security mutation did not close the old connection")
			}
			if operation == "profile" || operation == "notification" || operation == "monitor" || operation == "session" || operation == "other_sessions" {
				if err := apply(); err != nil {
					t.Fatal(err)
				}
			}
			var facts []operationrecord.OperationRecord
			if err := s.db.Find(&facts).Error; err != nil || len(facts) != 1 {
				t.Fatalf("owner replay counted: %d %v", len(facts), err)
			}
			fact := facts[0]
			want := access.Current(ctx).Actor()
			if operation == "host_recovery" {
				want.SessionID = ""
			}
			if fact.Actor != want || fact.Source != "manual" || fact.TotalCount != 1 {
				t.Fatalf("owner attribution lost: %+v", fact)
			}
			if security && fact.Action != "security_update" || !security && fact.Action != "profile_update" {
				t.Fatalf("wrong owner activity action: %s", fact.Action)
			}
			for _, secret := range []string{activityPassword, "Replacement-Password9", "Recovered-Password9", "private-monitor-token", "monitor.example.test"} {
				if strings.Contains(fact.DetailJSON, secret) {
					t.Fatal("owner values copied into activity")
				}
			}
		})
	}
}

func TestEnable2FACommitsCodesSessionRevocationAndActivityTogether(t *testing.T) {
	for _, failure := range []string{"activity", "session"} {
		t.Run(failure, func(t *testing.T) {
			s, ctx, owner, other, lease := ownerActivityFixture(t)
			secret, _, err := s.Generate2FASecret(ctx, owner.ID, activityPassword)
			if err != nil {
				t.Fatal(err)
			}
			code, err := totp.GenerateCode(secret, time.Now().UTC())
			if err != nil {
				t.Fatal(err)
			}
			trigger := `CREATE TRIGGER reject_enable BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'enable failed'); END`
			if failure == "session" {
				trigger = `CREATE TRIGGER reject_enable BEFORE UPDATE ON owner_sessions BEGIN SELECT RAISE(ABORT,'enable failed'); END`
			}
			if err := s.db.Exec(trigger).Error; err != nil {
				t.Fatal(err)
			}
			if codes, err := s.Enable2FA(ctx, owner.ID, code); err == nil || !strings.Contains(err.Error(), "enable failed") || len(codes) != 0 {
				t.Fatalf("failed enable returned codes or wrong error: %v", err)
			}
			var unchanged Owner
			if err := s.db.First(&unchanged, "id=?", owner.ID).Error; err != nil || unchanged.TwoFactorEnabled || unchanged.BackupCodes != "" || unchanged.PendingTwoFactorSecret == "" {
				t.Fatalf("partial 2FA enable: %v", err)
			}
			var counters int64
			if err := s.db.Model(&TOTPReplay{}).Count(&counters).Error; err != nil || counters != 0 {
				t.Fatalf("failed enable consumed TOTP: %d %v", counters, err)
			}
			var stored Session
			if err := s.db.First(&stored, "id=?", other.ID).Error; err != nil || stored.RevokedAt != nil || lease.Context().Err() != nil {
				t.Fatalf("failed enable revoked session: %v", err)
			}
			if err := s.db.Exec("DROP TRIGGER reject_enable").Error; err != nil {
				t.Fatal(err)
			}
			code, err = totp.GenerateCode(secret, time.Now().UTC())
			if err != nil {
				t.Fatal(err)
			}
			codes, err := s.Enable2FA(ctx, owner.ID, code)
			if err != nil || len(codes) == 0 {
				t.Fatalf("enable failed: %v", err)
			}
			if !errors.Is(context.Cause(lease.Context()), access.ErrRevoked) {
				t.Fatal("enable did not close other session")
			}
			if err := s.requireOwner(ctx, owner.ID); err != nil {
				t.Fatalf("enable revoked current session: %v", err)
			}
			if err := s.db.Exec(`CREATE TRIGGER reject_disable BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'disable failed'); END`).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.Disable2FA(ctx, owner.ID, codes[0]); err == nil || !strings.Contains(err.Error(), "disable failed") {
				t.Fatalf("expected disable rollback: %v", err)
			}
			if err := s.db.Exec("DROP TRIGGER reject_disable").Error; err != nil {
				t.Fatal(err)
			}
			// A backup code consumed by a rolled-back disable must remain usable.
			if err := s.Disable2FA(ctx, owner.ID, codes[0]); err != nil {
				t.Fatal(err)
			}
			var facts []operationrecord.OperationRecord
			if err := s.db.Find(&facts).Error; err != nil || len(facts) != 2 {
				t.Fatalf("2FA operation double counted: %d %v", len(facts), err)
			}
			for _, fact := range facts {
				if fact.Action != "security_update" || strings.Contains(fact.DetailJSON, secret) || strings.Contains(fact.DetailJSON, codes[0]) {
					t.Fatal("invalid 2FA activity")
				}
			}
		})
	}
}

func TestOwnerLogoutDoesNotCountAsConfiguration(t *testing.T) {
	s, ctx, owner, _, _ := ownerActivityFixture(t)
	if err := s.Logout(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := s.db.Model(&operationrecord.OperationRecord{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("logout counted as configuration: %d %v", count, err)
	}
	if err := s.requireOwner(ctx, owner.ID); !errors.Is(err, access.ErrUnauthenticated) {
		t.Fatalf("logout did not revoke session: %v", err)
	}
}
