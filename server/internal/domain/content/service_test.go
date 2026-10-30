package content

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/protocol"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type contentAuthority struct {
	testutil.AccessPolicy
	revoked, aiDenied bool
}

func (a *contentAuthority) Authorize(_ context.Context, _ protocol.Actor, requirement access.Requirement) error {
	if a.aiDenied && requirement.Action == protocol.AIUse {
		return access.ErrForbidden
	}
	if a.revoked {
		return access.ErrRevoked
	}
	return nil
}
func (a *contentAuthority) ServerIDs(context.Context, protocol.Actor) ([]string, error) {
	return []string{"test-server"}, nil
}
func contentFixture(t *testing.T) (*Service, *gorm.DB, string, protocol.Actor, *contentAuthority) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	if err := db.AutoMigrate(&Record{}, &taskcenter.NotificationDelivery{}, &taskcenter.TaskRun{}, &taskcenter.TaskEvent{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}); err != nil {
		t.Fatal(err)
	}
	// Content deliberately does not import the AI runtime. These rows model
	// only its reference/ownership boundary for storage lifecycle tests.
	for _, statement := range []string{
		`CREATE TABLE servers(id TEXT PRIMARY KEY,deleted_at DATETIME)`,
		`CREATE TABLE ai_sessions(id TEXT PRIMARY KEY,actor_kind TEXT,actor_id TEXT,actor_session_id TEXT,actor_grant_id TEXT,deleted_at DATETIME,status TEXT NOT NULL DEFAULT 'idle')`,
		`CREATE TABLE ai_messages(session_id TEXT,content_id TEXT)`,
		`CREATE TABLE ai_model_messages(content_id TEXT)`,
		`CREATE TABLE ai_session_tasks(session_id TEXT,content_id TEXT,public_content_id TEXT,artifact_content_id TEXT)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	directory := t.TempDir()
	s, err := New(db, directory)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	sessionID := uuid.NewString()
	actor := protocol.Actor{Kind: protocol.Visitor, ID: sessionID, SessionID: sessionID, GrantID: uuid.NewString()}
	return s, db, directory, actor, &contentAuthority{}
}
func contentContext(t *testing.T, actor protocol.Actor, authority *contentAuthority) context.Context {
	t.Helper()
	scope, err := access.NewScope(actor, time.Now().Add(time.Hour), authority)
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}
func TestContentAuthoritySourceRetentionAndRecovery(t *testing.T) {
	s, db, directory, actor, authority := contentFixture(t)
	ctx := contentContext(t, actor, authority)
	serverID := uuid.New()
	run := taskcenter.TaskRun{ID: uuid.New(), Actor: actor, ServerID: &serverID, SourceType: "sftp_delete", SourceID: uuid.NewString(), TaskType: "sftp_recursive_delete", Status: taskcenter.StatusRunning}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	writer, release, err := s.BeginTask(ctx, run.ID, run, protocol.FilesDelete, "application/x-ndjson")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.SnapshotStorage(func() error { t.Fatal("captured active writer"); return nil }); err == nil {
		t.Fatal("backup accepted active writer")
	}
	if _, err := writer.Write([]byte("{\"outcome\":\"removed\"}\n")); err != nil {
		t.Fatal(err)
	}
	ref, err := writer.Finish()
	release()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reference(ctx, ref.ID); !errors.Is(err, ErrNotReady) {
		t.Fatalf("unsealed body served: %v", err)
	}
	// Simulate interruption after the file was flushed but before metadata sealed.
	if err := s.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	got, err := s.Reference(ctx, ref.ID)
	if err != nil || got != ref {
		t.Fatalf("recovery lost data: %+v %v", got, err)
	}
	other := actor
	other.SessionID = uuid.NewString()
	other.ID = other.SessionID
	if _, err := s.Reference(contentContext(t, other, authority), ref.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign actor read body: %v", err)
	}
	authority.revoked = true
	if _, err := s.Reference(ctx, ref.ID); !errors.Is(err, access.ErrRevoked) {
		t.Fatalf("revoked actor read body: %v", err)
	}
	authority.revoked = false
	if err := db.Delete(&taskcenter.TaskRun{}, "id=?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reference(ctx, ref.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted source still readable: %v", err)
	}
	orphan, err := s.files.Create(uuid.New(), "text/plain")
	if err != nil {
		t.Fatal(err)
	}
	orphanRef, err := orphan.Finish()
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	for _, id := range []uuid.UUID{ref.ID, orphanRef.ID} {
		if _, err := os.Stat(filepath.Join(directory, "content", id.String()+".body")); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("retained orphan: %s %v", id, err)
		}
	}
	var count int64
	if err := db.Model(&Record{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("metadata retained: %d %v", count, err)
	}
}
