package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/easyssh/shared/scriptutil"
	"github.com/easyssh/shared/servergroup"
	"github.com/easyssh/shared/syncdata"
	"github.com/easyssh/shared/syncengine"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type DesktopSyncService struct {
	servers *DesktopServerService
	scripts *DesktopScriptService
	sftp    *DesktopSFTPService
	ai      *DesktopAIService
	syncMu  sync.Mutex
	authMu  sync.Mutex
	pending *desktopSyncAuthorization
}

func NewDesktopSyncService(servers *DesktopServerService, scripts *DesktopScriptService, sftp *DesktopSFTPService, ai *DesktopAIService) *DesktopSyncService {
	return &DesktopSyncService{servers: servers, scripts: scripts, sftp: sftp, ai: ai}
}
func (s *DesktopSyncService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	_, err := s.database()
	return err
}
func (s *DesktopSyncService) database() (*sql.DB, error) {
	db, err := s.servers.database()
	if err != nil {
		return nil, err
	}
	if _, err = s.scripts.database(); err != nil {
		return nil, err
	}
	if _, err = s.ai.database(); err != nil {
		return nil, err
	}
	return db, nil
}

type DesktopSyncState struct {
	ServerURL   string              `json:"server_url"`
	SpaceID     string              `json:"space_id"`
	AccountName string              `json:"account_name"`
	Scopes      syncdata.SyncScopes `json:"scopes"`
	Grants      syncdata.SyncScopes `json:"grants"`
	Enabled     bool                `json:"enabled"`
	Document    string              `json:"-"`
	LastSync    string              `json:"last_sync"`
	Revision    int64               `json:"revision"`
	Snapshot    syncdata.Snapshot   `json:"snapshot"`
	Hash        string              `json:"hash"`
	// Conflicts are the configuration conflicts awaiting a choice.
	Conflicts []syncengine.Conflict `json:"conflicts"`
}
type desktopSyncQuery interface {
	Query(string, ...any) (*sql.Rows, error)
}

