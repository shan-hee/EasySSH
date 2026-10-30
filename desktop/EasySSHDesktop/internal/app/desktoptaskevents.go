package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"time"

	"github.com/easyssh/shared/taskprotocol"
)

const desktopTaskEventColumns = "id, task_run_id, level, message, data_json, created_at, content_id, content_size, content_sha256"

func scanDesktopWireTaskEvent(row interface{ Scan(...any) error }) (protocol.TaskEvent, error) {
	var event protocol.TaskEvent
	var created string
	var contentID sql.NullString
	var ref protocol.ContentReference
	if err := row.Scan(&event.ID, &event.TaskRunID, &event.Level, &event.Message, &event.DataJSON, &created, &contentID, &ref.Size, &ref.Sha256); err != nil {
		return event, err
	}
	var err error
	event.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err != nil {
		return event, err
	}
	if contentID.Valid {
		ref.ID, err = uuid.Parse(contentID.String)
		if err != nil {
			return event, err
		}
		ref.MediaType = "application/json"
		event.Content = &ref
	}
	return event, nil
}

func (s *DesktopTaskService) ListEvents(ctx context.Context, id string, input protocol.TaskEventInput) (*protocol.TaskEventPage, error) {
	if !taskprotocol.ValidEventRunID(id) {
		return nil, taskprotocol.ErrEventQuery
	}
	input, err := taskprotocol.NormalizeEventInput(input)
	if err != nil {
		return nil, err
	}
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	var exists int
	if err := db.QueryRowContext(ctx, "SELECT 1 FROM desktop_task_runs WHERE id=?", id).Scan(&exists); err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, "SELECT "+desktopTaskEventColumns+" FROM desktop_task_events WHERE task_run_id=? AND id>? ORDER BY id ASC LIMIT ?", id, input.AfterID, input.Limit+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return taskprotocol.BuildEventPage(id, input, func() (protocol.TaskEvent, bool, error) {
		if !rows.Next() {
			return protocol.TaskEvent{}, false, rows.Err()
		}
		event, err := scanDesktopWireTaskEvent(rows)
		return event, err == nil, err
	})
}

// The event and immutable content reference commit together. The same instance
// lock as backup protects newly created files until the transaction finishes.
func (s *DesktopTaskService) appendObservation(ctx context.Context, id, level, message, data string) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	created := time.Now().UTC()
	result, err := tx.ExecContext(ctx, `INSERT INTO desktop_task_events(task_run_id,actor_kind,actor_id,actor_session_id,actor_grant_id,level,message,data_json,created_at) SELECT id,actor_kind,actor_id,actor_session_id,actor_grant_id,?,'','',? FROM desktop_task_runs WHERE id=? AND status IN ('running','canceling')`, level, created.Format(time.RFC3339Nano), id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("task is unavailable for execution observations")
	}
	eventID, err := result.LastInsertId()
	if err != nil {
		return err
	}
	event := protocol.TaskEvent{ID: uint(eventID), TaskRunID: id, Level: level, Message: message, DataJSON: data, CreatedAt: created}
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	var contentID any
	var size int64
	var hash string
	if len(raw) > taskprotocol.MaxInlineEventBytes {
		ref, err := putDesktopJSONContent(ctx, tx, "task_event", id, raw)
		if err != nil {
			return err
		}
		contentID, size, hash = ref.ID.String(), ref.Size, ref.Sha256
		message, data = "", ""
	}
	if _, err := tx.ExecContext(ctx, `UPDATE desktop_task_events SET message=?,data_json=?,content_id=?,content_size=?,content_sha256=? WHERE id=?`, message, data, contentID, size, hash, eventID); err != nil {
		return err
	}
	return tx.Commit()
}
