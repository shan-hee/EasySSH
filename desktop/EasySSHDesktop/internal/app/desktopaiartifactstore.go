package app

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/easyssh/shared/aiworkspace"
)

// File snapshots share the session transaction and the existing file lock.
// The FileArtifact object is not embedded in execution JSON or public history.
func saveDesktopAIArtifact(ctx context.Context, tx *sql.Tx, sessionID, taskID string, file *aiworkspace.FileArtifact) error {
	var previous sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT artifact_content_id FROM desktop_ai_session_tasks WHERE session_id=? AND item_id=?`, sessionID, taskID).Scan(&previous); err != nil {
		return err
	}
	var next sql.NullString
	if file != nil {
		raw, err := json.Marshal(file)
		if err != nil {
			return err
		}
		if previous.Valid {
			ref, err := desktopAIHistoryDescriptor(tx, sessionID, desktopAISessionItem{ContentID: previous})
			if err != nil {
				return err
			}
			if ref.Hash == aiworkspace.Hash(string(raw)) && ref.Bytes == len(raw) {
				return nil
			}
		}
		id, err := putDesktopAIContent(ctx, tx, sessionID, raw)
		if err != nil {
			return err
		}
		next = sql.NullString{String: id, Valid: true}
	} else if !previous.Valid {
		return nil
	}
	_, err := tx.ExecContext(ctx, `UPDATE desktop_ai_session_tasks SET artifact_content_id=? WHERE session_id=? AND item_id=?`, next, sessionID, taskID)
	return err
}
