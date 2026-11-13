package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/aichatui"
	"github.com/easyssh/shared/aiworkspace"
	"strings"
	"time"
)

// Execution provenance is private local state, never part of the public view or
// the synchronized conversation. It follows its task, not a session-wide map.
type desktopAIPersistedTask struct {
	View      DesktopAITaskView         `json:"view"`
	Execution *desktopAIExecutionOrigin `json:"execution,omitempty"`
}

type desktopAISessionItem struct {
	ArtifactContentID         sql.NullString
	ContentID                 sql.NullString
	ID, Payload, Hash, Status string
	Position                  int
}

func makeDesktopAISessionItem(id string, position int, value any) (desktopAISessionItem, error) {
	if id == "" || len(id) > 256 {
		return desktopAISessionItem{}, errors.New("invalid AI history item ID")
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return desktopAISessionItem{}, err
	}
	digest := sha256.Sum256(raw)
	return desktopAISessionItem{ID: id, Position: position, Payload: string(raw), Hash: hex.EncodeToString(digest[:])}, nil
}

func saveDesktopAISessionItems(ctx context.Context, tx *sql.Tx, record desktopAISessionRecord) error {
	messages := make([]desktopAISessionItem, 0, len(record.Messages))
	for i, message := range record.Messages {
		item, err := makeDesktopAISessionItem(message.ID, i, toAichatUIMessages([]DesktopAIMessageView{message})[0])
		if err != nil {
			return err
		}
		messages = append(messages, item)
	}
	tasks := make([]desktopAISessionItem, 0, len(record.Tasks))
	for i, task := range record.Tasks {
		task.Artifact = nil // The file snapshot has its own durable body reference.
		value := desktopAIPersistedTask{View: task}
		if origin, ok := record.ExecutionOrigins[task.ID]; ok {
			value.Execution = &origin
		}
		item, err := makeDesktopAISessionItem(task.ID, i, value)
		if err != nil {
			return err
		}
		item.Status = string(task.Status)
		tasks = append(tasks, item)
	}
	if err := saveDesktopAIItemSet(ctx, tx, "desktop_ai_messages", record.ID, messages); err != nil {
		return err
	}
	if err := saveDesktopAIItemSet(ctx, tx, "desktop_ai_session_tasks", record.ID, tasks); err != nil {
		return err
	}
	for _, task := range record.Tasks {
		if err := saveDesktopAIArtifact(ctx, tx, record.ID, task.ID, task.Artifact); err != nil {
			return err
		}
	}
	return nil
}

// Table names below are private constants. Only indexes/hashes of prior items
// are read; appending a message never reads or rewrites old item payloads.
func saveDesktopAIItemSet(ctx context.Context, tx *sql.Tx, table, sessionID string, items []desktopAISessionItem) error {
	rows, err := tx.QueryContext(ctx, "SELECT item_id,position,content_hash FROM "+table+" WHERE session_id=?", sessionID)
	if err != nil {
		return err
	}
	previous := make(map[string]desktopAISessionItem)
	for rows.Next() {
		var item desktopAISessionItem
		if err := rows.Scan(&item.ID, &item.Position, &item.Hash); err != nil {
			rows.Close()
			return err
		}
		previous[item.ID] = item
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		if seen[item.ID] {
			return errors.New("duplicate AI history item ID")
		}
		seen[item.ID] = true
		old, exists := previous[item.ID]
		var publicPayload string
		var publicID sql.NullString
		if table == "desktop_ai_session_tasks" && (!exists || old.Hash != item.Hash) {
			var task desktopAIPersistedTask
			if err := json.Unmarshal([]byte(item.Payload), &task); err != nil {
				return err
			}
			raw, err := json.Marshal(toAichatUITasks([]DesktopAITaskView{task.View})[0].Public())
			if err != nil {
				return err
			}
			if len(raw) > 32<<10 {
				id, err := putDesktopAIContent(ctx, tx, sessionID, raw)
				if err != nil {
					return err
				}
				publicID, raw = sql.NullString{String: id, Valid: true}, []byte("null")
			}
			publicPayload = string(raw)
		}
		if (!exists || old.Hash != item.Hash) && len(item.Payload) > 32<<10 {
			id, err := putDesktopAIContent(ctx, tx, sessionID, []byte(item.Payload))
			if err != nil {
				return err
			}
			item.ContentID, item.Payload = sql.NullString{String: id, Valid: true}, "null"
		}
		switch {
		case !exists:
			columns, placeholders := "session_id,item_id,position,payload,content_hash,content_id", "?,?,?,?,?,?"
			args := []any{sessionID, item.ID, item.Position, item.Payload, item.Hash, item.ContentID}
			if table == "desktop_ai_session_tasks" {
				columns, placeholders = columns+",status,public_payload,public_content_id", placeholders+",?,?,?"
				args = append(args, item.Status, publicPayload, publicID)
			}
			_, err = tx.ExecContext(ctx, "INSERT INTO "+table+"("+columns+") VALUES("+placeholders+")", args...)
		case old.Hash != item.Hash:
			changes := "position=?,payload=?,content_hash=?,content_id=?"
			args := []any{item.Position, item.Payload, item.Hash, item.ContentID}
			if table == "desktop_ai_session_tasks" {
				changes += ",status=?,public_payload=?,public_content_id=?"
				args = append(args, item.Status, publicPayload, publicID)
			}
			args = append(args, sessionID, item.ID)
			_, err = tx.ExecContext(ctx, "UPDATE "+table+" SET "+changes+" WHERE session_id=? AND item_id=?", args...)
		case old.Position != item.Position:
			_, err = tx.ExecContext(ctx, "UPDATE "+table+" SET position=? WHERE session_id=? AND item_id=?", item.Position, sessionID, item.ID)
		}
		if err != nil {
			return err
		}
		delete(previous, item.ID)
	}
	removed := make([]string, 0, len(previous))
	for id := range previous {
		removed = append(removed, id)
	}
	for len(removed) > 0 {
		count := min(len(removed), 100)
		args := []any{sessionID}
		for _, id := range removed[:count] {
			args = append(args, id)
		}
		placeholders := strings.TrimSuffix(strings.Repeat("?,", count), ",")
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE session_id=? AND item_id IN ("+placeholders+")", args...); err != nil {
			return err
		}
		removed = removed[count:]
	}
	return nil
}