func desktopSyncSnapshot(db desktopSyncQuery, spaceID string) (syncdata.Snapshot, map[string]string, error) {
	snapshot := syncdata.Snapshot{}
	order := []string{}
	ids := map[string]string{}
	rows, err := db.Query(`SELECT s.id,m.remote_id,s.name,s.host,s.port,s.username,s.auth_method,COALESCE(gm.remote_id,''),COALESCE(s.group_id,''),s.tags_json,s.description,COALESCE(k.id,''),COALESCE(k.name,''),COALESCE(k.public_key,''),COALESCE(k.fingerprint,''),COALESCE(k.algorithm,''),COALESCE(k.key_size,0),COALESCE(s.jump_server_id,''),COALESCE(jm.remote_id,'') FROM desktop_server_details s LEFT JOIN desktop_ssh_keys k ON k.id=s.ssh_key_id LEFT JOIN desktop_sync_records jm ON jm.kind='server' AND jm.local_id=s.jump_server_id AND jm.space_id=? LEFT JOIN desktop_sync_records gm ON gm.kind='group' AND gm.local_id=s.group_id AND gm.space_id=? JOIN desktop_sync_records m ON m.kind='server' AND m.local_id=s.id WHERE m.space_id=? ORDER BY s.sort_order ASC,s.created_at ASC,s.id ASC`, spaceID, spaceID, spaceID)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var id, remoteID, name, host, username, method, groupID, localGroupID, tags, description string
		var port int
		var localJumpID, jumpID string
		var keyRef syncdata.KeyReference
		if err = rows.Scan(&id, &remoteID, &name, &host, &port, &username, &method, &groupID, &localGroupID, &tags, &description, &keyRef.ID, &keyRef.Name, &keyRef.PublicKey, &keyRef.Fingerprint, &keyRef.Algorithm, &keyRef.KeySize, &localJumpID, &jumpID); err != nil {
			rows.Close()
			return nil, nil, err
		}
		order = append(order, remoteID)
		key := "server/" + remoteID
		ids[key] = id
		connection := syncdata.Connection{Host: host, Port: port, Username: username, AuthMethod: method, JumpServerID: jumpID}
		if localJumpID != "" && jumpID == "" {
			rows.Close()
			return nil, nil, errors.New("enroll the jump host in the same sync space before syncing this server")
		}
		if keyRef.ID != "" {
			connection.Key = &keyRef
		}
		if localGroupID != "" && groupID == "" {
			rows.Close()
			return nil, nil, errors.New("server group is not enrolled in the sync space")
		}
		snapshot[key] = syncdata.Record{"name": name, "connection": syncdata.JSON(connection), "group_id": groupID, "tags": syncdata.JSON(syncdata.Tags(tags)), "description": description}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	rows, err = db.Query(`SELECT g.id,m.remote_id,g.name,g.sort_order FROM desktop_server_groups g JOIN desktop_sync_records m ON m.kind='group' AND m.local_id=g.id WHERE m.space_id=?`, spaceID)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var localID string
		var group protocol.ServerGroup
		if err = rows.Scan(&localID, &group.ID, &group.Name, &group.SortOrder); err != nil {
			rows.Close()
			return nil, nil, err
		}
		key := "group/" + group.ID
		ids[key] = localID
		snapshot[key] = syncdata.GroupRecord(group)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	snapshot[syncdata.ServerOrderKey] = syncdata.Record{"ids": syncdata.JSON(order)}
	rows, err = db.Query(`SELECT s.id,m.remote_id,s.name,s.content,s.language,s.tags_json,s.description FROM desktop_scripts s JOIN desktop_sync_records m ON m.kind='script' AND m.local_id=s.id WHERE m.space_id=?`, spaceID)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var id, remoteID, name, content, language, tags, description string
		if err = rows.Scan(&id, &remoteID, &name, &content, &language, &tags, &description); err != nil {
			rows.Close()
			return nil, nil, err
		}
		key := "script/" + remoteID
		ids[key] = id
		snapshot[key] = syncdata.Record{"name": name, "content": content, "language": language, "tags": syncdata.JSON(syncdata.Tags(tags)), "description": description}
	}
	err = rows.Err()
	rows.Close()
	return snapshot, ids, err
}
func (s *DesktopSyncService) Load() (DesktopSyncState, error) {
	var result DesktopSyncState
	db, err := s.database()
	if err != nil {
		return result, err
	}
	tx, err := db.Begin()
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	var scopes, grants string
	err = tx.QueryRow(`SELECT COALESCE(p.server_url,''),s.space_id,COALESCE(p.account_name,''),COALESCE(p.scopes,'{}'),s.grants,s.enabled,COALESCE(p.document,''),COALESCE(p.last_sync,''),s.revision FROM desktop_sync_state s LEFT JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1`).Scan(&result.ServerURL, &result.SpaceID, &result.AccountName, &scopes, &grants, &result.Enabled, &result.Document, &result.LastSync, &result.Revision)
	if err != nil {
		return result, err
	}
	inspected, err := syncengine.Inspect(result.Document)
	if err != nil {
		return result, err
	}
	result.Conflicts = inspected.Conflicts
	if err = json.Unmarshal([]byte(scopes), &result.Scopes); err != nil {
		return result, err
	}
	if err = json.Unmarshal([]byte(grants), &result.Grants); err != nil {
		return result, err
	}
	if result.SpaceID == "" {
		result.Snapshot = syncdata.Snapshot{}
		return result, tx.Commit()
	}
	result.Snapshot, _, err = desktopSyncSnapshot(tx, result.SpaceID)
	if err != nil {
		return result, err
	}
	result.Hash = syncdata.Hash(result.Snapshot)
	return result, tx.Commit()
}
func syncURL(raw string) (string, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(raw), "/"))
	if err != nil {
		return "", err
	}
	if u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("enter the server origin, for example https://ssh.example.com")
	}
	loopback := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return "", errors.New("sync requires HTTPS (HTTP is allowed only on localhost)")
	}
	return strings.TrimRight(u.String(), "/"), nil
}
func syncRequest(serverURL, token, path string, payload []byte) ([]byte, error) {
	method := http.MethodGet
	var body io.Reader
	if payload != nil {
		method = http.MethodPost
		body = bytes.NewReader(payload)
	}
	req, err := http.NewRequest(method, serverURL+"/api/v1/sync"+path, body)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 35 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, syncdata.MaxExchangeResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > syncdata.MaxExchangeResponseBytes {
		return nil, errors.New("sync response is too large")
	}
	if response.StatusCode != 200 {
		var detail struct {
			Message string `json:"message"`
			Error   string `json:"error"`
		}
		_ = json.Unmarshal(data, &detail)
		return nil, fmt.Errorf("sync HTTP %d: %s %s", response.StatusCode, detail.Error, detail.Message)
	}
	return data, nil
}

