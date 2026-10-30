package runtime

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Artifacts are stored once, outside the private execution JSON. The caller
// holds the session transaction and content storage lock through commit.
func saveSessionArtifact(tx *gorm.DB, bodies *content.Service, sessionID string, actor protocol.Actor, taskID string, file *aiworkspace.FileArtifact) error {
	var row AISessionTaskRecord
	if err := tx.Select("artifact_content_id").Where("session_id=? AND item_id=?", sessionID, taskID).Take(&row).Error; err != nil {
		return err
	}
	var id *uuid.UUID
	if file != nil {
		raw, err := json.Marshal(file)
		if err != nil {
			return err
		}
		if row.ArtifactContentID != nil {
			ref, err := bodies.AIItemReference(tx, sessionID, actor, *row.ArtifactContentID)
			if err != nil {
				return err
			}
			if ref.Sha256 == aiworkspace.Hash(string(raw)) && ref.Size == int64(len(raw)) {
				return nil
			}
		}
		created, err := bodies.PutAIItem(tx, sessionID, actor, raw)
		if err != nil {
			return err
		}
		id = &created
	} else if row.ArtifactContentID == nil {
		return nil
	}
	return tx.Model(&AISessionTaskRecord{}).Where("session_id=? AND item_id=?", sessionID, taskID).Update("artifact_content_id", id).Error
}

func (s *gormSessionStore) TaskFile(ctx context.Context, actor protocol.Actor, sessionID, taskID string) (protocol.ContentReference, error) {
	var ref protocol.ContentReference
	err := s.transaction(ctx, func(tx *gorm.DB) error {
		var session AISessionRecord
		if err := conversationQuery(tx, actor).Select("id,actor_kind,actor_id,actor_session_id,actor_grant_id").Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND status<>?", sessionID, SessionStatusClosed).Take(&session).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrSessionNotFound
			}
			return err
		}
		var task AISessionTaskRecord
		if err := tx.Select("artifact_content_id").Where("session_id=? AND item_id=?", sessionID, taskID).Take(&task).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTaskNotFound
			}
			return err
		}
		if task.ArtifactContentID == nil {
			return ErrTaskNotFound
		}
		var err error
		ref, err = s.bodies.AIItemReference(tx, sessionID, session.Actor, *task.ArtifactContentID)
		return err
	})
	return ref, err
}
