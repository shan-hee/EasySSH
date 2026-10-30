package content

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestPublicAIContentFollowsConversationAndCurrentPermission(t *testing.T) {
	s, db, _, visitor, authority := contentFixture(t)
	sessionID := uuid.NewString()
	if err := db.Exec(`INSERT INTO ai_sessions(id,actor_kind,actor_id,actor_session_id,actor_grant_id) VALUES(?,?,?,?,?)`, sessionID, visitor.Kind, visitor.ID, visitor.SessionID, visitor.GrantID).Error; err != nil {
		t.Fatal(err)
	}
	var id uuid.UUID
	if err := s.WithStorage(func() error {
		return db.Transaction(func(tx *gorm.DB) error {
			var err error
			id, err = s.PutAIItem(tx, sessionID, visitor, []byte(`{"id":"message","content":"public reply"}`))
			if err != nil {
				return err
			}
			return tx.Exec(`INSERT INTO ai_messages(session_id,content_id) VALUES(?,?)`, sessionID, id).Error
		})
	}); err != nil {
		t.Fatal(err)
	}
	ctx := contentContext(t, visitor, authority)
	if _, err := s.Reference(ctx, id); err != nil {
		t.Fatal(err)
	}
	owner := protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}
	if _, err := s.Reference(contentContext(t, owner, authority), id); !errors.Is(err, ErrNotFound) {
		t.Fatal("owner read a visitor's private conversation", err)
	}
	other := visitor
	other.SessionID = uuid.NewString()
	other.ID = other.SessionID
	if _, err := s.Reference(contentContext(t, other, authority), id); !errors.Is(err, ErrNotFound) {
		t.Fatal("another session of the same grant read conversation", err)
	}
	authority.aiDenied = true
	if _, err := s.Reference(ctx, id); !errors.Is(err, access.ErrForbidden) {
		t.Fatal("history remained readable after AI permission removal", err)
	}
	authority.aiDenied = false
	if err := db.Exec(`UPDATE ai_sessions SET status='closed' WHERE id=?`, sessionID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reference(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Fatal("closed history remained readable", err)
	}
	if err := db.Exec(`UPDATE ai_sessions SET status='idle' WHERE id=?`, sessionID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`DELETE FROM ai_messages WHERE session_id=?`, sessionID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reference(ctx, id); !errors.Is(err, ErrNotFound) {
		t.Fatal("detached public reference remained readable", err)
	}
}

func TestPrivateAIContentIntegrityAndPublicReadBoundary(t *testing.T) {
	s, db, directory, actor, authority := contentFixture(t)
	sessionID := uuid.NewString()
	if err := db.Exec(`INSERT INTO ai_sessions(id,actor_kind,actor_id,actor_session_id,actor_grant_id) VALUES(?,?,?,?,?)`, sessionID, actor.Kind, actor.ID, actor.SessionID, actor.GrantID).Error; err != nil {
		t.Fatal(err)
	}
	var id uuid.UUID
	raw := []byte(`{"private_model_context":"secret"}`)
	if err := s.WithStorage(func() error {
		return db.Transaction(func(tx *gorm.DB) error {
			var err error
			id, err = s.PutAIItem(tx, sessionID, actor, raw)
			if err != nil {
				return err
			}
			return tx.Exec(`INSERT INTO ai_model_messages(content_id) VALUES(?)`, id).Error
		})
	}); err != nil {
		t.Fatal(err)
	}
	var record Record
	if err := db.First(&record, "id=?", id).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.Reference(contentContext(t, actor, authority), id); !errors.Is(err, ErrNotFound) {
		t.Fatal("private model file exposed by public content endpoint", err)
	}
	if err := s.WithStorage(func() error {
		loaded, err := s.LoadAIItem(db, sessionID, actor, id, record.SHA256)
		if err != nil {
			return err
		}
		if string(loaded) != string(raw) {
			t.Fatal("body changed")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.Cleanup(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "content", id.String()+".body"), make([]byte, len(raw)), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.WithStorage(func() error {
		_, err := s.LoadAIItem(db, sessionID, actor, id, record.SHA256)
		return err
	}); !errors.Is(err, contentstore.ErrChanged) {
		t.Fatal("corrupt body accepted", err)
	}
}

func TestRolledBackAIFileCannotRaceBackupAndIsCollected(t *testing.T) {
	s, db, _, actor, _ := contentFixture(t)
	sessionID := uuid.NewString()
	if err := db.Exec(`INSERT INTO ai_sessions(id,actor_kind,actor_id,actor_session_id,actor_grant_id) VALUES(?,?,?,?,?)`, sessionID, actor.Kind, actor.ID, actor.SessionID, actor.GrantID).Error; err != nil {
		t.Fatal(err)
	}
	failure := errors.New("rollback")
	err := s.WithStorage(func() error {
		return db.Transaction(func(tx *gorm.DB) error {
			if _, err := s.PutAIItem(tx, sessionID, actor, []byte(`{"content":"new"}`)); err != nil {
				return err
			}
			if err := s.SnapshotStorage(func() error { t.Fatal("backup entered uncommitted storage"); return nil }); err == nil {
				t.Fatal("backup did not exclude uncommitted body")
			}
			return failure
		})
	})
	if !errors.Is(err, failure) {
		t.Fatal(err)
	}
	files := 0
	if err := s.files.Scan(func(ids []uuid.UUID) error { files += len(ids); return nil }); err != nil || files != 1 {
		t.Fatal("rollback fixture did not leave an orphan", files, err)
	}
	if err := s.Cleanup(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := s.files.Scan(func(ids []uuid.UUID) error {
		if len(ids) != 0 {
			t.Fatal("orphan survived cleanup")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
