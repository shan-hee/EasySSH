package app

import (
	"context"
	"database/sql"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/resultstore"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// This scope is constructed from the native window's authenticated client.
// Stored Actor fields are attribution and are never used to obtain authority.
type desktopRemoteTransferStore struct {
	db          *sql.DB
	workspaceID string
	origin      string
	actor       protocol.Actor
}

type DesktopRemoteTransferListInput struct {
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
}

type DesktopRemoteTransferList struct {
	Items    []DesktopRemoteTransfer `json:"items"`
	Total    int64                   `json:"total"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"page_size"`
}

const remoteTransferScopeSQL = `workspace_id=? AND origin=? AND actor_kind=? AND actor_id=? AND actor_session_id=? AND actor_grant_id=?`

func (store *desktopRemoteTransferStore) scopeArgs() []any {
	return []any{store.workspaceID, store.origin, store.actor.Kind, store.actor.ID, store.actor.SessionID, store.actor.GrantID}
}

// A restart never resumes a stream, reopens a local path, or repeats a mutation.
// Even a download may have renamed its file just before losing its final receipt.
func (s *DesktopRemoteWorkspaceService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	db, err := s.servers.database()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if err = recoverRemoteTransferReceipts(ctx, db, now); err != nil {
		return err
	}
	return nil
}

// Called only when the preceding native session has fully stopped. It also
// repairs an interrupted final receipt after closing/reopening without restart.
func (store *desktopRemoteTransferStore) recoverStopped(ctx context.Context) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	args := append([]any{now, now}, store.scopeArgs()...)
	_, err := store.db.ExecContext(ctx, `UPDATE desktop_remote_transfers SET status='unknown',error_code='workspace_closed',finished_at=?,updated_at=? WHERE `+remoteTransferScopeSQL+` AND status IN ('running','canceling')`, args...)
	if err != nil {
		return remoteError("transfer_persistence_failed")
	}
	return nil
}

// Called under session.resourcesMu only when the local transfer has stopped or
// no in-process task owns the saved intent.
// It normalizes the saved intent, never restores a local file or observed result.
func (store *desktopRemoteTransferStore) recoverStoppedTransfer(ctx context.Context, id string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	args := append([]any{now, now, id}, store.scopeArgs()...)
	_, err := store.db.ExecContext(ctx, `UPDATE desktop_remote_transfers SET status='unknown',error_code='transfer_interrupted',finished_at=?,updated_at=? WHERE id=? AND `+remoteTransferScopeSQL+` AND status IN ('running','canceling')`, args...)
	if err != nil {
		return remoteError("transfer_persistence_failed")
	}
	return nil
}

