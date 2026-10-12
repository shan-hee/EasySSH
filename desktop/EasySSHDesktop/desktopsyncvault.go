package main

import (
	"database/sql"
	"errors"
	"github.com/easyssh/shared/syncdata"
)

type DesktopVaultState struct {
	SpaceID     string
	Kind        string
	ID          string
	LocalID     string
	ObservedRef string
}

func (s *DesktopSyncService) SetScopes(scopes syncdata.SyncScopes) error {
	state, err := s.Load()
	if err != nil {
		return err
	}
	if (scopes.Credentials && !state.Grants.Credentials) || (scopes.AIConfig && !state.Grants.AIConfig) || (scopes.Sessions && !state.Grants.Sessions) {
		return errors.New("reauthorize this device to enable this sync scope")
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var space string
	if err = tx.QueryRow(`SELECT space_id FROM desktop_sync_state WHERE id=1 AND token<>'' AND space_id=? AND revision=?`, state.SpaceID, state.Revision).Scan(&space); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE desktop_sync_spaces SET scopes=? WHERE id=?`, syncdata.JSON(scopes), space); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE desktop_sync_state SET revision=revision+1 WHERE id=1`); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *DesktopSyncService) putLocalObject(tx *sql.Tx, space, kind, id, resource, value string) error {
	var old string
	err := tx.QueryRow(`SELECT ciphertext FROM desktop_sync_objects WHERE space_id=? AND id=?`, space, id).Scan(&old)
	if err == nil {
		plain, e := decryptDesktopCredential(old, "desktop_sync_objects", space+":"+id, "value")
		if e != nil {
			return e
		}
		if plain != value {
			return errors.New("immutable sync object changed")
		}
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	encrypted, err := encryptDesktopCredential(value, "desktop_sync_objects", space+":"+id, "value")
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO desktop_sync_objects(space_id,id,kind,resource_id,ciphertext) VALUES(?,?,?,?,?)`, space, id, kind, resource, encrypted)
	return err
}
func localObject(tx *sql.Tx, space, id string) (string, error) {
	var encrypted string
	if err := tx.QueryRow(`SELECT ciphertext FROM desktop_sync_objects WHERE space_id=? AND id=?`, space, id).Scan(&encrypted); err != nil {
		return "", err
	}
	return decryptDesktopCredential(encrypted, "desktop_sync_objects", space+":"+id, "value")
}
