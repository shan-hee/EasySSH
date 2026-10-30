package content

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// WithStorage covers the complete host transaction, including commit. Cleanup
// and backup cannot remove or copy a new file before its reference commits.
func (s *Service) WithStorage(fn func() error) error {
	s.storage.RLock()
	defer s.storage.RUnlock()
	return fn()
}

// PutAIItem stores a session body. Public reads additionally require a current
// message, public tool projection or artifact reference; private/model rows never suffice.
// The caller holds WithStorage for its transaction. A rollback leaves an unreferenced file that
// the existing cleanup pass removes; it never requires replaying model/tools.
func (s *Service) PutAIItem(tx *gorm.DB, sessionID string, actor protocol.Actor, raw []byte) (uuid.UUID, error) {
	id, err := uuid.Parse(sessionID)
	if err != nil || id == uuid.Nil || !actor.Valid() {
		return uuid.Nil, contentstore.ErrQuery
	}
	var count int64
	if err := tx.Table("ai_sessions").Where("id=? AND actor_kind=? AND actor_id=? AND actor_session_id=? AND actor_grant_id=? AND deleted_at IS NULL", id, actor.Kind, actor.ID, actor.SessionID, actor.GrantID).Count(&count).Error; err != nil {
		return uuid.Nil, err
	}
	if count != 1 {
		return uuid.Nil, ErrNotFound
	}
	ref, err := s.putJSON(tx, Record{Actor: actor, SourceType: "ai_session", SourceID: id, Action: protocol.AIUse}, raw)
	return ref.ID, err
}

// putJSON writes once and records its immutable metadata in the caller's transaction.
// The caller holds WithStorage through commit.
func (s *Service) putJSON(tx *gorm.DB, row Record, raw []byte) (protocol.ContentReference, error) {
	return s.putBytes(tx, row, raw, "application/json")
}

func (s *Service) putBytes(tx *gorm.DB, row Record, raw []byte, media string) (protocol.ContentReference, error) {
	writer, err := s.files.Create(uuid.New(), media)
	if err != nil {
		return protocol.ContentReference{}, err
	}
	_, writeErr := writer.Write(raw)
	ref, finishErr := writer.Finish()
	if writeErr != nil {
		return protocol.ContentReference{}, writeErr
	}
	if finishErr != nil {
		return protocol.ContentReference{}, finishErr
	}
	row.ID, row.MediaType, row.Size, row.SHA256, row.Ready = ref.ID, ref.MediaType, ref.Size, ref.Sha256, true
	if err := tx.Create(&row).Error; err != nil {
		return protocol.ContentReference{}, err
	}
	return ref, nil
}

// AIItemReference reads metadata selected by trusted host code from an authorized
// session item. It does not read or decode the body. Only public projection
// columns may be used when the returned reference will be sent to a client.
func (s *Service) AIItemReference(tx *gorm.DB, sessionID string, actor protocol.Actor, id uuid.UUID) (protocol.ContentReference, error) {
	var row Record
	if err := tx.First(&row, "id=? AND source_type=? AND source_id=?", id, "ai_session", sessionID).Error; err != nil {
		return protocol.ContentReference{}, err
	}
	if !sameAIActor(row.Actor, actor) || !row.Ready {
		return protocol.ContentReference{}, contentstore.ErrChanged
	}
	ref := row.reference()
	if err := contentstore.ValidateReference(ref); err != nil {
		return protocol.ContentReference{}, err
	}
	return ref, nil
}

func sameAIActor(a, b protocol.Actor) bool {
	if !a.Valid() || !b.Valid() {
		return false
	}
	if a.Kind == protocol.Owner && b.Kind == protocol.Owner {
		return a.ID == b.ID
	}
	return a == b
}

// LoadAIItem accepts only a reference selected from an authorized session item.
func (s *Service) LoadAIItem(tx *gorm.DB, sessionID string, actor protocol.Actor, id uuid.UUID, hash string) ([]byte, error) {
	ref, err := s.AIItemReference(tx, sessionID, actor, id)
	if err != nil {
		return nil, err
	}
	if ref.Sha256 != hash {
		return nil, contentstore.ErrChanged
	}
	return s.files.Load(ref)
}

// checkAIHistory requires both current AI authority and an existing public
// reference. Knowing a body ID, owning the server, or retaining an old version
// cannot expose another visitor's conversation or a private execution payload.
func (s *Service) checkAIHistory(ctx context.Context, row Record) error {
	actor, err := access.RequireAIActor(ctx)
	if err != nil {
		return err
	}
	if !sameAIActor(row.Actor, actor) {
		return ErrNotFound
	}
	var session struct {
		Actor protocol.Actor `gorm:"embedded;embeddedPrefix:actor_"`
	}
	db := s.db.WithContext(ctx)
	if err := db.Table("ai_sessions").Select("actor_kind,actor_id,actor_session_id,actor_grant_id").Where("id=? AND deleted_at IS NULL AND status<>?", row.SourceID, "closed").Take(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		return err
	}
	if !sameAIActor(session.Actor, actor) {
		return ErrNotFound
	}
	var count int64
	if err := db.Table("ai_messages").Where("session_id=? AND content_id=?", row.SourceID, row.ID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		if err := db.Table("ai_session_tasks").Where("session_id=? AND (public_content_id=? OR artifact_content_id=?)", row.SourceID, row.ID, row.ID).Count(&count).Error; err != nil {
			return err
		}
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}
