package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

type DesktopVaultEntry struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name"`
}
type DesktopVaultState struct {
	SpaceID         string            `json:"space_id"`
	Kind            string            `json:"kind"`
	ID              string            `json:"id"`
	LocalID         string            `json:"-"`
	Document        string            `json:"document"`
	Heads           []string          `json:"heads"`
	CurrentRef      string            `json:"-"`
	AppliedRef      string            `json:"-"`
	ObservedRef     string            `json:"-"`
	Snapshot        syncdata.Snapshot `json:"snapshot"`
	Revision        int64             `json:"revision"`
	BindingRevision int64             `json:"binding_revision"`
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
func (s *DesktopSyncService) vaultRequest(space string, binding int64, path string, payload []byte) ([]byte, error) {
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	var address, encrypted string
	if err = db.QueryRow(`SELECT p.server_url,s.token FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1 AND s.enabled=1 AND s.space_id=? AND s.revision=?`, space, binding).Scan(&address, &encrypted); err != nil {
		return nil, err
	}
	token, err := decryptDesktopCredential(encrypted, "desktop_sync_state", "1", "token")
	if err != nil {
		return nil, err
	}
	return syncRequest(address, token, "/device/vault"+path, payload)
}
func (s *DesktopSyncService) VaultList() ([]DesktopVaultEntry, error) {
	state, err := s.Load()
	if err != nil {
		return nil, err
	}
	if !state.Enabled {
		return []DesktopVaultEntry{}, nil
	}
	data, err := s.vaultRequest(state.SpaceID, state.Revision, "", nil)
	if err != nil {
		return nil, err
	}
	var remote []DesktopVaultEntry
	if err = json.Unmarshal(data, &remote); err != nil {
		return nil, err
	}
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	if state.Scopes.Credentials {
		rows, e := db.Query(`SELECT remote_id FROM desktop_sync_records WHERE space_id=? AND kind='server' AND local_id IN (SELECT id FROM desktop_servers)`, state.SpaceID)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var id string
			if e = rows.Scan(&id); e != nil {
				rows.Close()
				return nil, e
			}
			remote = append(remote, DesktopVaultEntry{Kind: "credential", ID: id})
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
	}
	if state.Scopes.AIConfig {
		remote = append(remote, DesktopVaultEntry{Kind: "ai_config", ID: syncdata.AIConfigID})
	}
	for _, entry := range remote {
		if !state.Scopes.Allows(entry.Kind) {
			continue
		}
		localID := ""
		if entry.Kind == "ai_session" {
			localID = uuid.NewString()
		}
		if entry.Kind == "credential" {
			if err = db.QueryRow(`SELECT local_id FROM desktop_sync_records WHERE space_id=? AND kind='server' AND remote_id=?`, state.SpaceID, entry.ID).Scan(&localID); err == sql.ErrNoRows {
				continue
			} else if err != nil {
				return nil, err
			}
		}
		if _, err = db.Exec(`INSERT OR IGNORE INTO desktop_sync_vault(space_id,kind,remote_id,local_id) VALUES(?,?,?,?)`, state.SpaceID, entry.Kind, entry.ID, localID); err != nil {
			return nil, err
		}
	}
	rows, err := db.Query(`SELECT kind,remote_id,local_id FROM desktop_sync_vault v WHERE space_id=? AND (kind<>'credential' OR EXISTS(SELECT 1 FROM desktop_servers s WHERE s.id=v.local_id)) ORDER BY kind,remote_id`, state.SpaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []DesktopVaultEntry{}
	for rows.Next() {
		var entry DesktopVaultEntry
		var localID string
		if err = rows.Scan(&entry.Kind, &entry.ID, &localID); err != nil {
			return nil, err
		}
		if state.Scopes.Allows(entry.Kind) {
			result = append(result, entry)
		}
	}
	return result, rows.Err()
}
func (s *DesktopSyncService) readVault(tx *sql.Tx, kind, id string) (DesktopVaultState, error) {
	var v DesktopVaultState
	v.Kind = kind
	v.ID = id
	var scopes, heads string
	err := tx.QueryRow(`SELECT s.space_id,s.revision,p.scopes FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1 AND s.token<>'' AND s.enabled=1`).Scan(&v.SpaceID, &v.BindingRevision, &scopes)
	if err != nil {
		return v, err
	}
	var enabled syncdata.SyncScopes
	if err = json.Unmarshal([]byte(scopes), &enabled); err != nil {
		return v, err
	}
	if !enabled.Allows(kind) {
		return v, errors.New("sync scope is disabled")
	}
	err = tx.QueryRow(`SELECT local_id,document,current_ref,observed_ref,applied_ref,heads,revision FROM desktop_sync_vault WHERE space_id=? AND kind=? AND remote_id=?`, v.SpaceID, kind, id).Scan(&v.LocalID, &v.Document, &v.CurrentRef, &v.ObservedRef, &v.AppliedRef, &heads, &v.Revision)
	if err != nil {
		return v, err
	}
	err = json.Unmarshal([]byte(heads), &v.Heads)
	return v, err
}
func (s *DesktopSyncService) putLocalObject(tx *sql.Tx, space, kind, id, resource, value string, uploaded bool) error {
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
	_, err = tx.Exec(`INSERT INTO desktop_sync_objects(space_id,id,kind,resource_id,ciphertext,uploaded) VALUES(?,?,?,?,?,?)`, space, id, kind, resource, encrypted, uploaded)
	return err
}
func localObject(tx *sql.Tx, space, id string) (string, error) {
	var encrypted string
	if err := tx.QueryRow(`SELECT ciphertext FROM desktop_sync_objects WHERE space_id=? AND id=?`, space, id).Scan(&encrypted); err != nil {
		return "", err
	}
	return decryptDesktopCredential(encrypted, "desktop_sync_objects", space+":"+id, "value")
}
func (s *DesktopSyncService) PrepareVault(kind, id string) (DesktopVaultState, error) {
	db, err := s.database()
	if err != nil {
		return DesktopVaultState{}, err
	}
	if kind != "credential" {
		if !desktopAISyncMu.TryLock() {
			return DesktopVaultState{}, errors.New("AI is busy; retry after the current operation")
		}
		defer desktopAISyncMu.Unlock()
	}
	tx, err := db.Begin()
	if err != nil {
		return DesktopVaultState{}, err
	}
	defer tx.Rollback()
	v, err := s.readVault(tx, kind, id)
	if err != nil {
		return v, err
	}
	p, err := s.captureLocalVault(tx, v)
	if err != nil {
		return v, err
	}
	if p != nil {
		if err = p.Validate(kind); err != nil {
			return v, err
		}
		value := syncdata.JSON(p)
		if len(value) > 12<<20 {
			return v, errors.New("sync payload too large")
		}
		old := ""
		if v.ObservedRef != "" {
			old, err = localObject(tx, v.SpaceID, v.ObservedRef)
			if err != nil {
				return v, err
			}
		}
		if !syncdata.SameVaultValue(old, value) {
			ref := uuid.NewString()
			if err = s.putLocalObject(tx, v.SpaceID, kind, ref, id, value, false); err != nil {
				return v, err
			}
			v.ObservedRef = ref
			v.AppliedRef = ref
			v.CurrentRef = ref
		}
	}
	v.Snapshot = syncdata.Snapshot{}
	if v.CurrentRef != "" {
		v.Snapshot[syncdata.ValueKey] = syncdata.Record{"ref": v.CurrentRef}
	}
	v.Revision++
	_, err = tx.Exec(`UPDATE desktop_sync_vault SET current_ref=?,observed_ref=?,applied_ref=?,revision=? WHERE space_id=? AND kind=? AND remote_id=?`, v.CurrentRef, v.ObservedRef, v.AppliedRef, v.Revision, v.SpaceID, kind, id)
	if err != nil {
		return v, err
	}
	return v, tx.Commit()
}

type DesktopVaultSave struct {
	Kind            string                   `json:"kind"`
	ID              string                   `json:"id"`
	SpaceID         string                   `json:"space_id"`
	BindingRevision int64                    `json:"binding_revision"`
	Revision        int64                    `json:"revision"`
	Document        string                   `json:"document"`
	Heads           []string                 `json:"heads"`
	Snapshot        syncdata.Snapshot        `json:"snapshot"`
	Conflicts       []syncdata.VaultConflict `json:"conflicts"`
}

func (s *DesktopSyncService) SaveVault(input DesktopVaultSave) (bool, error) {
	if len(input.Document) > 8<<20 {
		return false, errors.New("conversation sync history too large")
	}
	db, err := s.database()
	if err != nil {
		return false, err
	}
	if input.Kind != "credential" {
		if !desktopAISyncMu.TryLock() {
			return false, nil
		}
		defer desktopAISyncMu.Unlock()
	}
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	v, err := s.readVault(tx, input.Kind, input.ID)
	if err != nil {
		return false, err
	}
	if v.SpaceID != input.SpaceID || v.BindingRevision != input.BindingRevision || v.Revision != input.Revision {
		return false, nil
	}
	current, err := s.captureLocalVault(tx, v)
	if err != nil {
		return false, err
	}
	if current != nil {
		observed := ""
		if v.ObservedRef != "" {
			observed, err = localObject(tx, v.SpaceID, v.ObservedRef)
			if err != nil {
				return false, err
			}
		}
		if !syncdata.SameVaultValue(syncdata.JSON(current), observed) {
			return false, nil
		}
	}
	applied := false
	ref := v.CurrentRef
	if input.Snapshot != nil {
		if err := syncdata.Validate(input.Snapshot); err != nil {
			return false, err
		}
		if len(input.Snapshot) > 1 {
			return false, errors.New("invalid vault projection")
		}
		for key := range input.Snapshot {
			if key != syncdata.ValueKey {
				return false, errors.New("invalid vault projection")
			}
		}
		ref = input.Snapshot[syncdata.ValueKey]["ref"]
		if ref != "" && len(input.Conflicts) == 0 && ref != v.AppliedRef {
			value, err := localVaultObject(tx, v.SpaceID, v.Kind, v.ID, ref)
			if err != nil {
				return false, err
			}
			p, err := syncdata.DecodeVault(value, v.Kind)
			if err != nil {
				return false, err
			}
			if err = s.applyLocalVault(tx, v, p); err != nil {
				return false, err
			}
			applied = true
			v.AppliedRef = ref
			v.ObservedRef = ref
			observed, err := s.captureLocalVault(tx, v)
			if err != nil {
				return false, err
			}
			if observed != nil && syncdata.JSON(observed) != value {
				v.ObservedRef = uuid.NewString()
				if err = s.putLocalObject(tx, v.SpaceID, v.Kind, v.ObservedRef, v.ID, syncdata.JSON(observed), true); err != nil {
					return false, err
				}
			}
		}
	}
	_, err = tx.Exec(`UPDATE desktop_sync_vault SET document=?,heads=?,current_ref=?,observed_ref=?,applied_ref=?,conflicts=?,revision=revision+1 WHERE space_id=? AND kind=? AND remote_id=?`, input.Document, syncdata.JSON(input.Heads), ref, v.ObservedRef, v.AppliedRef, syncdata.JSON(input.Conflicts), v.SpaceID, v.Kind, v.ID)
	if err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	if applied && v.Kind == "credential" {
		_ = s.sftp.CloseConnection(v.LocalID)
	}
	return true, nil
}
func (s *DesktopSyncService) ExchangeVault(kind, id, peer string, space string, binding int64) (string, error) {
	state, err := s.Load()
	if err != nil {
		return "", err
	}
	if state.SpaceID != space || state.Revision != binding || !state.Scopes.Allows(kind) {
		return "", errors.New("sync account or scope changed")
	}
	db, err := s.database()
	if err != nil {
		return "", err
	}
	rows, err := db.Query(`SELECT id,kind,resource_id,ciphertext FROM desktop_sync_objects WHERE space_id=? AND uploaded=0 AND ((resource_id=? AND kind=?) OR (?='ai_session' AND kind='attachment')) ORDER BY CASE WHEN kind='attachment' THEN 0 ELSE 1 END`, space, id, kind, kind)
	if err != nil {
		return "", err
	}
	type object struct{ ID, Kind, Resource, Ciphertext string }
	pending := []object{}
	for rows.Next() {
		var o object
		if err = rows.Scan(&o.ID, &o.Kind, &o.Resource, &o.Ciphertext); err != nil {
			rows.Close()
			return "", err
		}
		pending = append(pending, o)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return "", err
	}
	for _, o := range pending {
		plain, err := decryptDesktopCredential(o.Ciphertext, "desktop_sync_objects", space+":"+o.ID, "value")
		if err != nil {
			return "", err
		}
		payload, _ := json.Marshal(map[string]string{"kind": o.Kind, "resource_id": o.Resource, "value": plain})
		if _, err = s.vaultRequest(space, binding, "/objects/"+o.ID, payload); err != nil {
			return "", err
		}
		if _, err = db.Exec(`UPDATE desktop_sync_objects SET uploaded=1 WHERE space_id=? AND id=?`, space, o.ID); err != nil {
			return "", err
		}
	}
	data, err := s.vaultRequest(space, binding, "/documents/"+kind+"/"+id, []byte(`{"peer":`+peer+`}`))
	if err != nil {
		return "", err
	}
	var result struct {
		Response  json.RawMessage   `json:"response"`
		Snapshot  syncdata.Snapshot `json:"snapshot"`
		Conflicts []struct {
			Values []string `json:"values"`
		} `json:"conflicts"`
	}
	if err = json.Unmarshal(data, &result); err != nil {
		return "", err
	}
	refs := []string{result.Snapshot[syncdata.ValueKey]["ref"]}
	for _, c := range result.Conflicts {
		refs = append(refs, c.Values...)
	}
	seen := map[string]bool{}
	for _, ref := range refs {
		if ref == "" || seen[ref] {
			continue
		}
		seen[ref] = true
		value, err := s.downloadObject(space, binding, kind, id, ref)
		if err != nil {
			return "", err
		}
		p, err := syncdata.DecodeVault(value, kind)
		if err != nil {
			return "", err
		}
		if p.Conversation != nil {
			for _, m := range p.Conversation.Messages {
				for _, a := range m.Attachments {
					aid := strings.TrimPrefix(a.Data, "sync-attachment:")
					if _, err = s.downloadObject(space, binding, "attachment", id, aid); err != nil {
						return "", err
					}
				}
			}
		}
	}
	return string(result.Response), nil
}
func (s *DesktopSyncService) downloadObject(space string, binding int64, kind, resource, id string) (string, error) {
	db, err := s.database()
	if err != nil {
		return "", err
	}
	var encrypted string
	err = db.QueryRow(`SELECT ciphertext FROM desktop_sync_objects WHERE space_id=? AND id=?`, space, id).Scan(&encrypted)
	if err == nil {
		return decryptDesktopCredential(encrypted, "desktop_sync_objects", space+":"+id, "value")
	}
	if err != sql.ErrNoRows {
		return "", err
	}
	data, err := s.vaultRequest(space, binding, "/objects/"+id, nil)
	if err != nil {
		return "", err
	}
	var response struct {
		Value string `json:"value"`
	}
	if err = json.Unmarshal(data, &response); err != nil {
		return "", err
	}
	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if err = s.putLocalObject(tx, space, kind, id, resource, response.Value, true); err != nil {
		return "", err
	}
	return response.Value, tx.Commit()
}