func loadDesktopAISessionItems(tx *sql.Tx, record *desktopAISessionRecord) error {
	record.Messages, record.Tasks = []DesktopAIMessageView{}, []DesktopAITaskView{}
	record.ExecutionOrigins = make(map[string]desktopAIExecutionOrigin)
	for _, table := range []string{"desktop_ai_messages", "desktop_ai_session_tasks"} {
		if err := loadDesktopAIItemSet(tx, table, record); err != nil {
			return err
		}
	}
	return nil
}

func loadDesktopAIItemSet(tx *sql.Tx, table string, record *desktopAISessionRecord) error {
	columns := "item_id,payload,content_hash,content_id,NULL"
	if table == "desktop_ai_session_tasks" {
		columns = "item_id,payload,content_hash,content_id,artifact_content_id"
	}
	rows, err := tx.Query("SELECT "+columns+" FROM "+table+" WHERE session_id=? ORDER BY position,item_id", record.ID)
	if err != nil {
		return err
	}
	items := []desktopAISessionItem{}
	for rows.Next() {
		var item desktopAISessionItem
		if err := rows.Scan(&item.ID, &item.Payload, &item.Hash, &item.ContentID, &item.ArtifactContentID); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, item := range items {
		payload, err := loadDesktopAIItemPayload(tx, record.ID, item)
		if err != nil {
			return err
		}
		id := item.ID
		if table == "desktop_ai_messages" {
			var message aichatui.MessageView
			if err := json.Unmarshal(payload, &message); err != nil {
				return err
			}
			if id != message.ID {
				return errors.New("AI message identity mismatch")
			}
			record.Messages = append(record.Messages, fromAichatUIMessages([]aichatui.MessageView{message})[0])
		} else {
			var task desktopAIPersistedTask
			if err := json.Unmarshal(payload, &task); err != nil {
				return err
			}
			if id != task.View.ID {
				return errors.New("AI task identity mismatch")
			}
			if item.ArtifactContentID.Valid {
				body := desktopAISessionItem{ContentID: item.ArtifactContentID}
				ref, err := desktopAIHistoryDescriptor(tx, record.ID, body)
				if err != nil {
					return err
				}
				body.Hash = ref.Hash
				raw, err := loadDesktopAIItemPayload(tx, record.ID, body)
				if err != nil {
					return err
				}
				var file aiworkspace.FileArtifact
				if err := json.Unmarshal(raw, &file); err != nil {
					return err
				}
				task.View.Artifact = &file
			}
			record.Tasks = append(record.Tasks, task.View)
			if task.Execution != nil {
				record.ExecutionOrigins[id] = *task.Execution
			}
		}
	}
	return nil
}

// Caller holds desktopInstanceFilesMu through transaction completion. Read
// metadata and items in the same snapshot, including during sync export.
func loadDesktopAISession(tx *sql.Tx, id string) (desktopAISessionRecord, error) {
	var record desktopAISessionRecord
	var customTitle int
	var permissionMode, status, scopeJSON string
	err := tx.QueryRow(`
		SELECT id, config_space_id, title, custom_title, model, permission_mode, scope_json, status, created_at, updated_at
		FROM desktop_ai_sessions
		WHERE id = ?`, id).Scan(
		&record.ID,
		&record.ConfigSpaceID,
		&record.Title,
		&customTitle,
		&record.Model,
		&permissionMode,
		&scopeJSON,
		&status,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return desktopAISessionRecord{}, err
	}
	record.Title = strings.TrimSpace(record.Title)
	record.CustomTitle = customTitle == 1 && record.Title != ""
	record.PermissionMode = normalizeDesktopAIPermission(DesktopAIPermissionMode(permissionMode))
	record.Scope = decodeDesktopAIScope(scopeJSON)
	record.Status = DesktopAISessionStatus(status)
	if record.Status == "" {
		record.Status = DesktopAISessionIdle
	}
	if err := loadDesktopAISessionItems(tx, &record); err != nil {
		return desktopAISessionRecord{}, err
	}
	return record, nil
}

// The caller owns the transaction, desktopInstanceFilesMu read lock and the
// execution/sync admission boundary. Release the file lock only after commit.
func saveDesktopAISession(ctx context.Context, tx *sql.Tx, record desktopAISessionRecord) error {
	updated, err := time.Parse(time.RFC3339Nano, record.UpdatedAt)
	if err != nil {
		return err
	}
	record.UpdatedAt = updated.UTC().Format(desktopAITimeLayout)
	record.ExecutionOrigins = desktopAIKeptOrigins(record)
	scopeJSON := mustDesktopAIJSON(record.Scope)
	projection := desktopAIHistoryProjection(record.Title, record.CustomTitle, toAichatUIMessages(record.Messages))
	scopeKind, scopeServerID, scopeTerminalID := "", "", ""
	if scope := normalizeDesktopAISessionScope(record.Scope); scope != nil {
		scopeKind, scopeServerID, scopeTerminalID = scope.Kind, scope.ServerID, scope.TerminalSessionID
	}

	saved, err := tx.ExecContext(ctx, `
		INSERT INTO desktop_ai_sessions
			(id, config_space_id, title, custom_title, model, permission_mode, scope_json, status, created_at, updated_at, list_title, title_folded, search_text, search_folded, preview, message_count, task_count, scope_kind, scope_server_id, scope_terminal_session_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			custom_title = excluded.custom_title,
			model = excluded.model,
			permission_mode = excluded.permission_mode,
			scope_json = excluded.scope_json,
			status = excluded.status,
			list_title = excluded.list_title,
			title_folded = excluded.title_folded,
			search_text = excluded.search_text,
			search_folded = excluded.search_folded,
			preview = excluded.preview,
			message_count = excluded.message_count,
			task_count = excluded.task_count,
			scope_kind = excluded.scope_kind,
			scope_server_id = excluded.scope_server_id,
			scope_terminal_session_id = excluded.scope_terminal_session_id,
			updated_at = excluded.updated_at
		WHERE desktop_ai_sessions.updated_at <= excluded.updated_at`,
		record.ID,
		record.ConfigSpaceID,
		record.Title,
		boolToInt(record.CustomTitle),
		record.Model,
		record.PermissionMode,
		scopeJSON,
		record.Status,
		record.CreatedAt,
		record.UpdatedAt,
		projection.Title, projection.TitleFolded, projection.Text, projection.Folded, projection.Preview, len(record.Messages), len(record.Tasks), scopeKind, scopeServerID, scopeTerminalID,
	)
	if err != nil {
		return err
	}
	count, err := saved.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errDesktopAISnapshotConflict
	}
	if err := saveDesktopAISessionItems(ctx, tx, record); err != nil {
		return err
	}
	if err := saveDesktopAIExecutions(tx, record); err != nil {
		return err
	}
	return nil
}

func deleteDesktopAISession(ctx context.Context, tx *sql.Tx, id string) error {
	if err := archiveDesktopAISession(tx, id); err != nil {
		return err
	}
	if err := saveDesktopAIExecutions(tx, desktopAISessionRecord{ID: id, UpdatedAt: time.Now().UTC().Format(desktopAITimeLayout)}); err != nil {
		return err
	}
	// Child history is removed by FK cascade; native execution facts survive.
	_, err := tx.ExecContext(ctx, "DELETE FROM desktop_ai_sessions WHERE id=?", id)
	return err
}
