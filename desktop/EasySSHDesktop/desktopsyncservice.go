package main

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
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type DesktopSyncService struct {
	servers *DesktopServerService
	scripts *DesktopScriptService
	sftp    *DesktopSFTPService
	ai      *DesktopAIService
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
	Document    string              `json:"document"`
	RemoteHeads []string            `json:"remote_heads"`
	LastSync    string              `json:"last_sync"`
	Revision    int64               `json:"revision"`
	Snapshot    syncdata.Snapshot   `json:"snapshot"`
	Hash        string              `json:"hash"`
}
type desktopSyncQuery interface {
	Query(string, ...any) (*sql.Rows, error)
}

func desktopSyncSnapshot(db desktopSyncQuery, spaceID string) (syncdata.Snapshot, map[string]string, error) {
	snapshot := syncdata.Snapshot{}
	ids := map[string]string{}
	rows, err := db.Query(`SELECT s.id,m.remote_id,s.name,s.host,s.port,s.username,s.auth_method,s.server_group,s.tags_json,s.description FROM desktop_servers s JOIN desktop_sync_records m ON m.kind='server' AND m.local_id=s.id WHERE m.space_id=?`, spaceID)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var id, remoteID, name, host, username, method, group, tags, description string
		var port int
		if err = rows.Scan(&id, &remoteID, &name, &host, &port, &username, &method, &group, &tags, &description); err != nil {
			rows.Close()
			return nil, nil, err
		}
		key := "server/" + remoteID
		ids[key] = id
		snapshot[key] = syncdata.Record{"name": name, "connection": syncdata.JSON(syncdata.Connection{Host: host, Port: port, Username: username, AuthMethod: method}), "group": group, "tags": syncdata.JSON(syncdata.Tags(tags)), "description": description}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
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
	var heads, scopes, grants string
	err = tx.QueryRow(`SELECT COALESCE(p.server_url,''),s.space_id,COALESCE(p.account_name,''),COALESCE(p.scopes,'{}'),s.grants,s.enabled,COALESCE(p.document,''),COALESCE(p.remote_heads,'[]'),COALESCE(p.last_sync,''),s.revision FROM desktop_sync_state s LEFT JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1`).Scan(&result.ServerURL, &result.SpaceID, &result.AccountName, &scopes, &grants, &result.Enabled, &result.Document, &heads, &result.LastSync, &result.Revision)
	if err != nil {
		return result, err
	}
	if err = json.Unmarshal([]byte(heads), &result.RemoteHeads); err != nil {
		return result, err
	}
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
	data, err := io.ReadAll(io.LimitReader(response.Body, (16<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > 16<<20 {
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
	if json.Unmarshal(data, &identity) != nil || identity.Protocol != 3 {
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
	if _, err = tx.Exec(`UPDATE desktop_sync_spaces SET scopes='{}' WHERE id=?`, identity.SpaceID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *DesktopSyncService) SetEnabled(enabled bool) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE desktop_sync_state SET enabled=?,revision=revision+1 WHERE id=1 AND token<>''`, enabled)
	return err
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
	var address, encrypted string
	var revision int64
	err = db.QueryRow(`SELECT p.server_url,s.token,s.revision FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1`).Scan(&address, &encrypted, &revision)
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
	result, err := db.Exec(`UPDATE desktop_sync_state SET space_id='',token='',grants='{}',enabled=0,revision=revision+1 WHERE id=1 AND revision=?`, revision)
	if err != nil {
		return false, err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return false, errors.New("sync changed; retry logout")
	}
	return revokeErr == nil, nil
}
func (s *DesktopSyncService) Exchange(payload string, revision int64) (string, error) {
	if len(payload) > 12<<20 {
		return "", errors.New("sync payload is too large")
	}
	db, err := s.database()
	if err != nil {
		return "", err
	}
	var address, encrypted string
	if err = db.QueryRow(`SELECT p.server_url,s.token FROM desktop_sync_state s JOIN desktop_sync_spaces p ON p.id=s.space_id WHERE s.id=1 AND s.enabled=1 AND s.revision=?`, revision).Scan(&address, &encrypted); err != nil {
		return "", errors.New("sync configuration changed; retry")
	}
	token, err := decryptDesktopCredential(encrypted, "desktop_sync_state", "1", "token")
	if err != nil {
		return "", err
	}
	data, err := syncRequest(address, token, "/device/exchange", []byte(payload))
	return string(data), err
}

type DesktopSyncSave struct {
	Revision    int64             `json:"revision"`
	Hash        string            `json:"hash"`
	Document    string            `json:"document"`
	RemoteHeads []string          `json:"remote_heads"`
	Snapshot    syncdata.Snapshot `json:"snapshot"`
}

// Compare-and-swap protects edits made by another Wails call during network IO.
func (s *DesktopSyncService) Save(input DesktopSyncSave) (bool, error) {
	if len(input.Document) > 8<<20 {
		return false, errors.New("sync history exceeds 8 MiB")
	}
	if input.Snapshot != nil {
		for key := range input.Snapshot {
			if !strings.HasPrefix(key, "server/") && !strings.HasPrefix(key, "script/") {
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
	_, err = tx.Exec(`UPDATE desktop_sync_spaces SET document=?,remote_heads=? WHERE id=?`, input.Document, syncdata.JSON(input.RemoteHeads), spaceID)
	if err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	if input.Snapshot != nil {
		for key, previous := range before {
			if strings.HasPrefix(key, "server/") && previous["connection"] != input.Snapshot[key]["connection"] {
				_ = s.sftp.CloseConnection(ids[key])
			}
		}
	}
	return true, nil
}
func applyDesktopSync(tx *sql.Tx, spaceID string, before, after syncdata.Snapshot, ids map[string]string) error {
	for key := range before {
		if _, ok := after[key]; ok {
			continue
		}
		table := "desktop_servers"
		if strings.HasPrefix(key, "script/") {
			table = "desktop_scripts"
		}
		if _, err := tx.Exec("DELETE FROM "+table+" WHERE id=?", ids[key]); err != nil {
			return err
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for key, r := range after {
		if syncdata.Equal(before[key], r) {
			continue
		}
		parts := strings.SplitN(key, "/", 2)
		id := ids[key]
		if id == "" {
			// Local primary keys never come from a remote database. This also
			// isolates identical record IDs received from different accounts.
			id = uuid.NewString()
			_, err := tx.Exec(`INSERT INTO desktop_sync_records(kind,local_id,space_id,remote_id) VALUES(?,?,?,?) ON CONFLICT(space_id,kind,remote_id) DO UPDATE SET local_id=excluded.local_id`, parts[0], id, spaceID, parts[1])
			if err != nil {
				return err
			}
		}
		if parts[0] == "server" {
			conn, err := syncdata.ParseConnection(r["connection"])
			if err != nil {
				return err
			}
			if before[key] == nil {
				_, err = tx.Exec(`INSERT INTO desktop_servers(id,user_id,name,host,port,username,auth_method,server_group,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, id, desktopLocalDataUserID, r["name"], conn.Host, conn.Port, conn.Username, conn.AuthMethod, r["group"], r["tags"], r["description"], now, now)
			} else {
				clear := before[key]["connection"] != r["connection"]
				_, err = tx.Exec(`UPDATE desktop_servers SET name=?,host=?,port=?,username=?,auth_method=?,server_group=?,tags_json=?,description=?,password=CASE WHEN ? THEN '' ELSE password END,ssh_key_id=CASE WHEN ? THEN NULL ELSE ssh_key_id END,updated_at=? WHERE id=?`, r["name"], conn.Host, conn.Port, conn.Username, conn.AuthMethod, r["group"], r["tags"], r["description"], clear, clear, now, id)
			}
			if err != nil {
				return err
			}
		} else {
			var err error
			if before[key] == nil {
				_, err = tx.Exec(`INSERT INTO desktop_scripts(id,user_id,name,content,language,tags_json,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, id, desktopLocalDataUserID, r["name"], r["content"], r["language"], r["tags"], r["description"], now, now)
			} else {
				_, err = tx.Exec(`UPDATE desktop_scripts SET name=?,content=?,language=?,tags_json=?,description=?,updated_at=? WHERE id=?`, r["name"], r["content"], r["language"], r["tags"], r["description"], now, id)
			}
			if err != nil {
				return err
			}
		}
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
	rows, err := db.Query(`SELECT r.kind||'/'||r.id,r.name,COALESCE(m.space_id,''),COALESCE(p.account_name,''),COALESCE(p.server_url,'') FROM (SELECT 'server' AS kind,id,name FROM desktop_servers UNION ALL SELECT 'script' AS kind,id,name FROM desktop_scripts) r LEFT JOIN desktop_sync_records m ON m.kind=r.kind AND m.local_id=r.id LEFT JOIN desktop_sync_spaces p ON p.id=m.space_id ORDER BY r.kind,r.name,r.id`)
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

// Enroll adds only explicitly selected local records. Records owned by another
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
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, key := range keys {
		if seen[key] {
			continue
		}
		seen[key] = true
		parts := strings.SplitN(key, "/", 2)
		if len(parts) != 2 || (parts[0] != "server" && parts[0] != "script") {
			return errors.New("invalid resource selection")
		}
		kind, id := parts[0], parts[1]
		table := "desktop_servers"
		if kind == "script" {
			table = "desktop_scripts"
		}
		var owner string
		err = tx.QueryRow(`SELECT COALESCE(m.space_id,'') FROM `+table+` r LEFT JOIN desktop_sync_records m ON m.kind=? AND m.local_id=r.id WHERE r.id=?`, kind, id).Scan(&owner)
		if err != nil {
			return err
		}
		if owner == spaceID {
			return errors.New("selected record already belongs to this space")
		}
		if owner != "" {
			newID := uuid.NewString()
			if kind == "server" {
				_, err = tx.Exec(`INSERT INTO desktop_servers(id,user_id,name,host,port,username,auth_method,server_group,tags_json,description,created_at,updated_at) SELECT ?,user_id,name,host,port,username,auth_method,server_group,tags_json,description,?,? FROM desktop_servers WHERE id=?`, newID, now, now, id)
			} else {
				_, err = tx.Exec(`INSERT INTO desktop_scripts(id,user_id,name,content,language,tags_json,description,created_at,updated_at) SELECT ?,user_id,name,content,language,tags_json,description,?,? FROM desktop_scripts WHERE id=?`, newID, now, now, id)
			}
			if err != nil {
				return err
			}
			id = newID
		}
		_, err = tx.Exec(`INSERT INTO desktop_sync_records(kind,local_id,space_id,remote_id) VALUES(?,?,?,?)`, kind, id, spaceID, uuid.NewString())
		if err != nil {
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
