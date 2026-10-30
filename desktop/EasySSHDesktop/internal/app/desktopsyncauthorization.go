package app

import (
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

// Refresh only the currently bound device. Increasing the owner's grants never
// silently enables additional local data; narrowing them removes local selection.
func (s *DesktopSyncService) RefreshAuthorization() (protocol.SyncIdentity, error) {
	db, err := s.database()
	if err != nil {
		return protocol.SyncIdentity{}, err
	}
	var address, encrypted, space string
	var revision int64
	if err := db.QueryRow(`SELECT p.server_url,s.token,s.space_id,s.revision FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1 AND s.enabled=1`).Scan(&address, &encrypted, &space, &revision); err != nil {
		return protocol.SyncIdentity{}, errors.New("sync is not connected or enabled")
	}
	token, err := decryptDesktopCredential(encrypted, "desktop_sync_state", "1", "token")
	if err != nil {
		return protocol.SyncIdentity{}, err
	}
	data, err := syncRequest(address, token, "/device", nil)
	if err != nil {
		return protocol.SyncIdentity{}, err
	}
	var identity protocol.SyncIdentity
	if json.Unmarshal(data, &identity) != nil || identity.SpaceID.String() != space {
		return protocol.SyncIdentity{}, errors.New("invalid sync space identity")
	}
	if err := s.saveDeviceAuthorization(identity, revision); err != nil {
		return protocol.SyncIdentity{}, err
	}
	return identity, nil
}

func (s *DesktopSyncService) saveDeviceAuthorization(identity protocol.SyncIdentity, revision int64) error {
	if int(identity.Protocol) != syncdata.ConfigurationProtocol || identity.InstanceID == uuid.Nil || identity.UserID == uuid.Nil ||
		identity.SpaceID != uuid.NewSHA1(identity.InstanceID, []byte(identity.UserID.String())) {
		return errors.New("invalid sync space identity")
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
	var instance, owner, rawGrants, rawScopes string
	err = tx.QueryRow(`SELECT p.instance_id,p.user_id,s.grants,p.scopes FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1 AND s.enabled=1 AND s.space_id=? AND s.revision=?`, identity.SpaceID.String(), revision).Scan(&instance, &owner, &rawGrants, &rawScopes)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("sync configuration changed; retry")
	}
	if err != nil {
		return err
	}
	if instance != identity.InstanceID.String() || owner != identity.UserID.String() {
		return errors.New("sync source identity changed")
	}
	var previous, selected syncdata.SyncScopes
	if err := json.Unmarshal([]byte(rawGrants), &previous); err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(rawScopes), &selected); err != nil {
		return err
	}
	grants := syncdata.SyncScopes{Credentials: identity.Grants.Credentials, AIConfig: identity.Grants.AIConfig, Sessions: identity.Grants.Sessions}
	if grants == previous {
		return tx.Commit()
	}
	result, err := tx.Exec(`UPDATE desktop_sync_state SET grants=?,revision=revision+1 WHERE id=1 AND enabled=1 AND space_id=? AND revision=?`, syncdata.JSON(grants), identity.SpaceID.String(), revision)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("sync configuration changed; retry")
	}
	if _, err := tx.Exec(`UPDATE desktop_sync_spaces SET scopes=? WHERE id=?`, syncdata.JSON(selected.Intersect(grants)), identity.SpaceID.String()); err != nil {
		return err
	}
	if err := recordDesktopConfiguration(tx, "sync_grants_updated", "sync_space", identity.SpaceID.String(), identity.AccountName, "automation", []string{"grants", "scopes"}, nil); err != nil {
		return err
	}
	return tx.Commit()
}