// A new authorization is a new replica. After this device or the server was
// restored from a backup, the request sequence stored in the documents no
// longer continues the server's receipts and every write would be rejected.
func resetDesktopSyncReplica(tx *sql.Tx, spaceID string) error {
	var document string
	if err := tx.QueryRow(`SELECT document FROM desktop_sync_spaces WHERE id=?`, spaceID).Scan(&document); err != nil {
		return err
	}
	detached, err := syncengine.Detach(document)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE desktop_sync_spaces SET document=? WHERE id=?`, detached, spaceID); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT kind,remote_id,document FROM desktop_sync_vault WHERE space_id=?`, spaceID)
	if err != nil {
		return err
	}
	type entry struct{ kind, id, document string }
	var entries []entry
	for rows.Next() {
		var e entry
		if err = rows.Scan(&e.kind, &e.id, &e.document); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, e)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, e := range entries {
		if detached, err = syncengine.Detach(e.document); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE desktop_sync_vault SET document=? WHERE space_id=? AND kind=? AND remote_id=?`, detached, spaceID, e.kind, e.id); err != nil {
			return err
		}
	}
	return nil
}

func (s *DesktopSyncService) connect(serverURL, token string) error {
	address, err := syncURL(serverURL)
	if err != nil {
		return err
	}
	token = strings.TrimSpace(token)
	if !strings.HasPrefix(token, "ess_sync_") || len(token) != 73 {
		return errors.New("invalid sync device token")
	}
	data, err := syncRequest(address, token, "/device", nil)
	if err != nil {
		return err
	}
	var identity struct {
		SpaceID     string              `json:"space_id"`
		Protocol    int                 `json:"protocol"`
		Grants      syncdata.SyncScopes `json:"grants"`
		InstanceID  string              `json:"instance_id"`
		UserID      string              `json:"user_id"`
		AccountName string              `json:"account_name"`
	}
	if json.Unmarshal(data, &identity) != nil || identity.Protocol != syncdata.ConfigurationProtocol {
		return errors.New("unsupported sync protocol")
	}
	if _, err = uuid.Parse(identity.SpaceID); err != nil {
		return err
	}
	encrypted, err := encryptDesktopCredential(token, "desktop_sync_state", "1", "token")
	if err != nil {
		return err
	}
	db, err := s.database()
	if err != nil {
		return err
	}
	instance, err := uuid.Parse(identity.InstanceID)
	if err != nil {
		return err
	}
	user, err := uuid.Parse(identity.UserID)
	if err != nil {
		return err
	}
	if uuid.NewSHA1(instance, []byte(user.String())).String() != identity.SpaceID {
		return errors.New("invalid sync space identity")
	}
	if !desktopAISyncMu.TryLock() {
		return errors.New("AI is busy; retry login after the current operation")
	}
	defer desktopAISyncMu.Unlock()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE desktop_sync_state SET space_id=?,token=?,grants=?,enabled=1,revision=revision+1 WHERE id=1 AND space_id=''`, identity.SpaceID, encrypted, syncdata.JSON(identity.Grants))
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return errors.New("disconnect the current account first")
	}
	_, err = tx.Exec(`INSERT INTO desktop_sync_spaces(id,instance_id,user_id,account_name,server_url) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_name=excluded.account_name,server_url=excluded.server_url`, identity.SpaceID, identity.InstanceID, identity.UserID, identity.AccountName, address)
	if err != nil {
		return err
	}
	if err = resetDesktopSyncReplica(tx, identity.SpaceID); err != nil {
		return err
	}
	var rawScopes string
	if err = tx.QueryRow(`SELECT scopes FROM desktop_sync_spaces WHERE id=?`, identity.SpaceID).Scan(&rawScopes); err != nil {
		return err
	}
	var scopes syncdata.SyncScopes
	if err = json.Unmarshal([]byte(rawScopes), &scopes); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE desktop_sync_spaces SET scopes=? WHERE id=?`, syncdata.JSON(scopes.Intersect(identity.Grants)), identity.SpaceID); err != nil {
		return err
	}
	if err = recordDesktopConfiguration(tx, "sync_connected", "sync_space", identity.SpaceID, identity.AccountName, "manual", []string{"connection", "grants", "enabled"}, nil); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *DesktopSyncService) SetEnabled(enabled bool) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var space, name string
	var current bool
	if err = tx.QueryRow(`SELECT s.space_id,p.account_name,s.enabled FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1 AND s.token<>''`).Scan(&space, &name, &current); err != nil {
		return err
	}
	if current == enabled {
		return tx.Commit()
	}
	if _, err = tx.Exec(`UPDATE desktop_sync_state SET enabled=?,revision=revision+1 WHERE id=1`, enabled); err != nil {
		return err
	}
	if err = recordDesktopConfiguration(tx, "sync_enabled_changed", "sync_space", space, name, "manual", []string{"enabled"}, nil); err != nil {
		return err
	}
	return tx.Commit()
}

// Disconnect preserves each space's document and ownership, including offline edits.
// An offline logout still removes the local credential; the UI reports whether
// remote revocation succeeded so it can be retried from the Web device list.
func (s *DesktopSyncService) Disconnect() (bool, error) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	s.pending = nil
	db, err := s.database()
	if err != nil {
		return false, err
	}
	if !desktopAISyncMu.TryLock() {
		return false, errors.New("AI is busy; retry logout after the current operation")
	}
	defer desktopAISyncMu.Unlock()
	var address, encrypted, space, name string
	var revision int64
	err = db.QueryRow(`SELECT p.server_url,s.token,s.revision,s.space_id,p.account_name FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1`).Scan(&address, &encrypted, &revision, &space, &name)
	if err == sql.ErrNoRows {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	token, revokeErr := decryptDesktopCredential(encrypted, "desktop_sync_state", "1", "token")
	if revokeErr == nil {
		_, revokeErr = syncRequest(address, token, "/device/disconnect", []byte(`{}`))
	}
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE desktop_sync_state SET space_id='',token='',grants='{}',enabled=0,revision=revision+1 WHERE id=1 AND revision=?`, revision)
	if err != nil {
		return false, err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return false, errors.New("sync changed; retry logout")
	}
	if err = recordDesktopConfiguration(tx, "sync_disconnected", "sync_space", space, name, "manual", []string{"connection", "grants", "enabled"}, nil); err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	return revokeErr == nil, nil
}

