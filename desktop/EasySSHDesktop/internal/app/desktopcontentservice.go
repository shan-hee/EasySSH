package app

import (
	"context"
	"database/sql"

	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

// Local-owner bindings only. Remote windows may call only their explicitly
// allowed DesktopRemoteWorkspaceService bindings, never this local database.
type DesktopContentService struct {
	database func() (*sql.DB, error)
}

func (s *DesktopContentService) GetContent(ctx context.Context, id string) (protocol.ContentReference, error) {
	db, err := s.database()
	if err != nil {
		return protocol.ContentReference{}, err
	}
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return protocol.ContentReference{}, err
	}
	defer tx.Rollback()
	ref, err := desktopPublicContentReference(ctx, tx, id)
	if err != nil {
		return protocol.ContentReference{}, err
	}
	return ref, tx.Commit()
}

func (s *DesktopContentService) ReadContent(ctx context.Context, id string, input protocol.ContentReadInput) (protocol.ContentChunk, error) {
	input, err := contentstore.Normalize(input)
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	db, err := s.database()
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	defer tx.Rollback()
	ref, err := desktopPublicContentReference(ctx, tx, id)
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	files, err := openDesktopContent(tx)
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	defer files.Close()
	chunk, err := files.Read(ref, input)
	if err != nil {
		return protocol.ContentChunk{}, err
	}
	return chunk, tx.Commit()
}

func desktopPublicContentReference(ctx context.Context, tx *sql.Tx, id string) (protocol.ContentReference, error) {
	parsed, err := uuid.Parse(id)
	if err != nil || parsed == uuid.Nil || parsed.String() != id {
		return protocol.ContentReference{}, contentstore.ErrQuery
	}
	var ref protocol.ContentReference
	// The source session and its current public item must both still exist.
	// A replaced version is inaccessible even before retention removes the file.
	err = tx.QueryRowContext(ctx, `SELECT c.id,c.media_type,c.size,c.sha256 FROM desktop_content_objects c
 WHERE c.id=? AND (
  (c.source_type='ai_session' AND EXISTS(SELECT 1 FROM desktop_ai_sessions s WHERE s.id=c.source_id AND s.status<>'closed' AND (
   EXISTS(SELECT 1 FROM desktop_ai_messages m WHERE m.session_id=s.id AND m.content_id=c.id)
   OR EXISTS(SELECT 1 FROM desktop_ai_session_tasks t WHERE t.session_id=s.id AND (t.public_content_id=c.id OR t.artifact_content_id=c.id))
  )))
  OR (c.source_type='task_run' AND (EXISTS(SELECT 1 FROM desktop_task_runs r WHERE r.content_id=c.id AND r.id=c.source_id) OR EXISTS(SELECT 1 FROM activity_logs a WHERE a.task_content_id=c.id AND a.source_table='desktop_task_runs' AND a.source_id=c.source_id)))
  OR (c.source_type='task_target' AND EXISTS(SELECT 1 FROM activity_logs a WHERE a.detail_content_id=c.id AND a.source_table='desktop_batch_task_results' AND a.source_id=c.source_id))
  OR (c.source_type='task_event' AND EXISTS(SELECT 1 FROM desktop_task_events e JOIN desktop_task_runs r ON r.id=e.task_run_id WHERE e.content_id=c.id AND e.task_run_id=c.source_id))
 )`, id).Scan(&ref.ID, &ref.MediaType, &ref.Size, &ref.Sha256)
	if err != nil {
		return protocol.ContentReference{}, err
	}
	if err := contentstore.ValidateReference(ref); err != nil {
		return protocol.ContentReference{}, err
	}
	return ref, nil
}

// Host callers select only public item columns inside their history transaction.
func desktopAIHistoryDescriptor(tx *sql.Tx, sessionID string, item desktopAISessionItem) (protocol.AIHistoryItem, error) {
	var ref protocol.ContentReference
	err := tx.QueryRow(`SELECT id,media_type,size,sha256 FROM desktop_content_objects WHERE id=? AND source_type='ai_session' AND source_id=?`, item.ContentID.String, sessionID).Scan(&ref.ID, &ref.MediaType, &ref.Size, &ref.Sha256)
	if err != nil {
		return protocol.AIHistoryItem{}, err
	}
	if err := contentstore.ValidateReference(ref); err != nil {
		return protocol.AIHistoryItem{}, err
	}
	if item.Hash != "" && item.Hash != ref.Sha256 {
		return protocol.AIHistoryItem{}, contentstore.ErrChanged
	}
	return protocol.AIHistoryItem{ID: item.ID, Bytes: int(ref.Size), Hash: ref.Sha256, Content: &ref}, nil
}
