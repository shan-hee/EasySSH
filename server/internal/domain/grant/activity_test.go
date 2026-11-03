package grant

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	servermodel "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/storage/schema"
	"github.com/easyssh/shared/protocol"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type activityAuthority struct {
	testutil.AccessPolicy
}

func (activityAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}

type activityCatalog struct{ *ResourceCatalog }

// Readiness has separate credential and host-trust checks; these tests cover
// local mutation atomicity without establishing an SSH connection.
func (activityCatalog) Ready(context.Context, *gorm.DB, uuid.UUID, bool) error { return nil }

func grantActivityFixture(t *testing.T) (*Service, context.Context, access.Scope, protocol.CreateGrantInput, uuid.UUID) {
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
	runtime := access.NewRuntime()
	t.Cleanup(runtime.Close)
	encryptor, err := crypto.NewEncryptor(base64.StdEncoding.EncodeToString(make([]byte, 32)))
	if err != nil {
		t.Fatal(err)
	}
	s := NewService(db, activityCatalog{NewResourceCatalog(nil)}, runtime, encryptor)
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}, time.Now().Add(time.Hour), activityAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := access.WithScope(context.Background(), scope)
	first, second := uuid.New(), uuid.New()
	for index, id := range []uuid.UUID{first, second} {
		row := servermodel.Server{ID: id, Name: []string{"first", "second"}[index], Host: "host.test", Port: 22, Username: "owner", Auth: servermodel.ServerAuth{AuthMethod: servermodel.AuthMethodPassword}}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := protocol.CreateGrantInput{Name: "share", LongLived: true, DefaultContent: "files", Resources: []protocol.GrantResourceInput{{ServerID: first, Actions: []protocol.Action{protocol.FilesList}}}}
	return s, ctx, scope, req, second
}

func grantActivitySession(t *testing.T, s *Service, g protocol.Grant, serverID uuid.UUID) (Session, access.Scope, *access.Lease) {
	t.Helper()
	now := time.Now().UTC()
	tokenHash := digest(uuid.NewString())
	row := Session{TokenHash: &tokenHash, ID: uuid.New(), GrantID: g.ID, GrantVersion: g.Version, ClientKind: "desktop", CreatedAt: now, LastSeenAt: now, ExpiresAt: now.Add(time.Hour)}
	if err := s.db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	scope, err := access.NewScope(actorOf(row), row.ExpiresAt, activityAuthority{})
	if err != nil {
		t.Fatal(err)
	}
	lease, err := s.runtime.Reserve(context.Background(), scope, access.Connection, 1, access.Requirement{Action: protocol.FilesList, ServerID: serverID.String()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lease.Close(nil) })
	return row, scope, lease
}

func TestGrantConfigurationActivityLifecycle(t *testing.T) {
	s, ctx, scope, req, second := grantActivityFixture(t)
	created, err := s.Create(ctx, scope, req)
	if err != nil {
		t.Fatal(err)
	}
	_, _, oldLease := grantActivitySession(t, s, created.Grant, req.Resources[0].ServerID)
	req.Name, req.Resources[0].ServerID = "renamed", second
	if err := s.Update(ctx, scope, created.Grant.ID, created.Grant.Version, req); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(context.Cause(oldLease.Context()), access.ErrRevoked) {
		t.Fatal("committed update did not close the old session")
	}
	if err := s.Update(ctx, scope, created.Grant.ID, created.Grant.Version, req); err == nil {
		t.Fatal("stale version accepted")
	}
	if err := s.db.Model(&servermodel.Server{}).Where("id=?", second).UpdateColumn("connection_revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := s.ConfirmResource(ctx, scope, created.Grant.ID, second, 2); err != nil {
			t.Fatal(err)
		}
	}
	rotated, err := s.RotateSecret(ctx, scope, created.Grant.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range []*protocol.GrantCreated{created, rotated} {
		path, secret, ok := strings.Cut(result.Link, "#")
		if !ok || path != "/share/"+result.Grant.PublicID || secret == "" {
			t.Fatal("share creation and rotation must return a relative link with its secret")
		}
	}
	ended, _, endedLease := grantActivitySession(t, s, rotated.Grant, second)
	for range 2 {
		if err := s.EndSession(ctx, scope, ended.ID); err != nil {
			t.Fatal(err)
		}
	}
	if !errors.Is(context.Cause(endedLease.Context()), access.ErrRevoked) {
		t.Fatal("committed session end did not close its connection")
	}
	visitor, visitorScope, _ := grantActivitySession(t, s, rotated.Grant, second)
	if err := s.EndSession(context.Background(), visitorScope, visitor.ID); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := s.Revoke(ctx, scope, created.Grant.ID); err != nil {
			t.Fatal(err)
		}
	}
	var facts []operationrecord.OperationRecord
	if err := s.db.Find(&facts).Error; err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"grant_create": 1, "grant_update": 1, "grant_confirm_resource": 1, "grant_rotate_secret": 1, "grant_end_session": 1, "grant_revoke": 1}
	got := map[string]int{}
	for _, fact := range facts {
		got[fact.Action]++
		if fact.Actor != scope.Actor() || fact.Source != "manual" || fact.Status != operationrecord.StatusSuccess || fact.TotalCount != 1 {
			t.Fatalf("wrong activity attribution: %+v", fact)
		}
		if strings.Contains(fact.DetailJSON, strings.Split(created.Link, "#")[1]) || strings.Contains(fact.DetailJSON, strings.Split(rotated.Link, "#")[1]) {
			t.Fatal("share secret copied into activity")
		}
		var resources []operationrecord.Resource
		if err := s.db.Where("record_id=?", fact.ID).Order("name").Find(&resources).Error; err != nil {
			t.Fatal(err)
		}
		if fact.Action == "grant_update" {
			if len(resources) != 2 || resources[0].Name != "first" || resources[1].Name != "second" {
				t.Fatalf("removed grant resource lost snapshot: %+v", resources)
			}
		} else if len(resources) != 1 {
			t.Fatalf("wrong resource association: %+v", resources)
		}
		if fact.Action == "grant_end_session" {
			var detail struct {
				ResourceKind string `json:"resource_kind"`
				ResourceID   string `json:"resource_id"`
			}
			if err := json.Unmarshal([]byte(fact.DetailJSON), &detail); err != nil || detail.ResourceKind != "access_session" || detail.ResourceID != ended.ID.String() {
				t.Fatalf("ended session identity lost: %+v %v", detail, err)
			}
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("wrong activity count: got %v want %v", got, want)
	}
}