func recoverRemoteTransferReceipts(ctx context.Context, db *sql.DB, now time.Time) error {
	_, err := db.ExecContext(ctx, `UPDATE desktop_remote_transfers SET status='unknown', error_code='desktop_restarted', finished_at=?, updated_at=? WHERE status IN ('running','canceling')`, now.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
	return err
}

// cleanupRemoteTransferReceipts removes receipts of finished transfers older
// than the retention cutoff for task records.
func cleanupRemoteTransferReceipts(ctx context.Context, db *sql.DB, before time.Time) (int64, error) {
	result, err := db.ExecContext(ctx, `DELETE FROM desktop_remote_transfers WHERE status IN ('unknown','succeeded','failed','canceled') AND updated_at<?`, before.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (store *desktopRemoteTransferStore) insert(ctx context.Context, info DesktopRemoteTransfer) error {
	if store == nil || store.db == nil || !store.actor.Valid() || store.actor.Kind != protocol.Visitor {
		return remoteError("transfer_store_unavailable")
	}
	_, err := store.db.ExecContext(ctx, `INSERT INTO desktop_remote_transfers(id,workspace_id,origin,actor_kind,actor_id,actor_session_id,actor_grant_id,connection_id,server_id,kind,name,remote_path,source_task_id,status,transferred,total,error_code,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, info.ID, store.workspaceID, store.origin, store.actor.Kind, store.actor.ID, store.actor.SessionID, store.actor.GrantID, info.ConnectionID, info.ServerID, info.Kind, info.Name, info.RemotePath, info.SourceTaskID, info.Status, info.Transferred, info.Total, info.Error, info.CreatedAt.Format(time.RFC3339Nano), info.UpdatedAt.Format(time.RFC3339Nano), "")
	if err != nil {
		return remoteError("transfer_persistence_failed")
	}
	return nil
}

// Caller holds task.mu, so progress and final writes cannot overtake one another.
func (task *desktopRemoteTransfer) persistLocked() error {
	store, info := task.store, task.info
	if store == nil || store.db == nil {
		return remoteError("transfer_store_unavailable")
	}
	finished := ""
	if info.FinishedAt != nil {
		finished = info.FinishedAt.Format(time.RFC3339Nano)
	}
	args := []any{info.SourceTaskID, info.Status, info.Transferred, info.Total, info.Error, info.UpdatedAt.Format(time.RFC3339Nano), finished, info.ID}
	args = append(args, store.scopeArgs()...)
	err := resultstore.Write(task.ctx, func(ctx context.Context) error {
		result, err := store.db.ExecContext(ctx, `UPDATE desktop_remote_transfers SET source_task_id=?,status=?,transferred=?,total=?,error_code=?,updated_at=?,finished_at=? WHERE id=? AND `+remoteTransferScopeSQL, args...)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return resultstore.Permanent(sql.ErrNoRows)
		}
		return nil
	})
	if err != nil {
		task.cancel()
		// Discard the uncommitted outcome, retaining only that execution stopped.
		// Reopening reconciles the durable intent; no local result is retried by UI.
		now := time.Now().UTC()
		task.info.Status, task.info.Error = "unknown", "transfer_outcome_unknown"
		task.info.FinishedAt, task.info.UpdatedAt = &now, now
		desktopLogPrintf("remote transfer persistence failed: id=%s error=%v", info.ID, err)
		return remoteError("transfer_persistence_failed")
	}
	task.persistedAt = time.Now()
	return nil
}

const remoteTransferSelectSQL = `SELECT id,connection_id,server_id,kind,name,remote_path,source_task_id,status,transferred,total,error_code,created_at,updated_at,finished_at FROM desktop_remote_transfers`

func scanRemoteTransfer(row interface{ Scan(...any) error }) (DesktopRemoteTransfer, error) {
	var info DesktopRemoteTransfer
	var created, updated, finished string
	err := row.Scan(&info.ID, &info.ConnectionID, &info.ServerID, &info.Kind, &info.Name, &info.RemotePath, &info.SourceTaskID, &info.Status, &info.Transferred, &info.Total, &info.Error, &created, &updated, &finished)
	if err != nil {
		return info, remoteError("transfer_unavailable")
	}
	info.CreatedAt, err = time.Parse(time.RFC3339Nano, created)
	if err == nil {
		info.UpdatedAt, err = time.Parse(time.RFC3339Nano, updated)
	}
	if err == nil && finished != "" {
		var at time.Time
		at, err = time.Parse(time.RFC3339Nano, finished)
		info.FinishedAt = &at
	}
	if err != nil || !validRemoteUUID(info.ID) || !validRemoteUUID(info.ServerID) || !protocol.ValidConnectionID(info.ConnectionID) || !validRemoteFilePath(info.RemotePath) || (info.SourceTaskID != "" && !validRemoteUUID(info.SourceTaskID)) || info.Transferred < 0 || info.Total < -1 {
		return DesktopRemoteTransfer{}, remoteError("invalid_transfer_record")
	}
	return info, nil
}

func (store *desktopRemoteTransferStore) get(ctx context.Context, id string) (DesktopRemoteTransfer, error) {
	if !validRemoteUUID(id) {
		return DesktopRemoteTransfer{}, remoteError("transfer_unavailable")
	}
	args := append([]any{id}, store.scopeArgs()...)
	return scanRemoteTransfer(store.db.QueryRowContext(ctx, remoteTransferSelectSQL+` WHERE id=? AND `+remoteTransferScopeSQL, args...))
}

func (store *desktopRemoteTransferStore) list(ctx context.Context, input DesktopRemoteTransferListInput) (DesktopRemoteTransferList, error) {
	if input.Page < 1 {
		input.Page = 1
	}
	if input.PageSize < 1 {
		input.PageSize = 50
	}
	if input.PageSize > 100 {
		input.PageSize = 100
	}
	if input.Page > 1000000 {
		return DesktopRemoteTransferList{}, remoteError("invalid_page")
	}
	result := DesktopRemoteTransferList{Items: []DesktopRemoteTransfer{}, Page: input.Page, PageSize: input.PageSize}
	tx, err := store.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return result, remoteError("transfer_store_unavailable")
	}
	defer tx.Rollback()
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM desktop_remote_transfers WHERE `+remoteTransferScopeSQL, store.scopeArgs()...).Scan(&result.Total); err != nil {
		return result, remoteError("transfer_store_unavailable")
	}
	args := append(store.scopeArgs(), input.PageSize, (input.Page-1)*input.PageSize)
	rows, err := tx.QueryContext(ctx, remoteTransferSelectSQL+` WHERE `+remoteTransferScopeSQL+` ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return result, remoteError("transfer_store_unavailable")
	}
	defer rows.Close()
	for rows.Next() {
		info, scanErr := scanRemoteTransfer(rows)
		if scanErr != nil {
			return result, scanErr
		}
		result.Items = append(result.Items, info)
	}
	if err = rows.Err(); err != nil {
		return result, remoteError("transfer_store_unavailable")
	}
	if err = rows.Close(); err != nil {
		return result, remoteError("transfer_store_unavailable")
	}
	if err = tx.Commit(); err != nil {
		return result, remoteError("transfer_store_unavailable")
	}
	return result, nil
}

func (store *desktopRemoteTransferStore) dismiss(ctx context.Context, id string) error {
	args := append([]any{id}, store.scopeArgs()...)
	_, err := store.db.ExecContext(ctx, `DELETE FROM desktop_remote_transfers WHERE id=? AND `+remoteTransferScopeSQL+` AND status IN ('succeeded','failed','canceled','unknown')`, args...)
	if err != nil {
		return remoteError("transfer_persistence_failed")
	}
	return nil
}
