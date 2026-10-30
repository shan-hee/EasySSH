package app

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"

	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

// Use the actual database location, including restored instances and isolated
// test databases. No process-global directory or long-lived file handle is
// needed. Callers hold desktopInstanceFilesMu before starting their transaction.
func openDesktopContent(query interface {
	Query(string, ...any) (*sql.Rows, error)
}) (*contentstore.Store, error) {
	rows, err := query.Query("PRAGMA database_list")
	if err != nil {
		return nil, err
	}
	var mainFile string
	for rows.Next() {
		var sequence int
		var name, file string
		if err := rows.Scan(&sequence, &name, &file); err != nil {
			rows.Close()
			return nil, err
		}
		if name == "main" {
			mainFile = file
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if mainFile == "" {
		return nil, errors.New("content storage requires a file-backed desktop database")
	}
	return contentstore.Open(filepath.Join(filepath.Dir(mainFile), "content"))
}

// Store an AI body in the current host transaction. Public reads require a
// current message, public tool projection or artifact reference, never a private task.
func putDesktopAIContent(ctx context.Context, tx *sql.Tx, sessionID string, raw []byte) (string, error) {
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM desktop_ai_sessions WHERE id=?)`, sessionID).Scan(&exists); err != nil {
		return "", err
	}
	if !exists {
		return "", sql.ErrNoRows
	}
	ref, err := putDesktopJSONContent(ctx, tx, "ai_session", sessionID, raw)
	if err != nil {
		return "", err
	}
	return ref.ID.String(), nil
}

// Called by trusted host writers under desktopInstanceFilesMu through commit.
func putDesktopJSONContent(ctx context.Context, tx *sql.Tx, sourceType, sourceID string, raw []byte) (protocol.ContentReference, error) {
	return putDesktopContent(ctx, tx, sourceType, sourceID, raw, "application/json")
}

func putDesktopContent(ctx context.Context, tx *sql.Tx, sourceType, sourceID string, raw []byte, media string) (protocol.ContentReference, error) {
	files, err := openDesktopContent(tx)
	if err != nil {
		return protocol.ContentReference{}, err
	}
	defer files.Close()
	writer, err := files.Create(uuid.New(), media)
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
	_, err = tx.ExecContext(ctx, `INSERT INTO desktop_content_objects(id,source_type,source_id,media_type,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)`, ref.ID.String(), sourceType, sourceID, ref.MediaType, ref.Size, ref.Sha256, desktopTaskNow())
	if err != nil {
		return protocol.ContentReference{}, err
	}
	return ref, nil
}

func loadDesktopAIItemPayload(tx *sql.Tx, sessionID string, item desktopAISessionItem) ([]byte, error) {
	if !item.ContentID.Valid {
		return []byte(item.Payload), nil
	}
	var ref protocol.ContentReference
	if err := tx.QueryRow(`SELECT id,media_type,size,sha256 FROM desktop_content_objects WHERE id=? AND source_type='ai_session' AND source_id=?`, item.ContentID.String, sessionID).Scan(&ref.ID, &ref.MediaType, &ref.Size, &ref.Sha256); err != nil {
		return nil, err
	}
	if ref.Sha256 != item.Hash {
		return nil, contentstore.ErrChanged
	}
	files, err := openDesktopContent(tx)
	if err != nil {
		return nil, err
	}
	defer files.Close()
	return files.Load(ref)
}

// Run in the existing retention/startup lifecycle. Readers and writers hold the
// same instance-file lock as backup; busy passes simply defer to the next pass.
func cleanupDesktopContent(ctx context.Context, db *sql.DB) error {
	if !desktopInstanceFilesMu.TryLock() {
		return nil
	}
	defer desktopInstanceFilesMu.Unlock()
	files, err := openDesktopContent(db)
	if err != nil {
		return err
	}
	defer files.Close()
	if _, err := db.ExecContext(ctx, `DELETE FROM desktop_batch_task_results WHERE
 NOT EXISTS(SELECT 1 FROM desktop_task_runs r WHERE r.source_type='desktop_batch_task' AND r.source_id=desktop_batch_task_results.task_id)
 AND NOT EXISTS(SELECT 1 FROM activity_logs a WHERE a.source_table='desktop_batch_task_results' AND a.source_id=desktop_batch_task_results.id)`); err != nil {
		return err
	}
	after := ""
	for {
		rows, err := db.QueryContext(ctx, `SELECT id FROM desktop_content_objects c WHERE id>? AND ((source_type='ai_session'
			AND NOT EXISTS(SELECT 1 FROM desktop_ai_messages m WHERE m.content_id=c.id)
			AND NOT EXISTS(SELECT 1 FROM desktop_ai_session_tasks t WHERE t.content_id=c.id)
            AND NOT EXISTS(SELECT 1 FROM desktop_ai_session_tasks t WHERE t.public_content_id=c.id)
            AND NOT EXISTS(SELECT 1 FROM desktop_ai_session_tasks t WHERE t.artifact_content_id=c.id))
            OR (source_type='task_target' AND NOT EXISTS(SELECT 1 FROM desktop_batch_task_results r WHERE r.output_content_id=c.id) AND NOT EXISTS(SELECT 1 FROM activity_logs a WHERE a.detail_content_id=c.id))
            OR (source_type='task_event' AND NOT EXISTS(SELECT 1 FROM desktop_task_events e WHERE e.content_id=c.id))
            OR (source_type='task_run' AND NOT EXISTS(SELECT 1 FROM desktop_task_runs r WHERE r.content_id=c.id) AND NOT EXISTS(SELECT 1 FROM activity_logs a WHERE a.task_content_id=c.id)))
			ORDER BY id LIMIT 128`, after)
		if err != nil {
			return err
		}
		ids := make([]uuid.UUID, 0, 128)
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			break
		}
		for _, id := range ids {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := files.Remove(id); err != nil {
				return err
			}
			if _, err := db.ExecContext(ctx, `DELETE FROM desktop_content_objects WHERE id=?`, id.String()); err != nil {
				return err
			}
			after = id.String()
		}
	}
	return files.Scan(func(ids []uuid.UUID) error {
		args := make([]any, len(ids))
		for i, id := range ids {
			args[i] = id.String()
		}
		rows, err := db.QueryContext(ctx, `SELECT id FROM desktop_content_objects WHERE id IN (`+desktopSQLPlaceholders(len(ids))+`)`, args...)
		if err != nil {
			return err
		}
		retained := map[uuid.UUID]bool{}
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			retained[id] = true
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err := ctx.Err(); err != nil {
				return err
			}
			if !retained[id] {
				if err := files.Remove(id); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
