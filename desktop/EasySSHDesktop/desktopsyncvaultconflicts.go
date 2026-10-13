package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

func localVaultObject(tx *sql.Tx, space, kind, resource, id string) (string, error) {
	var storedKind, storedResource string
	if err := tx.QueryRow(`SELECT kind,resource_id FROM desktop_sync_objects WHERE space_id=? AND id=?`, space, id).Scan(&storedKind, &storedResource); err != nil {
		return "", err
	}
	if storedKind != kind || storedResource != resource {
		return "", errors.New("sync object belongs to another resource")
	}
	return localObject(tx, space, id)
}

func (s *DesktopSyncService) VaultConflicts() ([]syncdata.VaultConflict, error) {
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var space, rawScopes string
	err = tx.QueryRow(`SELECT p.id,p.scopes FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1`).Scan(&space, &rawScopes)
	if err == sql.ErrNoRows {
		return []syncdata.VaultConflict{}, nil
	}
	if err != nil {
		return nil, err
	}
	var scopes syncdata.SyncScopes
	if err = json.Unmarshal([]byte(rawScopes), &scopes); err != nil {
		return nil, err
	}
	rows, err := tx.Query(`SELECT kind,remote_id,conflicts FROM desktop_sync_vault WHERE space_id=?`, space)
	if err != nil {
		return nil, err
	}
	type entry struct{ kind, id, raw string }
	entries := []entry{}
	for rows.Next() {
		var e entry
		if err = rows.Scan(&e.kind, &e.id, &e.raw); err != nil {
			rows.Close()
			return nil, err
		}
		entries = append(entries, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	result := []syncdata.VaultConflict{}
	for _, e := range entries {
		if !scopes.Allows(e.kind) {
			continue
		}
		var conflicts []syncdata.VaultConflict
		if err = json.Unmarshal([]byte(e.raw), &conflicts); err != nil {
			return nil, err
		}
		for _, c := range conflicts {
			c.Key = "vault/" + e.kind + "/" + e.id
			c.Field = "ref"
			c.Previews = map[string]syncdata.VaultSummary{}
			for _, ref := range c.Values {
				value, err := localVaultObject(tx, space, e.kind, e.id, ref)
				if err != nil {
					return nil, err
				}
				p, err := syncdata.DecodeVault(value, e.kind)
				if err != nil {
					return nil, err
				}
				c.Previews[ref] = syncdata.Summarize(p)
			}
			result = append(result, c)
		}
	}
	return result, nil
}

func (s *DesktopSyncService) SessionCandidates() ([]DesktopSyncCandidate, error) {
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`SELECT a.id,a.title,COALESCE(v.space_id,''),COALESCE(p.account_name,''),COALESCE(p.server_url,'') FROM desktop_ai_sessions a LEFT JOIN desktop_sync_vault v ON v.kind='ai_session' AND v.local_id=a.id LEFT JOIN desktop_sync_spaces p ON p.id=v.space_id ORDER BY a.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []DesktopSyncCandidate{}
	for rows.Next() {
		var c DesktopSyncCandidate
		if err = rows.Scan(&c.Key, &c.Name, &c.SpaceID, &c.AccountName, &c.ServerURL); err != nil {
			return nil, err
		}
		c.Key = "ai_session/" + c.Key
		result = append(result, c)
	}
	return result, rows.Err()
}

func (s *DesktopSyncService) ForkVaultSession(spaceID, key, ref string) error {
	parts := strings.Split(key, "/")
	if len(parts) != 3 || parts[0] != "vault" || parts[1] != "ai_session" {
		return errors.New("invalid conversation selection")
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	if !desktopAISyncMu.TryLock() {
		return errors.New("AI is busy")
	}
	defer desktopAISyncMu.Unlock()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	original, err := s.readVault(tx, "ai_session", parts[2])
	if err != nil {
		return err
	}
	if original.SpaceID != spaceID {
		return errors.New("sync account changed")
	}
	value, err := localVaultObject(tx, spaceID, "ai_session", parts[2], ref)
	if err != nil {
		return err
	}
	p, err := syncdata.DecodeVault(value, "ai_session")
	if err != nil {
		return err
	}
	if p.Deleted {
		return errors.New("deleted conversation cannot be copied")
	}
	v := DesktopVaultState{SpaceID: spaceID, Kind: "ai_session", ID: uuid.NewString(), LocalID: uuid.NewString()}
	if err = s.applyLocalVault(tx, v, p); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO desktop_sync_vault(space_id,kind,remote_id,local_id) VALUES(?,?,?,?)`, v.SpaceID, v.Kind, v.ID, v.LocalID); err != nil {
		return err
	}
	return tx.Commit()
}
