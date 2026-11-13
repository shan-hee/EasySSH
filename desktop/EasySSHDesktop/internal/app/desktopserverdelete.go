package app

import (
	"database/sql"
	"errors"
)

// Keep sync-record mappings so the configuration document can propagate the
// local deletion. Credential versions are no longer needed after that deletion.
func deleteDesktopServer(tx *sql.Tx, id string) error {
	var count int
	if err := tx.QueryRow("SELECT COUNT(*) FROM desktop_servers WHERE jump_server_id=?", id).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return errors.New("server is used as a jump host; remove its references first")
	}
	if err := archiveDesktopServer(tx, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM desktop_sync_objects WHERE kind='credential' AND EXISTS (
  SELECT 1 FROM desktop_sync_records r WHERE r.kind='server' AND r.local_id=?
  AND r.space_id=desktop_sync_objects.space_id AND r.remote_id=desktop_sync_objects.resource_id
 )`, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM desktop_sync_vault WHERE kind='credential' AND local_id=?`, id); err != nil {
		return err
	}
	result, err := tx.Exec("DELETE FROM desktop_servers WHERE id=?", id)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted == 0 {
		return sql.ErrNoRows
	}
	return nil
}