// decodeSyncResponse extracts the hub's answer from an exchange envelope. An
// envelope without one must fail: treating it as an empty answer would silently
// apply no changes.
func decodeSyncResponse(data []byte) (syncengine.Peer, error) {
	var envelope struct {
		Response *syncengine.Peer `json:"response"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil || envelope.Response == nil {
		return syncengine.Peer{}, errors.New("invalid sync response")
	}
	return *envelope.Response, nil
}

func (s *DesktopSyncService) exchange(peer syncengine.Peer, revision int64) (syncengine.Peer, error) {
	payload, err := json.Marshal(peer)
	if err != nil {
		return syncengine.Peer{}, err
	}
	if len(payload) > syncdata.MaxExchangeRequestBytes {
		return syncengine.Peer{}, errors.New("sync payload is too large")
	}
	if _, err := s.RefreshAuthorization(); err != nil {
		return syncengine.Peer{}, err
	}
	db, err := s.database()
	if err != nil {
		return syncengine.Peer{}, err
	}
	var address, encrypted string
	if err = db.QueryRow(`SELECT p.server_url,s.token FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1 AND s.enabled=1 AND s.revision=?`, revision).Scan(&address, &encrypted); err != nil {
		return syncengine.Peer{}, errors.New("sync configuration changed; retry")
	}
	token, err := decryptDesktopCredential(encrypted, "desktop_sync_state", "1", "token")
	if err != nil {
		return syncengine.Peer{}, err
	}
	data, err := syncRequest(address, token, "/device/exchange", payload)
	if err != nil {
		return syncengine.Peer{}, err
	}
	return decodeSyncResponse(data)
}

type DesktopSyncSave struct {
	Revision int64
	Hash     string
	Document string
	Snapshot syncdata.Snapshot
}

// Compare-and-swap protects edits made by another Wails call during network IO.
func (s *DesktopSyncService) save(input DesktopSyncSave) (bool, error) {
	if len(input.Document) > syncdata.MaxDocumentBytes {
		return false, errors.New("sync state exceeds 32 MiB")
	}
	if input.Snapshot != nil {
		for key := range input.Snapshot {
			if key != syncdata.ServerOrderKey && !strings.HasPrefix(key, "server/") && !strings.HasPrefix(key, "script/") && !strings.HasPrefix(key, "group/") {
				return false, errors.New("invalid configuration record")
			}
		}
		if err := syncdata.Validate(input.Snapshot); err != nil {
			return false, err
		}
	}
	db, err := s.database()
	if err != nil {
		return false, err
	}
	tx, err := db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE desktop_sync_state SET revision=revision+1 WHERE id=1 AND revision=?`, input.Revision)
	if err != nil {
		return false, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return false, nil
	}
	var spaceID string
	if err := tx.QueryRow(`SELECT space_id FROM desktop_sync_state WHERE id=1 AND token<>''`).Scan(&spaceID); err != nil {
		return false, err
	}
	before, ids, err := desktopSyncSnapshot(tx, spaceID)
	if err != nil {
		return false, err
	}
	if syncdata.Hash(before) != input.Hash {
		return false, nil
	}
	if input.Snapshot != nil {
		if err = applyDesktopSync(tx, spaceID, before, input.Snapshot, ids); err != nil {
			return false, err
		}
	}
	_, err = tx.Exec(`UPDATE desktop_sync_spaces SET document=? WHERE id=?`, input.Document, spaceID)
	if err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	if input.Snapshot != nil {
		for key, previous := range before {
			if strings.HasPrefix(key, "script/") {
				current, exists := input.Snapshot[key]
				version := ""
				if exists {
					version = scriptutil.Version(current["language"], current["content"])
				}
				s.scripts.invalidateScript(ids[key], version)
			}
			if strings.HasPrefix(key, "server/") && !syncdata.SameConnection(previous["connection"], input.Snapshot[key]["connection"]) {
				s.servers.clearTemporaryCredential(ids[key])
				_ = s.sftp.CloseConnection(ids[key])
			}
		}
	}
	return true, nil
}
func applyDesktopSync(tx *sql.Tx, spaceID string, before, after syncdata.Snapshot, ids map[string]string) error {
	if err := syncdata.Validate(after); err != nil {
		return err
	}
	if err := applyDesktopSyncGroups(tx, spaceID, before, after, ids); err != nil {
		return err
	}
	for key, old := range before {
		if !strings.HasPrefix(key, "server/") {
			continue
		}
		oldConn, err := syncdata.ParseConnection(old["connection"])
		if err != nil {
			return err
		}
		next := after[key]
		var nextJump string
		if next != nil {
			c, err := syncdata.ParseConnection(next["connection"])
			if err != nil {
				return err
			}
			nextJump = c.JumpServerID
		}
		if oldConn.JumpServerID != "" && (next == nil || oldConn.JumpServerID != nextJump) {
			if _, err := tx.Exec("UPDATE desktop_servers SET jump_server_id=NULL WHERE id=?", ids[key]); err != nil {
				return err
			}
		}
	}
	for key := range before {
		if key == syncdata.ServerOrderKey || strings.HasPrefix(key, "group/") {
			continue
		}
		if _, ok := after[key]; ok {
			continue
		}
		table := "desktop_servers"
		if strings.HasPrefix(key, "script/") {
			table = "desktop_scripts"
		}
		var name string
		if err := tx.QueryRow("SELECT name FROM "+table+" WHERE id=?", ids[key]).Scan(&name); err != nil {
			return err
		}
		if name == "" && table == "desktop_servers" {
			if err := tx.QueryRow("SELECT host FROM desktop_servers WHERE id=?", ids[key]).Scan(&name); err != nil {
				return err
			}
		}
		if table == "desktop_servers" {
			if err := deleteDesktopServer(tx, ids[key]); err != nil {
				return err
			}
		} else if err := deleteDesktopScript(tx, ids[key]); err != nil {
			return err
		}
		kind := strings.SplitN(key, "/", 2)[0]
		if err := recordDesktopConfiguration(tx, kind+"_deleted", kind, ids[key], name, "automation", []string{"deleted"}, nil); err != nil {
			return err
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	newServers := map[string]bool{}
	for key, r := range after {
		if key == syncdata.ServerOrderKey || strings.HasPrefix(key, "group/") {
			continue
		}
		if syncdata.Equal(before[key], r) {
			continue
		}
		parts := strings.SplitN(key, "/", 2)
		names := []string{"name", "connection", "group_id", "tags", "description"}
		if parts[0] == "script" {
			names = []string{"name", "content", "language", "tags", "description"}
		}
		fields := syncdata.ConfigurationChangedFields(before[key], r, names...)
		if len(fields) == 0 {
			continue
		}
		id := ids[key]
		if id == "" {
			// Stable IDs must not adopt or overwrite an unenrolled local copy.
			id = parts[1]
			table := "desktop_servers"
			if parts[0] == "script" {
				table = "desktop_scripts"
			}
			var exists bool
			if err := tx.QueryRow("SELECT EXISTS(SELECT 1 FROM "+table+" WHERE id=?)", id).Scan(&exists); err != nil {
				return err
			}
			if exists {
				return errors.New("本地存在同 ID 的未加入记录，请先在同步设置中主动加入对应服务器或脚本，再处理版本差异")
			}
			_, err := tx.Exec(`INSERT INTO desktop_sync_records(kind,local_id,space_id,remote_id) VALUES(?,?,?,?) ON CONFLICT(space_id,kind,remote_id) DO UPDATE SET local_id=excluded.local_id`, parts[0], id, spaceID, parts[1])
			if err != nil {
				return err
			}
		}
		ids[key] = id
		if parts[0] == "server" {
			conn, err := syncdata.ParseConnection(r["connection"])
			if err != nil {
				return err
			}
			var groupID any
			if r["group_id"] != "" {
				localGroupID := ids["group/"+r["group_id"]]
				if localGroupID == "" {
					return errors.New("missing local group mapping")
				}
				groupID = localGroupID
			}
			var keyID *string
			if conn.Key != nil {
				key, err := mergeDesktopSyncKey(tx, conn.Key.Material())
				if err != nil {
					return err
				}
				keyID = &key
			}
			if before[key] == nil {
				newServers[id] = true
				_, err = tx.Exec(`INSERT INTO desktop_servers(id,user_id,name,host,port,username,group_id,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, id, desktopLocalDataUserID, r["name"], conn.Host, conn.Port, conn.Username, groupID, r["description"], now, now)
				if err == nil {
					_, err = tx.Exec(`INSERT INTO desktop_server_auth(server_id,auth_method,ssh_key_id) VALUES(?,?,?)`, id, conn.AuthMethod, keyID)
				}
			} else {
				clear := !syncdata.SameConnection(before[key]["connection"], r["connection"])
				delta := 0
				if clear {
					delta = 1
				}
				_, err = tx.Exec(`UPDATE desktop_servers SET name=?,host=?,port=?,username=?,group_id=?,description=?,connection_revision=connection_revision+?,updated_at=? WHERE id=?`, r["name"], conn.Host, conn.Port, conn.Username, groupID, r["description"], delta, now, id)
				if err == nil {
					_, err = tx.Exec(`UPDATE desktop_server_auth SET auth_method=?,password=CASE WHEN ? THEN '' ELSE password END,ssh_key_id=? WHERE server_id=?`, conn.AuthMethod, clear, keyID, id)
				}
			}
			if err != nil {
				return err
			}
			if err := saveDesktopServerTags(tx, id, syncdata.Tags(r["tags"])); err != nil {
				return err
			}
		} else {
			var err error
			if before[key] == nil {
				_, err = tx.Exec(`INSERT INTO desktop_scripts(id,name,content,language,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, id, r["name"], r["content"], r["language"], r["tags"], r["description"], now, now)
			} else {
				_, err = tx.Exec(`UPDATE desktop_scripts SET name=?,content=?,language=?,tags_json=?,description=?,updated_at=? WHERE id=?`, r["name"], r["content"], r["language"], r["tags"], r["description"], now, id)
			}
			if err != nil {
				return err
			}
		}
		action := parts[0] + "_updated"
		if before[key] == nil {
			action = parts[0] + "_created"
		}
		if len(fields) > 0 {
			if err := recordDesktopConfiguration(tx, action, parts[0], id, r["name"], "automation", fields, nil); err != nil {
				return err
			}
		}
	}
	// Resolve remote jump IDs only after every local server mapping is known.
	for key, record := range after {
		if !strings.HasPrefix(key, "server/") {
			continue
		}
		conn, err := syncdata.ParseConnection(record["connection"])
		if err != nil {
			return err
		}
		var jumpID any
		if conn.JumpServerID != "" {
			localID := ids["server/"+conn.JumpServerID]
			if localID == "" {
				return errors.New("missing local jump server mapping")
			}
			jumpID = localID
		}
		if _, err := tx.Exec("UPDATE desktop_servers SET jump_server_id=? WHERE id=?", jumpID, ids[key]); err != nil {
			return err
		}
	}
	for key, old := range before {
		next := after[key]
		if !strings.HasPrefix(key, "server/") || next == nil || syncdata.SameConnection(old["connection"], next["connection"]) {
			continue
		}
		if err := invalidateDesktopJumpDependents(tx, ids[key]); err != nil {
			return err
		}
	}
	order, err := syncdata.OrderedServers(after)
	if err != nil {
		return err
	}
	mapping := map[string]string{}
	for _, remoteID := range order {
		mapping[remoteID] = ids["server/"+remoteID]
	}
	rows, err := tx.Query("SELECT id FROM desktop_servers ORDER BY sort_order ASC, created_at ASC, id ASC")
	if err != nil {
		return err
	}
	localIDs := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		localIDs = append(localIDs, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	ordered, err := syncdata.ProjectServerSlots(localIDs, order, mapping)
	if err != nil {
		return err
	}
	changedOrder := []activitystats.Resource{}
	for index, id := range ordered {
		result, err := tx.Exec("UPDATE desktop_servers SET sort_order=? WHERE id=? AND (sort_order IS NULL OR sort_order<>?)", index, id, index)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count > 0 && !newServers[id] {
			changedOrder = append(changedOrder, activitystats.Resource{ServerID: id})
		}
	}
	if len(changedOrder) > 0 {
		return recordDesktopConfiguration(tx, "servers_reordered", "workspace", spaceID, "同步服务器排列", "automation", []string{"sort_order"}, changedOrder)
	}
	return nil
}

type desktopSyncAuthorization struct {
	ServerURL  string
	DeviceCode string
	Token      string
	ExpiresAt  time.Time
}
type DesktopSyncLogin struct {
	URL       string    `json:"url"`
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (s *DesktopSyncService) BeginAuthorization(rawURL, name string) (DesktopSyncLogin, error) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	var result DesktopSyncLogin
	address, err := syncURL(rawURL)
	if err != nil {
		return result, err
	}
	state, err := s.Load()
	if err != nil {
		return result, err
	}
	if state.SpaceID != "" {
		return result, errors.New("disconnect the current account first")
	}
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		return result, err
	}
	token := "ess_sync_" + hex.EncodeToString(secret)
	hash := sha256.Sum256([]byte(token))
	payload, _ := json.Marshal(map[string]string{"name": strings.TrimSpace(name), "token_hash": hex.EncodeToString(hash[:])})
	data, err := syncRequest(address, "", "/authorization/start", payload)
	if err != nil {
		return result, err
	}
	var response struct {
		DeviceCode string    `json:"device_code"`
		UserCode   string    `json:"user_code"`
		ExpiresAt  time.Time `json:"expires_at"`
	}
	if err = json.Unmarshal(data, &response); err != nil {
		return result, err
	}
	if len(response.DeviceCode) != 64 || len(response.UserCode) != 64 || !response.ExpiresAt.After(time.Now()) {
		return result, errors.New("invalid authorization response")
	}
	s.pending = &desktopSyncAuthorization{address, response.DeviceCode, token, response.ExpiresAt}
	return DesktopSyncLogin{URL: address + "/dashboard/sync-authorize#" + url.QueryEscape(response.UserCode), Code: strings.ToUpper(response.UserCode[len(response.UserCode)-8:]), ExpiresAt: response.ExpiresAt}, nil
}
func (s *DesktopSyncService) PollAuthorization() (bool, error) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	pending := s.pending
	if pending == nil {
		return false, errors.New("no pending authorization")
	}
	if time.Now().After(pending.ExpiresAt) {
		s.pending = nil
		return false, errors.New("authorization expired; sign in again")
	}
	payload, _ := json.Marshal(map[string]string{"device_code": pending.DeviceCode})
	data, err := syncRequest(pending.ServerURL, "", "/authorization/poll", payload)
	if err != nil {
		return false, err
	}
	var response struct {
		Status string `json:"status"`
	}
	if err = json.Unmarshal(data, &response); err != nil {
		return false, err
	}
	if response.Status == "pending" {
		return false, nil
	}
	if response.Status != "approved" {
		s.pending = nil
		return false, errors.New("authorization was not approved")
	}
	if err = s.connect(pending.ServerURL, pending.Token); err != nil {
		return false, err
	}
	s.pending = nil
	return true, nil
}
func (s *DesktopSyncService) CancelAuthorization() error {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	pending := s.pending
	s.pending = nil
	if pending == nil {
		return nil
	}
	payload, _ := json.Marshal(map[string]string{"device_code": pending.DeviceCode})
	_, err := syncRequest(pending.ServerURL, "", "/authorization/cancel", payload)
	return err
}

type DesktopSyncCandidate struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	SpaceID     string `json:"space_id"`
	AccountName string `json:"account_name"`
	ServerURL   string `json:"server_url"`
}

func (s *DesktopSyncService) Candidates() ([]DesktopSyncCandidate, error) {
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`SELECT r.kind||'/'||r.id,r.name,COALESCE(m.space_id,''),COALESCE(p.account_name,''),COALESCE(p.server_url,'') FROM (SELECT 'server' AS kind,id,name FROM desktop_servers UNION ALL SELECT 'script' AS kind,id,name FROM desktop_scripts UNION ALL SELECT 'group' AS kind,id,name FROM desktop_server_groups) r LEFT JOIN desktop_sync_records m ON m.kind=r.kind AND m.local_id=r.id LEFT JOIN desktop_sync_spaces p ON p.id=m.space_id ORDER BY r.kind,r.name,r.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []DesktopSyncCandidate{}
	for rows.Next() {
		var row DesktopSyncCandidate
		if err = rows.Scan(&row.Key, &row.Name, &row.SpaceID, &row.AccountName, &row.ServerURL); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// Enroll adds selected records and their group dependencies. Records owned by another
// space are copied with fresh IDs and without passwords or private-key links.
func (s *DesktopSyncService) Enroll(spaceID string, keys []string) error {
	if len(keys) == 0 || len(keys) > 10000 {
		return errors.New("select between 1 and 10000 records")
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
	result, err := tx.Exec(`UPDATE desktop_sync_state SET revision=revision+1 WHERE id=1 AND space_id=? AND token<>''`, spaceID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return errors.New("sync account changed; refresh the selection")
	}
	seen := map[string]bool{}
	groupCopies := map[string]string{}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, key := range keys {
		if seen[key] {
			continue
		}
		seen[key] = true
		parts := strings.SplitN(key, "/", 2)
		if len(parts) != 2 || (parts[0] != "server" && parts[0] != "script" && parts[0] != "group") {
			return errors.New("invalid resource selection")
		}
		kind, id := parts[0], parts[1]
		if !servergroup.ValidID(id) {
			return errors.New("invalid resource ID")
		}
		if kind == "group" {
			if _, err := ensureDesktopGroupEnrollment(tx, spaceID, id, groupCopies); err != nil {
				return err
			}
			continue
		}
		table := "desktop_servers"
		if kind == "script" {
			table = "desktop_scripts"
		}
		var owner, name string
		nameColumn := "r.name"
		if kind == "server" {
			nameColumn = "COALESCE(NULLIF(r.name,''),r.host)"
		}
		err = tx.QueryRow(`SELECT COALESCE(m.space_id,''),`+nameColumn+` FROM `+table+` r LEFT JOIN desktop_sync_records m ON m.kind=? AND m.local_id=r.id WHERE r.id=?`, kind, id).Scan(&owner, &name)
		if err != nil {
			return err
		}
		if owner == spaceID {
			return errors.New("selected record already belongs to this space")
		}
		if owner != "" {
			newID := uuid.NewString()
			if kind == "server" {
				_, err = tx.Exec(`INSERT INTO desktop_servers(id,user_id,name,host,port,username,group_id,description,created_at,updated_at,jump_server_id) SELECT ?,user_id,name,host,port,username,group_id,description,?,?,jump_server_id FROM desktop_servers WHERE id=?`, newID, now, now, id)
				if err == nil {
					_, err = tx.Exec(`INSERT INTO desktop_server_auth(server_id,auth_method) SELECT ?,auth_method FROM desktop_server_auth WHERE server_id=?`, newID, id)
				}
				if err == nil {
					_, err = tx.Exec("INSERT INTO desktop_server_tags(server_id,tag_name) SELECT ?,tag_name FROM desktop_server_tags WHERE server_id=?", newID, id)
				}
			} else {
				_, err = tx.Exec(`INSERT INTO desktop_scripts(id,name,content,language,tags_json,description,created_at,updated_at) SELECT ?,name,content,language,tags_json,description,?,? FROM desktop_scripts WHERE id=?`, newID, now, now, id)
			}
			if err != nil {
				return err
			}
			id = newID
			if err = recordDesktopConfiguration(tx, kind+"_created", kind, id, name, "manual", []string{"definition"}, nil); err != nil {
				return err
			}
		}
		if kind == "server" {
			var groupID string
			if err := tx.QueryRow("SELECT COALESCE(group_id,'') FROM desktop_servers WHERE id=?", id).Scan(&groupID); err != nil {
				return err
			}
			targetGroup, err := ensureDesktopGroupEnrollment(tx, spaceID, groupID, groupCopies)
			if err != nil {
				return err
			}
			if targetGroup != groupID {
				if _, err := tx.Exec("UPDATE desktop_servers SET group_id=? WHERE id=?", desktopGroupID(targetGroup), id); err != nil {
					return err
				}
			}
		}
		_, err = tx.Exec(`INSERT INTO desktop_sync_records(kind,local_id,space_id,remote_id) VALUES(?,?,?,?)`, kind, id, spaceID, id)
		if err != nil {
			return err
		}
		if err = recordDesktopConfiguration(tx, kind+"_sync_enrolled", kind, id, name, "manual", []string{"sync_space_id"}, nil); err != nil {
			return err
		}
	}
	snapshot, _, err := desktopSyncSnapshot(tx, spaceID)
	if err != nil {
		return err
	}
	if err = syncdata.Validate(snapshot); err != nil {
		return err
	}
	return tx.Commit()
}

// MarkSynced runs only after every enabled document has completed this round.
func (s *DesktopSyncService) MarkSynced(spaceID string, revision int64) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	result, err := db.Exec(`UPDATE desktop_sync_spaces SET last_sync=? WHERE id=? AND EXISTS(SELECT 1 FROM desktop_sync_state WHERE id=1 AND space_id=? AND revision=? AND enabled=1 AND token<>'')`, time.Now().UTC().Format(time.RFC3339Nano), spaceID, spaceID, revision)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("sync account changed before completion")
	}
	return nil
}
