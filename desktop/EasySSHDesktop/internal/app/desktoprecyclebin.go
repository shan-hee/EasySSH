package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The recycle bin keeps a copy of deleted servers, scripts and AI conversations
// until the retention period for deleted data passes. Deleting still removes
// the record from its own tables; the copy is what restoring writes back.
//
// A payload holds exactly what the deleted rows held, so secrets in it are the
// same ciphertext the live tables stored.
const (
	desktopRecycleServer    = "server"
	desktopRecycleScript    = "script"
	desktopRecycleAISession = "ai_session"
)

var errDesktopRecycleExists = errors.New("a record with this ID already exists")

type DesktopRecycleBinEntry struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	ResourceID string `json:"resource_id"`
	Name       string `json:"name"`
	RemovedAt  string `json:"removed_at"`
}

type desktopRow map[string]any

// archivedDesktopRows are the rows of one record, keyed by table.
type archivedDesktopRows map[string][]desktopRow

func desktopRows(tx *sql.Tx, query string, args ...any) ([]desktopRow, error) {
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := []desktopRow{}
	for rows.Next() {
		values := make([]any, len(columns))
		targets := make([]any, len(columns))
		for i := range values {
			targets[i] = &values[i]
		}
		if err = rows.Scan(targets...); err != nil {
			return nil, err
		}
		row := desktopRow{}
		for i, column := range columns {
			if raw, ok := values[i].([]byte); ok {
				row[column] = string(raw)
			} else {
				row[column] = values[i]
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func insertDesktopRow(tx *sql.Tx, table string, row desktopRow) error {
	columns := make([]string, 0, len(row))
	for column := range row {
		// Column names come from this database's own schema, but never trust a payload.
		if column == "" || strings.ContainsFunc(column, func(r rune) bool {
			return r != '_' && (r < 'a' || r > 'z') && (r < '0' || r > '9')
		}) {
			return errors.New("recycle bin entry names an invalid column")
		}
		columns = append(columns, column)
	}
	sort.Strings(columns)
	values := make([]any, len(columns))
	for i, column := range columns {
		values[i] = row[column]
	}
	_, err := tx.Exec("INSERT INTO "+table+"("+strings.Join(columns, ",")+") VALUES("+desktopSQLPlaceholders(len(columns))+")", values...)
	return err
}

func putDesktopRecycle(tx *sql.Tx, kind, resourceID, name string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	// A record deleted again after being restored replaces its earlier copy.
	if _, err = tx.Exec(`DELETE FROM desktop_recycle_bin WHERE kind=? AND resource_id=?`, kind, resourceID); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO desktop_recycle_bin(id,kind,resource_id,name,payload,removed_at) VALUES(?,?,?,?,?,?)`,
		uuid.NewString(), kind, resourceID, name, string(data), time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

// archiveDesktopServer runs just before a server's rows are deleted.
func archiveDesktopServer(tx *sql.Tx, id string) error {
	archived := archivedDesktopRows{}
	for table, column := range map[string]string{"desktop_servers": "id", "desktop_server_auth": "server_id", "desktop_server_tags": "server_id"} {
		rows, err := desktopRows(tx, "SELECT * FROM "+table+" WHERE "+column+"=?", id)
		if err != nil {
			return err
		}
		archived[table] = rows
	}
	if len(archived["desktop_servers"]) != 1 {
		return sql.ErrNoRows
	}
	name, _ := archived["desktop_servers"][0]["name"].(string)
	if name == "" {
		name, _ = archived["desktop_servers"][0]["host"].(string)
	}
	return putDesktopRecycle(tx, desktopRecycleServer, id, name, archived)
}

// deleteDesktopScript removes a script after copying it to the recycle bin.
// Local edits and configuration sync both delete through it.
func deleteDesktopScript(tx *sql.Tx, id string) error {
	rows, err := desktopRows(tx, "SELECT * FROM desktop_scripts WHERE id=?", id)
	if err != nil {
		return err
	}
	if len(rows) == 1 {
		name, _ := rows[0]["name"].(string)
		if err = putDesktopRecycle(tx, desktopRecycleScript, id, name, archivedDesktopRows{"desktop_scripts": rows}); err != nil {
			return err
		}
	}
	_, err = tx.Exec("DELETE FROM desktop_scripts WHERE id=?", id)
	return err
}

// archiveDesktopAISession runs before a conversation's history is removed.
func archiveDesktopAISession(tx *sql.Tx, id string) error {
	record, err := loadDesktopAISession(tx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return putDesktopRecycle(tx, desktopRecycleAISession, id, record.Title, record)
}

func desktopRowExists(tx *sql.Tx, table string, id any) (bool, error) {
	if id == nil || id == "" {
		return false, nil
	}
	var count int
	err := tx.QueryRow("SELECT COUNT(*) FROM "+table+" WHERE id=?", id).Scan(&count)
	return count > 0, err
}

// A group, jump host or SSH key that no longer exists is dropped rather than
// blocking the restore: the server comes back ungrouped, direct, or without
// its key.
func restoreDesktopServer(tx *sql.Tx, entry DesktopRecycleBinEntry, payload string) error {
	var archived archivedDesktopRows
	if err := json.Unmarshal([]byte(payload), &archived); err != nil || len(archived["desktop_servers"]) != 1 {
		return errors.New("recycle bin entry is unreadable")
	}
	if present, err := desktopRowExists(tx, "desktop_servers", entry.ResourceID); err != nil {
		return err
	} else if present {
		return errDesktopRecycleExists
	}
	server := archived["desktop_servers"][0]
	for column, table := range map[string]string{"group_id": "desktop_server_groups", "jump_server_id": "desktop_servers"} {
		if present, err := desktopRowExists(tx, table, server[column]); err != nil {
			return err
		} else if !present {
			server[column] = nil
		}
	}
	var order int
	if err := tx.QueryRow("SELECT COALESCE(MAX(sort_order),-1)+1 FROM desktop_servers").Scan(&order); err != nil {
		return err
	}
	server["sort_order"] = order
	if err := insertDesktopRow(tx, "desktop_servers", server); err != nil {
		return err
	}
	for _, auth := range archived["desktop_server_auth"] {
		if present, err := desktopRowExists(tx, "desktop_ssh_keys", auth["ssh_key_id"]); err != nil {
			return err
		} else if !present {
			auth["ssh_key_id"] = nil
		}
		if err := insertDesktopRow(tx, "desktop_server_auth", auth); err != nil {
			return err
		}
	}
	for _, tag := range archived["desktop_server_tags"] {
		if _, err := tx.Exec("INSERT OR IGNORE INTO desktop_tags(name) VALUES(?)", tag["tag_name"]); err != nil {
			return err
		}
		if err := insertDesktopRow(tx, "desktop_server_tags", tag); err != nil {
			return err
		}
	}
	return recordDesktopConfiguration(tx, "server_created", "server", entry.ResourceID, entry.Name, "manual", []string{"restored"}, nil)
}

func restoreDesktopScript(tx *sql.Tx, entry DesktopRecycleBinEntry, payload string) error {
	var archived archivedDesktopRows
	if err := json.Unmarshal([]byte(payload), &archived); err != nil || len(archived["desktop_scripts"]) != 1 {
		return errors.New("recycle bin entry is unreadable")
	}
	if present, err := desktopRowExists(tx, "desktop_scripts", entry.ResourceID); err != nil {
		return err
	} else if present {
		return errDesktopRecycleExists
	}
	if err := insertDesktopRow(tx, "desktop_scripts", archived["desktop_scripts"][0]); err != nil {
		return err
	}
	return recordDesktopConfiguration(tx, "script_created", "script", entry.ResourceID, entry.Name, "manual", []string{"restored"}, nil)
}

// A restored conversation is read-only history: it cannot resume tasks or
// carry execution authority, exactly like one received through sync.
func restoreDesktopAISession(ctx context.Context, tx *sql.Tx, entry DesktopRecycleBinEntry, payload string) error {
	var record desktopAISessionRecord
	if err := json.Unmarshal([]byte(payload), &record); err != nil || record.ID != entry.ResourceID {
		return errors.New("recycle bin entry is unreadable")
	}
	if present, err := desktopRowExists(tx, "desktop_ai_sessions", entry.ResourceID); err != nil {
		return err
	} else if present {
		return errDesktopRecycleExists
	}
	record.ExecutionOrigins = nil
	record.PermissionMode = DesktopAIPermissionReadonly
	record.Status = DesktopAISessionIdle
	record.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
	for i := range record.Messages {
		record.Messages[i].ExternalContent = true
	}
	if err := saveDesktopAISession(ctx, tx, record); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE desktop_ai_sessions SET config_space_id=? WHERE id=?`, record.ConfigSpaceID, record.ID)
	return err
}

// ListRecycleBin returns deleted records, newest first.
func (s *DesktopRetentionService) ListRecycleBin() ([]DesktopRecycleBinEntry, error) {
	database, err := s.tasks.database()
	if err != nil {
		return nil, err
	}
	rows, err := database.Query(`SELECT id,kind,resource_id,name,removed_at FROM desktop_recycle_bin ORDER BY removed_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []DesktopRecycleBinEntry{}
	for rows.Next() {
		var entry DesktopRecycleBinEntry
		if err = rows.Scan(&entry.ID, &entry.Kind, &entry.ResourceID, &entry.Name, &entry.RemovedAt); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

// RestoreRecycleBinEntry writes a record back under its original ID.
func (s *DesktopRetentionService) RestoreRecycleBinEntry(id string) (DesktopRecycleBinEntry, error) {
	var entry DesktopRecycleBinEntry
	database, err := s.tasks.database()
	if err != nil {
		return entry, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// Conversation bodies are files; writing them excludes backup and sync.
	if !desktopAISyncMu.TryLock() {
		return entry, errors.New("AI is busy; retry after the current operation")
	}
	defer desktopAISyncMu.Unlock()
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return entry, err
	}
	defer tx.Rollback()
	var payload string
	err = tx.QueryRow(`SELECT id,kind,resource_id,name,removed_at,payload FROM desktop_recycle_bin WHERE id=?`, id).Scan(&entry.ID, &entry.Kind, &entry.ResourceID, &entry.Name, &entry.RemovedAt, &payload)
	if errors.Is(err, sql.ErrNoRows) {
		return entry, errors.New("recycle bin entry not found")
	}
	if err != nil {
		return entry, err
	}
	switch entry.Kind {
	case desktopRecycleServer:
		err = restoreDesktopServer(tx, entry, payload)
	case desktopRecycleScript:
		err = restoreDesktopScript(tx, entry, payload)
	case desktopRecycleAISession:
		err = restoreDesktopAISession(ctx, tx, entry, payload)
	default:
		err = fmt.Errorf("recycle bin cannot restore %q", entry.Kind)
	}
	if err != nil {
		return entry, err
	}
	if _, err = tx.Exec(`DELETE FROM desktop_recycle_bin WHERE id=?`, id); err != nil {
		return entry, err
	}
	return entry, tx.Commit()
}

// DeleteRecycleBinEntry discards an entry for good.
func (s *DesktopRetentionService) DeleteRecycleBinEntry(id string) error {
	database, err := s.tasks.database()
	if err != nil {
		return err
	}
	result, err := database.Exec(`DELETE FROM desktop_recycle_bin WHERE id=?`, id)
	if err != nil {
		return err
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return errors.New("recycle bin entry not found")
	}
	return nil
}

func purgeDesktopRecycleBin(ctx context.Context, database *sql.DB, before time.Time) (int64, error) {
	result, err := database.ExecContext(ctx, `DELETE FROM desktop_recycle_bin WHERE removed_at<?`, before.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
