package app

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/taskprotocol"
	"github.com/google/uuid"
)

func desktopTaskBody(run DesktopTaskRun) protocol.TaskBody {
	return protocol.TaskBody{TaskRunID: uuid.MustParse(run.ID), Description: run.Description, PayloadJSON: run.PayloadJSON, ResultJSON: run.ResultJSON, ProgressJSON: run.ProgressJSON}
}

// The caller holds the instance file lock until the enclosing transaction commits.
// The database keeps either the inline body or a file reference, never both.
func saveDesktopTaskBody(ctx context.Context, tx *sql.Tx, body protocol.TaskBody) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	var contentID any
	if len(raw) > taskprotocol.MaxInlineContentBytes {
		ref, err := putDesktopJSONContent(ctx, tx, "task_run", body.TaskRunID.String(), raw)
		if err != nil {
			return err
		}
		contentID = ref.ID.String()
		body.Description, body.PayloadJSON, body.ResultJSON, body.ProgressJSON = "", "", "", ""
	}
	result, err := tx.ExecContext(ctx, `UPDATE desktop_task_runs SET content_id=?,description=?,payload_json=?,result_json=?,progress_json=? WHERE id=?`, contentID, body.Description, body.PayloadJSON, body.ResultJSON, body.ProgressJSON, body.TaskRunID.String())
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n != 1 {
		return sql.ErrNoRows
	}
	return err
}

func desktopTaskContentReference(ctx context.Context, tx *sql.Tx, id string) (*protocol.ContentReference, error) {
	var contentID sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT content_id FROM desktop_task_runs WHERE id=?`, id).Scan(&contentID); err != nil {
		return nil, err
	}
	if !contentID.Valid {
		return nil, nil
	}
	var ref protocol.ContentReference
	if err := tx.QueryRowContext(ctx, `SELECT id,media_type,size,sha256 FROM desktop_content_objects WHERE id=? AND source_type='task_run' AND source_id=?`, contentID.String, id).Scan(&ref.ID, &ref.MediaType, &ref.Size, &ref.Sha256); err != nil {
		return nil, err
	}
	if err := contentstore.ValidateReference(ref); err != nil {
		return nil, err
	}
	return &ref, nil
}

func loadDesktopTaskBody(ctx context.Context, tx *sql.Tx, run *DesktopTaskRun) error {
	ref, err := desktopTaskContentReference(ctx, tx, run.ID)
	if err != nil || ref == nil {
		return err
	}
	files, err := openDesktopContent(tx)
	if err != nil {
		return err
	}
	defer files.Close()
	raw, err := files.Load(*ref)
	if err != nil {
		return err
	}
	var body protocol.TaskBody
	if err := json.Unmarshal(raw, &body); err != nil {
		return err
	}
	if body.TaskRunID.String() != run.ID {
		return contentstore.ErrChanged
	}
	run.Description, run.PayloadJSON, run.ResultJSON, run.ProgressJSON = body.Description, body.PayloadJSON, body.ResultJSON, body.ProgressJSON
	return nil
}

// Detail reads only the committed descriptor; large files are read separately
// through DesktopContentService. Runtime state is never stored in the body file.
func (s *DesktopTaskService) taskDetails(ctx context.Context, id string) (DesktopTaskDetails, error) {
	if !taskprotocol.ValidEventRunID(id) {
		return DesktopTaskDetails{}, contentstore.ErrQuery
	}
	db, err := s.database()
	if err != nil {
		return DesktopTaskDetails{}, err
	}
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return DesktopTaskDetails{}, err
	}
	defer tx.Rollback()
	run, err := scanDesktopTaskRun(tx.QueryRowContext(ctx, desktopTaskSelectSQL+" WHERE id=?", id))
	if err != nil {
		return DesktopTaskDetails{}, err
	}
	ref, err := desktopTaskContentReference(ctx, tx, id)
	if err != nil {
		return DesktopTaskDetails{}, err
	}
	var descriptor protocol.TaskContent
	if ref != nil {
		descriptor = protocol.TaskContent{Content: ref, Bytes: int(ref.Size), Hash: ref.Sha256}
	} else {
		descriptor, err = taskprotocol.DescribeContent(desktopTaskBody(run))
		if err != nil {
			return DesktopTaskDetails{}, err
		}
	}
	return DesktopTaskDetails{Run: desktopTaskFullOverview(run), Content: descriptor}, tx.Commit()
}
