package main

import (
	"database/sql"
	"encoding/json"

	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

func (s *DesktopAIService) configSpace(sessionID string) (string, error) {
	db, err := s.serversForSync()
	if err != nil {
		return "", err
	}
	var id string
	if sessionID != "" {
		err = db.QueryRow(`SELECT config_space_id FROM desktop_ai_sessions WHERE id=?`, sessionID).Scan(&id)
	} else {
		err = db.QueryRow(`SELECT space_id FROM desktop_sync_state WHERE id=1`).Scan(&id)
	}
	if err == sql.ErrNoRows || (err == nil && id == "") {
		return "local", nil
	}
	return id, err
}
func (s *DesktopAIService) serversForSync() (*sql.DB, error) { return s.serverService.database() }
func (s *DesktopAIService) loadSessionConfig(id string) (desktopAIConfigRecord, error) {
	space, err := s.configSpace(id)
	if err != nil {
		return desktopAIConfigRecord{}, err
	}
	return s.loadSpaceConfig(space)
}
func (s *DesktopAIService) enrollNewSyncSession(id string) error {
	db, err := s.serversForSync()
	if err != nil {
		return err
	}
	var space, raw string
	err = db.QueryRow(`SELECT p.id,p.scopes FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1`).Scan(&space, &raw)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	var scopes syncdata.SyncScopes
	if err = json.Unmarshal([]byte(raw), &scopes); err != nil {
		return err
	}
	if !scopes.Sessions {
		return nil
	}
	_, err = db.Exec(`INSERT INTO desktop_sync_vault(space_id,kind,remote_id,local_id) VALUES(?,'ai_session',?,?)`, space, uuid.NewString(), id)
	return err
}