func TestGrantActivityFailureRollsBackAndPreservesLiveConnections(t *testing.T) {
	for _, operation := range []string{"create", "update", "revoke", "rotate", "confirm", "end_session"} {
		t.Run(operation, func(t *testing.T) {
			s, ctx, scope, req, second := grantActivityFixture(t)
			created, err := s.Create(ctx, scope, req)
			if err != nil {
				t.Fatal(err)
			}
			session, _, lease := grantActivitySession(t, s, created.Grant, req.Resources[0].ServerID)
			if err := s.db.Model(&servermodel.Server{}).Where("id=?", req.Resources[0].ServerID).UpdateColumn("connection_revision", 2).Error; err != nil {
				t.Fatal(err)
			}
			var before Grant
			if err := s.db.First(&before, "id=?", created.Grant.ID).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.db.Exec(`CREATE TRIGGER reject_grant_activity BEFORE INSERT ON operation_records BEGIN SELECT RAISE(ABORT,'activity unavailable'); END`).Error; err != nil {
				t.Fatal(err)
			}
			switch operation {
			case "create":
				_, err = s.Create(ctx, scope, req)
			case "update":
				req.Resources[0].ServerID = second
				err = s.Update(ctx, scope, before.ID, before.Version, req)
			case "revoke":
				err = s.Revoke(ctx, scope, before.ID)
			case "rotate":
				_, err = s.RotateSecret(ctx, scope, before.ID)
			case "confirm":
				err = s.ConfirmResource(ctx, scope, before.ID, req.Resources[0].ServerID, 2)
			case "end_session":
				err = s.EndSession(ctx, scope, session.ID)
			}
			if err == nil || !strings.Contains(err.Error(), "activity unavailable") {
				t.Fatalf("expected activity write rejection: %v", err)
			}
			if lease.Context().Err() != nil {
				t.Fatal("failed mutation closed an existing connection")
			}
			var after Grant
			if err := s.db.First(&after, "id=?", before.ID).Error; err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("grant mutation not rolled back: %v", err)
			}
			var stored Session
			if err := s.db.First(&stored, "id=?", session.ID).Error; err != nil || stored.RevokedAt != nil {
				t.Fatalf("session revocation not rolled back: %v", err)
			}
			var resources []Resource
			if err := s.db.Where("grant_id=?", before.ID).Find(&resources).Error; err != nil || len(resources) != 1 || resources[0].ServerID == second || resources[0].ApprovedConnectionRevision != 1 {
				t.Fatalf("grant resources not rolled back: %+v %v", resources, err)
			}
			for _, table := range []string{"grants", "operation_records"} {
				var count int64
				if err := s.db.Table(table).Count(&count).Error; err != nil || count != 1 {
					t.Fatalf("partial creation in %s: %d %v", table, count, err)
				}
			}
		})
	}
}
