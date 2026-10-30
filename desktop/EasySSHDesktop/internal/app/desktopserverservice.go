package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/easyssh/shared/activitystats"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/servergroup"
	"github.com/easyssh/shared/servertag"
	"github.com/easyssh/shared/sftputil"
	"github.com/easyssh/shared/sshutil"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/crypto/ssh"
	_ "modernc.org/sqlite"
)

type DesktopServerAuthMethod string

const (
	DesktopServerAuthPassword                 DesktopServerAuthMethod = "password"
	DesktopServerAuthKey                      DesktopServerAuthMethod = "key"
	DesktopServerAuthPasswordKeyboard         DesktopServerAuthMethod = "password_keyboard"
	DesktopServerAuthKeyKeyboard              DesktopServerAuthMethod = "key_keyboard"
	DesktopServerAuthKeyPassword              DesktopServerAuthMethod = "key_password"
	DesktopServerAuthKeyPasswordKeyboard      DesktopServerAuthMethod = "key_password_keyboard"
	DesktopServerAuthPasswordKey              DesktopServerAuthMethod = "password_key"
	DesktopServerAuthPasswordKeyKeyboard      DesktopServerAuthMethod = "password_key_keyboard"
	DesktopServerAuthKeyboardInteractive      DesktopServerAuthMethod = "keyboard_interactive"
	DesktopServerAuthKeyboardInteractiveAlias DesktopServerAuthMethod = "keyboard"
)

type DesktopServerAuthFactor string

const (
	DesktopServerAuthFactorPassword            DesktopServerAuthFactor = "password"
	DesktopServerAuthFactorKey                 DesktopServerAuthFactor = "key"
	DesktopServerAuthFactorKeyboardInteractive DesktopServerAuthFactor = "keyboard_interactive"
)

type DesktopServer struct {
	connectionRevision        int64
	sortOrder                 int
	ID                        string                  `json:"id"`
	UserID                    string                  `json:"user_id"`
	Name                      string                  `json:"name,omitempty"`
	Host                      string                  `json:"host"`
	Port                      int                     `json:"port"`
	Username                  string                  `json:"username"`
	AuthMethod                DesktopServerAuthMethod `json:"auth_method"`
	Password                  string                  `json:"-"`
	PrivateKey                string                  `json:"-"`
	SavedPrivateKeyPassphrase string                  `json:"-"`
	SSHKeyID                  *string                 `json:"ssh_key_id"`
	GroupID                   string                  `json:"group_id"`
	Group                     string                  `json:"group,omitempty"`
	Tags                      []string                `json:"tags,omitempty"`
	LastConnected             string                  `json:"last_connected,omitempty"`
	Description               string                  `json:"description,omitempty"`
	OS                        string                  `json:"os,omitempty"`
	CreatedAt                 string                  `json:"created_at"`
	UpdatedAt                 string                  `json:"updated_at"`
}

type DesktopServerCommandInput struct {
	ServerID  string `json:"serverId"`
	Command   string `json:"command"`
	TimeoutMs int    `json:"timeoutMs,omitempty"`
}

type DesktopServerCommandResult struct {
	TaskID      string `json:"taskId,omitempty"`
	ServerID    string `json:"serverId"`
	Command     string `json:"command"`
	Output      string `json:"output"`
	ExitCode    *int   `json:"exitCode"`
	Outcome     string `json:"outcome"`
	Error       string `json:"error,omitempty"`
	DurationMs  int64  `json:"durationMs"`
	StartedAt   string `json:"startedAt"`
	CompletedAt string `json:"completedAt"`
}

type DesktopSSHCredential struct {
	AuthMethod           DesktopServerAuthMethod `json:"authMethod"`
	Secret               string                  `json:"secret"`
	Password             string                  `json:"password,omitempty"`
	PrivateKey           string                  `json:"privateKey,omitempty"`
	PrivateKeyPassphrase string                  `json:"privateKeyPassphrase,omitempty"`
}

type desktopTemporaryCredential struct {
	Revision   int64
	Digest     [32]byte
	Credential DesktopSSHCredential
}

type DesktopServerService struct {
	desktopOperationRegistry
	activity              *ActivityLogService
	tasks                 *DesktopTaskService
	commandMu             sync.Mutex
	commands              map[string]context.CancelFunc
	closed                bool
	mu                    sync.Mutex
	db                    *sql.DB
	temporaryCredentialMu sync.Mutex
	temporaryCredentials  map[string]desktopTemporaryCredential
}

func NewDesktopServerService(activity *ActivityLogService, tasks *DesktopTaskService) *DesktopServerService {
	s := &DesktopServerService{
		activity:             activity,
		tasks:                tasks,
		commands:             map[string]context.CancelFunc{},
		temporaryCredentials: map[string]desktopTemporaryCredential{},
	}
	if tasks != nil {
		tasks.registerHandler("command_execute", desktopCommandTaskHandler{s})
	}
	return s
}

func (s *DesktopServerService) ServiceName() string {
	return "DesktopServerService"
}

func (s *DesktopServerService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	_, err := s.database()
	return err
}

func (s *DesktopServerService) ServiceShutdown() error {
	s.stopOperations()
	s.operationWG.Wait()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true

	s.clearTemporaryCredentials()

	if s.db == nil {
		return nil
	}

	desktopHostTrustDB.CompareAndSwap(s.db, nil)
	err := s.db.Close()
	s.db = nil
	return err
}

func (s *DesktopServerService) setTemporaryCredential(serverID string, revision int64, digest [32]byte, credential DesktopSSHCredential) {
	if strings.TrimSpace(serverID) == "" || revision < 1 {
		return
	}
	s.temporaryCredentialMu.Lock()
	defer s.temporaryCredentialMu.Unlock()
	if current, ok := s.temporaryCredentials[serverID]; ok && current.Revision > revision {
		return
	}
	if s.temporaryCredentials == nil {
		s.temporaryCredentials = make(map[string]desktopTemporaryCredential)
	}
	s.temporaryCredentials[serverID] = desktopTemporaryCredential{Revision: revision, Digest: digest, Credential: credential}
}

func (s *DesktopServerService) getTemporaryCredential(serverID string, revision int64, digest [32]byte) (*DesktopSSHCredential, bool) {
	s.temporaryCredentialMu.Lock()
	defer s.temporaryCredentialMu.Unlock()
	entry, ok := s.temporaryCredentials[serverID]
	if !ok {
		return nil, false
	}
	if revision < 1 || entry.Revision != revision || entry.Digest != digest {
		if entry.Revision < revision {
			delete(s.temporaryCredentials, serverID)
		}
		return nil, false
	}
	credential := entry.Credential
	return &credential, true
}

func (s *DesktopServerService) clearTemporaryCredential(serverID string) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return
	}

	s.temporaryCredentialMu.Lock()
	delete(s.temporaryCredentials, serverID)
	s.temporaryCredentialMu.Unlock()
}

func (s *DesktopServerService) clearTemporaryCredentials() {
	s.temporaryCredentialMu.Lock()
	s.temporaryCredentials = map[string]desktopTemporaryCredential{}
	s.temporaryCredentialMu.Unlock()
}

func (s *DesktopServerService) List(params protocol.ServerListRequest) (protocol.ServerList, error) {
	database, err := s.database()
	if err != nil {
		return protocol.ServerList{}, err
	}

	params, err = normalizeDesktopServerListParams(params)
	if err != nil {
		return protocol.ServerList{}, err
	}
	if params.GroupID != "" && !servergroup.ValidID(params.GroupID) {
		return protocol.ServerList{}, servergroup.ErrInvalid
	}
	if params.Tag != "" {
		tags, err := servertag.Normalize([]string{params.Tag})
		if err != nil {
			return protocol.ServerList{}, err
		}
		params.Tag = tags[0]
	}
	where, args := buildDesktopServerWhere(params)

	var total int64
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM desktop_servers AS s WHERE %s", where)
	if err := database.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return protocol.ServerList{}, err
	}

	offset := (params.Page - 1) * params.Limit
	queryArgs := append(append([]any{}, args...), params.Limit, offset)
	querySQL := fmt.Sprintf(`
		SELECT id, user_id, name, host, port, username, auth_method, password, ssh_key_id,
			COALESCE(group_id,''), server_group, tags_json, last_connected, description, os, created_at, updated_at, connection_revision, sort_order
		FROM desktop_server_details AS s
		WHERE %s
		ORDER BY sort_order ASC, created_at ASC, id ASC
		LIMIT ? OFFSET ?`, where)

	rows, err := database.Query(querySQL, queryArgs...)
	if err != nil {
		return protocol.ServerList{}, err
	}
	defer rows.Close()

	servers, err := scanDesktopServers(rows)
	if err != nil {
		return protocol.ServerList{}, err
	}

	if err = rows.Close(); err != nil {
		return protocol.ServerList{}, err
	}
	online := s.activity.onlineServers()
	public := make([]protocol.Server, 0, len(servers))
	for _, server := range servers {
		item, err := desktopPublicServer(server, online[server.ID])
		if err != nil {
			return protocol.ServerList{}, err
		}
		public = append(public, item)
	}
	return protocol.ServerList{
		Data: public, Total: total, Page: params.Page, Limit: params.Limit,
		TotalPages: int((total + int64(params.Limit) - 1) / int64(params.Limit)),
	}, nil
}

// GetStatistics returns filter metadata without loading connection credentials.
func (s *DesktopServerService) GetStatistics() (protocol.ServerStatistics, error) {
	database, err := s.database()
	if err != nil {
		return protocol.ServerStatistics{}, err
	}
	var total, online int64
	if err := database.QueryRow(`SELECT COUNT(*) FROM desktop_servers`).Scan(&total); err != nil {
		return protocol.ServerStatistics{}, err
	}
	live := s.activity.onlineServers()
	if len(live) > 0 {
		args := make([]any, 0, len(live))
		for id := range live {
			args = append(args, id)
		}
		query := `SELECT COUNT(*) FROM desktop_servers WHERE id IN (` + strings.TrimSuffix(strings.Repeat("?,", len(args)), ",") + `)`
		if err := database.QueryRow(query, args...).Scan(&online); err != nil {
			return protocol.ServerStatistics{}, err
		}
	}
	readCounts := func(query string) (map[string]int64, error) {
		rows, err := database.Query(query)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		counts := make(map[string]int64)
		for rows.Next() {
			var name string
			var count int64
			if err := rows.Scan(&name, &count); err != nil {
				return nil, err
			}
			counts[name] = count
		}
		return counts, rows.Err()
	}
	groups, err := readCounts(`SELECT group_id, COUNT(*) FROM desktop_servers WHERE group_id IS NOT NULL GROUP BY group_id`)
	if err != nil {
		return protocol.ServerStatistics{}, err
	}
	tags, err := readCounts(`SELECT tag_name, COUNT(*) FROM desktop_server_tags GROUP BY tag_name`)
	if err != nil {
		return protocol.ServerStatistics{}, err
	}
	return protocol.ServerStatistics{Total: total, ConnectedServers: &online, ByGroup: groups, ByTag: tags}, nil
}

func (s *DesktopServerService) GetById(id string) (protocol.Server, error) {
	database, err := s.database()
	if err != nil {
		return protocol.Server{}, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return protocol.Server{}, errors.New("server id is required")
	}

	row := database.QueryRow(`
		SELECT id, user_id, name, host, port, username, auth_method, password, ssh_key_id,
			COALESCE(group_id,''), server_group, tags_json, last_connected, description, os, created_at, updated_at, connection_revision, sort_order
		FROM desktop_server_details
		WHERE id = ?`, id)

	server, err := scanDesktopServer(row)
	if err != nil {
		return protocol.Server{}, err
	}

	return desktopPublicServer(server, s.activity.onlineServers()[server.ID])
}

func (s *DesktopServerService) Create(input protocol.ServerCreate) (protocol.Server, error) {
	server, err := normalizeDesktopServerInput(input)
	if err != nil {
		return protocol.Server{}, err
	}

	database, err := s.database()
	if err != nil {
		return protocol.Server{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	server.ID = newDesktopServerID()
	server.UserID = desktopLocalDataUserID
	server.connectionRevision = 1
	server.CreatedAt = now
	server.UpdatedAt = now

	tx, err := database.Begin()
	if err != nil {
		return protocol.Server{}, err
	}
	defer tx.Rollback()
	if err := resolveDesktopServerGroup(tx, &server); err != nil {
		return protocol.Server{}, err
	}
	if err := assignDesktopSSHKey(tx, &server, input.SSHKeyID, &input.PrivateKey, input.PrivateKeyPassphrase); err != nil {
		return protocol.Server{}, err
	}
	server.Password, err = encryptDesktopCredential(server.Password, "desktop_server_auth", server.ID, "password")
	if err != nil {
		return protocol.Server{}, err
	}

	var sortOrder int
	if err := tx.QueryRow("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM desktop_servers").Scan(&sortOrder); err != nil {
		return protocol.Server{}, err
	}

	server.sortOrder = sortOrder
	_, err = tx.Exec(`INSERT INTO desktop_servers(id,user_id,name,host,port,username,group_id,last_connected,description,os,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, server.ID, server.UserID, server.Name, server.Host, server.Port, server.Username, desktopGroupID(server.GroupID), server.LastConnected, server.Description, server.OS, sortOrder, server.CreatedAt, server.UpdatedAt)
	if err != nil {
		return protocol.Server{}, err
	}
	if _, err = tx.Exec(`INSERT INTO desktop_server_auth(server_id,auth_method,password,ssh_key_id) VALUES(?,?,?,?)`, server.ID, server.AuthMethod, server.Password, server.SSHKeyID); err != nil {
		return protocol.Server{}, err
	}
	if err = saveDesktopServerTags(tx, server.ID, server.Tags); err != nil {
		return protocol.Server{}, err
	}
	if err = recordDesktopConfiguration(tx, "server_created", "server", server.ID, serverDisplayName(server), "manual", []string{"created"}, nil); err != nil {
		return protocol.Server{}, err
	}
	if err = tx.Commit(); err != nil {
		return protocol.Server{}, err
	}

	return desktopPublicServer(server, s.activity.onlineServers()[server.ID])
}

func (s *DesktopServerService) Update(id string, input protocol.ServerUpdate) (protocol.Server, error) {
	database, err := s.database()
	if err != nil {
		return protocol.Server{}, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return protocol.Server{}, errors.New("server id is required")
	}

	tx, err := database.Begin()
	if err != nil {
		return protocol.Server{}, err
	}
	defer tx.Rollback()
	current, err := scanDesktopServer(tx.QueryRow(`SELECT id,user_id,name,host,port,username,auth_method,password,ssh_key_id,COALESCE(group_id,''),server_group,tags_json,last_connected,description,os,created_at,updated_at,connection_revision,sort_order FROM desktop_server_details WHERE id=?`, id))
	if err != nil {
		return protocol.Server{}, err
	}
	server, err := mergeDesktopServerUpdate(current, input)
	if err != nil {
		return protocol.Server{}, err
	}
	passwordChanged := false
	if input.Password != nil {
		plain, err := decryptDesktopCredential(current.Password, "desktop_server_auth", id, "password")
		if err != nil {
			return protocol.Server{}, err
		}
		passwordChanged = plain != *input.Password
	}
	if !passwordChanged {
		server.Password = current.Password
	}
	server.SSHKeyID = current.SSHKeyID
	if err := enrollDesktopServerGroup(tx, id, &server); err != nil {
		return protocol.Server{}, err
	}
	if err := resolveDesktopServerGroup(tx, &server); err != nil {
		return protocol.Server{}, err
	}
	if err := assignDesktopSSHKey(tx, &server, input.SSHKeyID, input.PrivateKey, input.PrivateKeyPassphrase); err != nil {
		return protocol.Server{}, err
	}
	server.OS = current.OS
	fields := desktopServerChangedFields(current, server, passwordChanged)
	if len(fields) == 0 {
		if err = tx.Commit(); err != nil {
			return protocol.Server{}, err
		}
		return desktopPublicServer(current, s.activity.onlineServers()[current.ID])
	}
	connectionChanged := server.Host != current.Host || server.Port != current.Port || server.Username != current.Username || server.AuthMethod != current.AuthMethod || !desktopSameSSHKey(current.SSHKeyID, server.SSHKeyID)
	if connectionChanged {
		server.OS = ""
	}
	if passwordChanged {
		server.Password, err = encryptDesktopCredential(server.Password, "desktop_server_auth", id, "password")
		if err != nil {
			return protocol.Server{}, err
		}
	}
	now := desktopTaskNow()
	delta := 0
	if connectionChanged {
		delta = 1
	}
	result, err := tx.Exec(`UPDATE desktop_servers SET name=?,host=?,port=?,username=?,group_id=?,description=?,os=?,updated_at=?,connection_revision=connection_revision+? WHERE id=? AND updated_at=?`, server.Name, server.Host, server.Port, server.Username, desktopGroupID(server.GroupID), server.Description, server.OS, now, delta, id, current.UpdatedAt)
	if err != nil {
		return protocol.Server{}, err
	}
	if changed, _ := result.RowsAffected(); changed != 1 {
		return protocol.Server{}, errors.New("server changed; reload before saving")
	}
	if _, err = tx.Exec(`UPDATE desktop_server_auth SET auth_method=?,password=?,ssh_key_id=? WHERE server_id=?`, server.AuthMethod, server.Password, server.SSHKeyID, id); err != nil {
		return protocol.Server{}, err
	}
	if len(fields) > 0 {
		if err = saveDesktopServerTags(tx, id, server.Tags); err != nil {
			return protocol.Server{}, err
		}
		if err = recordDesktopConfiguration(tx, "server_updated", "server", id, serverDisplayName(server), "manual", fields, nil); err != nil {
			return protocol.Server{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return protocol.Server{}, err
	}

	if connectionChanged || passwordChanged {
		s.clearTemporaryCredential(id)
	}
	server.ID, server.UserID, server.CreatedAt, server.UpdatedAt = current.ID, current.UserID, current.CreatedAt, now
	server.LastConnected = current.LastConnected
	server.connectionRevision = current.connectionRevision + int64(delta)
	server.sortOrder = current.sortOrder
	return desktopPublicServer(server, s.activity.onlineServers()[server.ID])
}

func (s *DesktopServerService) Delete(id string) error {
	database, err := s.database()
	if err != nil {
		return err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("server id is required")
	}

	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var name, host string
	if err = tx.QueryRow("SELECT name,host FROM desktop_servers WHERE id=?", id).Scan(&name, &host); err != nil {
		return err
	}
	if name == "" {
		name = host
	}
	if err = deleteDesktopServer(tx, id); err != nil {
		return err
	}
	if err = recordDesktopConfiguration(tx, "server_deleted", "server", id, name, "manual", []string{"deleted"}, nil); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	s.clearTemporaryCredential(id)
	return nil
}

func (s *DesktopServerService) Reorder(input protocol.ServerReorderRequest) error {
	if len(input.ServerIDs) == 0 || len(input.ServerIDs) > 10000 {
		return errors.New("server IDs must contain between 1 and 10000 entries")
	}
	serverIds := make([]string, len(input.ServerIDs))
	selected := make(map[string]bool, len(input.ServerIDs))
	for i, id := range input.ServerIDs {
		if id == uuid.Nil || selected[id.String()] {
			return errors.New("server IDs must be nonzero and unique")
		}
		serverIds[i] = id.String()
		selected[serverIds[i]] = true
	}
	database, err := s.database()
	if err != nil {
		return err
	}

	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows, err := tx.Query("SELECT id FROM desktop_servers ORDER BY sort_order ASC, created_at ASC, id ASC")
	if err != nil {
		return err
	}
	var orderedIDs []string
	var slots []int
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		if selected[id] {
			slots = append(slots, len(orderedIDs))
		}
		orderedIDs = append(orderedIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if len(slots) != len(serverIds) {
		return errors.New("server not found")
	}
	// Reorder only the supplied slots, preserving unloaded and filtered-out rows.
	for index, slot := range slots {
		orderedIDs[slot] = serverIds[index]
	}
	changedOrder := false
	for index, id := range orderedIDs {
		result, err := tx.Exec("UPDATE desktop_servers SET sort_order=? WHERE id=? AND sort_order<>?", index, id, index)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		changedOrder = changedOrder || count > 0
	}

	if changedOrder {
		resources := make([]activitystats.Resource, 0, len(serverIds))
		for _, id := range serverIds {
			resources = append(resources, activitystats.Resource{ServerID: id})
		}
		if err = recordDesktopConfiguration(tx, "servers_reordered", "workspace", "local", "服务器排列", "manual", []string{"sort_order"}, resources); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *DesktopServerService) updateOSIfEmpty(id string, osValue string) error {
	database, err := s.database()
	if err != nil {
		return err
	}

	id = strings.TrimSpace(id)
	osValue = strings.TrimSpace(osValue)
	if id == "" || osValue == "" {
		return nil
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = database.Exec(`
		UPDATE desktop_servers
		SET os = ?, updated_at = ?
		WHERE id = ? AND (os = '' OR os IS NULL)`, osValue, now, id)
	return err
}

var desktopOSDetectionCommands = []string{
	`sh -c 'os=$(awk -F= '"'"'/^PRETTY_NAME=/ { gsub(/^"|"$/, "", $2); print $2; exit }'"'"' /etc/os-release 2>/dev/null); if [ -n "$os" ]; then printf "%s\n" "$os"; elif command -v sw_vers >/dev/null 2>&1; then printf "%s %s\n" "$(sw_vers -productName)" "$(sw_vers -productVersion)"; else uname -s 2>/dev/null; fi'`,
	`powershell -NoProfile -NonInteractive -Command "$os = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption; if (-not $os) { $os = (Get-WmiObject Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption }; if ($os) { [Console]::Out.WriteLine($os) }"`,
	`cmd /C ver`,
}

func (s *DesktopServerService) detectAndPersistOSIfEmpty(ctx context.Context, server DesktopServer, client *ssh.Client) {
	if client == nil || strings.TrimSpace(server.OS) != "" {
		return
	}

	osValue, err := detectDesktopServerOS(ctx, client)
	if err != nil {
		desktopLogPrintf("failed to detect desktop server OS: %v", err)
		return
	}

	if osValue == "" || ctx.Err() != nil {
		return
	}

	if err := s.updateOSIfEmpty(server.ID, osValue); err != nil {
		desktopLogPrintf("failed to update desktop server OS: %v", err)
	}
}

func detectDesktopServerOS(ctx context.Context, client *ssh.Client) (string, error) {
	bounded, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	var lastErr error
	for _, command := range desktopOSDetectionCommands {
		output, err := sshutil.CommandOutput(bounded, client, command, 4096)

		osValue := strings.TrimSpace(string(output))
		if err == nil && osValue != "" {
			return osValue, nil
		}
		if err != nil {
			lastErr = err
		}
	}

	if lastErr != nil {
		return "", lastErr
	}
	return "", nil
}

func (s *DesktopServerService) ExecuteCommand(input DesktopServerCommandInput) (DesktopServerCommandResult, error) {
	return s.ExecuteCommandContext(context.Background(), input)
}

func (s *DesktopServerService) ExecuteCommandContext(ctx context.Context, input DesktopServerCommandInput) (DesktopServerCommandResult, error) {
	return s.runCommandTask(ctx, input, s.executeCommand)
}

// Internal callers own their execution records (AI/batch) or only sample state.
func (s *DesktopServerService) executeCommandContext(ctx context.Context, input DesktopServerCommandInput) (DesktopServerCommandResult, error) {
	ctx, finish, err := s.beginOperation(ctx)
	if err != nil {
		return DesktopServerCommandResult{}, err
	}
	defer finish()
	return s.executeCommand(ctx, input)
}

func (s *DesktopServerService) executeCommand(ctx context.Context, input DesktopServerCommandInput) (DesktopServerCommandResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	serverID := strings.TrimSpace(input.ServerID)
	command := strings.TrimSpace(input.Command)
	if serverID == "" {
		return DesktopServerCommandResult{}, errors.New("server id is required")
	}
	if command == "" {
		return DesktopServerCommandResult{}, errors.New("command is required")
	}

	server, err := s.getByIDRaw(serverID)
	if err != nil {
		return DesktopServerCommandResult{}, err
	}

	authMethods, err := buildDesktopServerSSHAuthMethods(server)
	if err != nil {
		return DesktopServerCommandResult{}, err
	}
	if len(authMethods) == 0 {
		return DesktopServerCommandResult{}, errors.New("server credential is required")
	}

	timeout := time.Duration(input.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	if timeout > 2*time.Minute {
		timeout = 2 * time.Minute
	}

	ctx, cancelCommand := context.WithTimeout(ctx, timeout)
	defer cancelCommand()
	started := time.Now().UTC()
	finishResult := func(outcome string, code *int, output, message string) DesktopServerCommandResult {
		completed := time.Now().UTC()
		return DesktopServerCommandResult{ServerID: serverID, Command: command,
			Outcome: outcome, ExitCode: code, Output: normalizeDesktopCommandOutput(output), Error: message,
			DurationMs: completed.Sub(started).Milliseconds(), StartedAt: started.Format(time.RFC3339Nano), CompletedAt: completed.Format(time.RFC3339Nano)}
	}
	beforeExecution := func(err error) DesktopServerCommandResult {
		outcome := "failed"
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			outcome = "timeout"
		} else if ctx.Err() != nil {
			outcome = "canceled"
		}
		return finishResult(outcome, nil, "", err.Error())
	}
	if err := ctx.Err(); err != nil {
		return beforeExecution(err), nil
	}

	config := &ssh.ClientConfig{
		User:            server.Username,
		Auth:            authMethods,
		HostKeyCallback: desktopHostKeyCallback(),
		Timeout:         12 * time.Second,
	}
	if err := configureDesktopHostKeyAlgorithms(config, server.Host, server.Port); err != nil {
		return DesktopServerCommandResult{}, err
	}

	client, closeClient, err := dialDesktopObservedSSH(ctx, &s.desktopOperationRegistry, s.activity, server, config, 12*time.Second, "command_connect", "manual")
	if err != nil {
		return beforeExecution(err), nil
	}
	defer closeClient()
	stopTransport := sftputil.CloseOnCancel(ctx, func() error { closeClient(); return nil })
	defer stopTransport()

	session, err := client.NewSession()
	if err != nil {
		return beforeExecution(err), nil
	}
	defer sshutil.CloseSession(session, client)

	// No exec request has been sent yet: cancellation here has no remote effect.
	if err := ctx.Err(); err != nil {
		return beforeExecution(err), nil
	}
	liveOutput := aiworkspace.NewOutput(ctx)
	session.Stdout, session.Stderr = liveOutput, liveOutput
	done := make(chan error, 1)
	go func() {
		err := session.Run(command)
		liveOutput.Flush()
		done <- err
	}()
	var runErr error
	select {
	case runErr = <-done:
	case <-ctx.Done():
		_ = client.Close()
		runErr = <-done
	}
	// A confirmed remote exit takes precedence over a late cancellation.
	outcome, code, message := sshutil.CommandOutcome(runErr)
	return finishResult(outcome, code, liveOutput.String(), message), nil
}

func (s *DesktopServerService) openSSHClientContext(ctx context.Context, serverID string) (*ssh.Client, func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	server, err := s.getByIDRaw(serverID)
	if err != nil {
		return nil, nil, err
	}
	authMethods, err := buildDesktopServerSSHAuthMethods(server)
	if err != nil {
		return nil, nil, err
	}
	if len(authMethods) == 0 {
		return nil, nil, errors.New("server credential is required")
	}

	config := &ssh.ClientConfig{
		User:            server.Username,
		Auth:            authMethods,
		HostKeyCallback: desktopHostKeyCallback(),
		Timeout:         12 * time.Second,
	}
	if err := configureDesktopHostKeyAlgorithms(config, server.Host, server.Port); err != nil {
		return nil, nil, err
	}
	return dialDesktopObservedSSH(ctx, &s.desktopOperationRegistry, s.activity, server, config, 12*time.Second, "docker_connect", "manual")
}

func (s *DesktopServerService) database() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil, errors.New("server service is closed")
	}

	if s.db != nil {
		return s.db, nil
	}

	dataDir := desktopDataDir()
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create desktop data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "easyssh-desktop.sqlite")
	database, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}

	if err := configureDesktopDatabase(database); err != nil {
		database.Close()
		return nil, err
	}

	if err := initializeDesktopCredentials(database); err != nil {
		database.Close()
		return nil, err
	}
	s.db = database
	desktopHostTrustDB.Store(database)
	return s.db, nil
}

func (s *DesktopServerService) getByIDStored(id string) (DesktopServer, error) {
	database, err := s.database()
	if err != nil {
		return DesktopServer{}, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return DesktopServer{}, errors.New("server id is required")
	}

	row := database.QueryRow(`
		SELECT id, user_id, name, host, port, username, auth_method, password, ssh_key_id,
			COALESCE(group_id,''), server_group, tags_json, last_connected, description, os, created_at, updated_at, connection_revision, sort_order
		FROM desktop_server_details
		WHERE id = ?`, id)

	return scanDesktopServer(row)
}

func (s *DesktopServerService) getByIDRaw(id string) (DesktopServer, error) {
	server, err := s.getByIDStored(id)
	if err != nil {
		return DesktopServer{}, err
	}
	server.Password, err = decryptDesktopCredential(server.Password, "desktop_server_auth", server.ID, "password")
	if err != nil {
		return DesktopServer{}, err
	}
	server.PrivateKey, server.SavedPrivateKeyPassphrase, err = s.resolveSSHKeyCredentials(server.SSHKeyID)
	if err != nil {
		return DesktopServer{}, err
	}
	return server, nil
}

func normalizeDesktopServerListParams(params protocol.ServerListRequest) (protocol.ServerListRequest, error) {
	if params.Page < 0 || params.Page > 1000000 || params.Limit < 0 || params.Limit > 100 {
		return params, errors.New("invalid server pagination")
	}
	if params.Page == 0 {
		params.Page = 1
	}
	if params.Limit == 0 {
		params.Limit = 20
	}
	params.Search = strings.TrimSpace(params.Search)
	params.GroupID = strings.TrimSpace(params.GroupID)
	params.Tag = strings.TrimSpace(params.Tag)
	return params, nil
}

func buildDesktopServerWhere(params protocol.ServerListRequest) (string, []any) {
	clauses := []string{"1 = 1"}
	args := make([]any, 0)

	if params.GroupID != "" {
		clauses = append(clauses, "group_id = ?")
		args = append(args, params.GroupID)
	}

	if params.Tag != "" {
		clauses = append(clauses, "EXISTS(SELECT 1 FROM desktop_server_tags st WHERE st.server_id=s.id AND st.tag_name=?)")
		args = append(args, params.Tag)
	}
	if params.Search != "" {
		like := "%" + strings.ToLower(params.Search) + "%"
		clauses = append(clauses, `(LOWER(name) LIKE ? OR LOWER(host) LIKE ? OR LOWER(username) LIKE ? OR LOWER(description) LIKE ? OR EXISTS(SELECT 1 FROM desktop_server_tags st WHERE st.server_id=s.id AND LOWER(st.tag_name) LIKE ?))`)
		args = append(args, like, like, like, like, like)
	}

	return strings.Join(clauses, " AND "), args
}

func normalizeDesktopServerInput(input protocol.ServerCreate) (DesktopServer, error) {
	host := sshutil.NormalizeHost(input.Host)
	if host == "" {
		return DesktopServer{}, errors.New("server host is required")
	}

	username := strings.TrimSpace(input.Username)
	if username == "" {
		return DesktopServer{}, errors.New("server username is required")
	}

	port := input.Port
	if port == 0 {
		port = 22
	}
	if port < 1 || port > 65535 {
		return DesktopServer{}, errors.New("invalid server port")
	}

	authMethod := DesktopServerAuthMethod(input.AuthMethod)
	authMethod = normalizeDesktopServerAuthMethod(authMethod)
	if !isValidDesktopServerAuthMethod(authMethod) {
		return DesktopServer{}, fmt.Errorf("unsupported auth method: %s", authMethod)
	}

	if strings.IndexAny(host, " \t\r\n\x00") >= 0 || utf8.RuneCountInString(host) > 255 ||
		utf8.RuneCountInString(username) > 50 || strings.ContainsRune(username, 0) ||
		utf8.RuneCountInString(input.Name) > 100 || strings.ContainsRune(input.Name, 0) ||
		utf8.RuneCountInString(input.Description) > 10000 || strings.ContainsRune(input.Description, 0) ||
		len(input.Password) > 4096 || len(input.PrivateKey) > 1<<20 || len(input.PrivateKeyPassphrase) > 4096 {
		return DesktopServer{}, errors.New("invalid server fields")
	}
	if input.GroupID != "" && !servergroup.ValidID(input.GroupID) {
		return DesktopServer{}, servergroup.ErrInvalid
	}
	tags, err := servertag.Normalize(input.Tags)
	if err != nil {
		return DesktopServer{}, err
	}

	return DesktopServer{
		Name:        strings.TrimSpace(input.Name),
		Host:        host,
		Port:        port,
		Username:    username,
		AuthMethod:  authMethod,
		Password:    input.Password,
		PrivateKey:  input.PrivateKey,
		GroupID:     input.GroupID,
		Tags:        tags,
		Description: strings.TrimSpace(input.Description),
	}, nil
}

func isValidDesktopServerAuthMethod(method DesktopServerAuthMethod) bool {
	return method.IsValid()
}

func normalizeDesktopServerAuthMethod(method DesktopServerAuthMethod) DesktopServerAuthMethod {
	if method == DesktopServerAuthKeyboardInteractiveAlias {
		return DesktopServerAuthKeyboardInteractive
	}
	return method
}

func (method DesktopServerAuthMethod) AuthFactors() ([]DesktopServerAuthFactor, bool) {
	switch method {
	case DesktopServerAuthPassword:
		return []DesktopServerAuthFactor{DesktopServerAuthFactorPassword}, true
	case DesktopServerAuthKey:
		return []DesktopServerAuthFactor{DesktopServerAuthFactorKey}, true
	case DesktopServerAuthPasswordKeyboard:
		return []DesktopServerAuthFactor{DesktopServerAuthFactorPassword, DesktopServerAuthFactorKeyboardInteractive}, true
	case DesktopServerAuthKeyKeyboard:
		return []DesktopServerAuthFactor{DesktopServerAuthFactorKey, DesktopServerAuthFactorKeyboardInteractive}, true
	case DesktopServerAuthKeyPassword:
		return []DesktopServerAuthFactor{DesktopServerAuthFactorKey, DesktopServerAuthFactorPassword}, true
	case DesktopServerAuthKeyPasswordKeyboard:
		return []DesktopServerAuthFactor{DesktopServerAuthFactorKey, DesktopServerAuthFactorPassword, DesktopServerAuthFactorKeyboardInteractive}, true
	case DesktopServerAuthPasswordKey:
		return []DesktopServerAuthFactor{DesktopServerAuthFactorPassword, DesktopServerAuthFactorKey}, true
	case DesktopServerAuthPasswordKeyKeyboard:
		return []DesktopServerAuthFactor{DesktopServerAuthFactorPassword, DesktopServerAuthFactorKey, DesktopServerAuthFactorKeyboardInteractive}, true
	case DesktopServerAuthKeyboardInteractive, DesktopServerAuthKeyboardInteractiveAlias:
		return []DesktopServerAuthFactor{DesktopServerAuthFactorKeyboardInteractive}, true
	default:
		return nil, false
	}
}

func (method DesktopServerAuthMethod) IsValid() bool {
	_, ok := method.AuthFactors()
	return ok
}

func (method DesktopServerAuthMethod) RequiresPassword() bool {
	factors, ok := method.AuthFactors()
	if !ok {
		return false
	}
	for _, factor := range factors {
		if factor == DesktopServerAuthFactorPassword {
			return true
		}
	}
	return false
}

func (method DesktopServerAuthMethod) RequiresPrivateKey() bool {
	factors, ok := method.AuthFactors()
	if !ok {
		return false
	}
	for _, factor := range factors {
		if factor == DesktopServerAuthFactorKey {
			return true
		}
	}
	return false
}

func (method DesktopServerAuthMethod) SupportsKeyboardInteractive() bool {
	factors, ok := method.AuthFactors()
	if !ok {
		return false
	}
	for _, factor := range factors {
		if factor == DesktopServerAuthFactorKeyboardInteractive {
			return true
		}
	}
	return false
}

func buildDesktopServerSSHAuthMethods(server DesktopServer) ([]ssh.AuthMethod, error) {
	return buildDesktopServerSSHAuthMethodsWithCredential(server, nil)
}

func buildDesktopServerSSHAuthMethodsWithCredential(server DesktopServer, credential *DesktopSSHCredential) ([]ssh.AuthMethod, error) {
	return buildDesktopServerSSHAuthMethodsWithCredentialAndKeyboard(server, credential, nil)
}

func buildDesktopServerSSHAuthMethodsWithCredentialAndKeyboard(server DesktopServer, credential *DesktopSSHCredential, keyboardInteractive ssh.KeyboardInteractiveChallenge) ([]ssh.AuthMethod, error) {
	authMethod := normalizeDesktopServerAuthMethod(server.AuthMethod)
	if credential != nil && credential.AuthMethod != "" {
		authMethod = normalizeDesktopServerAuthMethod(credential.AuthMethod)
	}
	if !authMethod.IsValid() {
		return nil, fmt.Errorf("unsupported auth method: %s", authMethod)
	}

	factors, _ := authMethod.AuthFactors()
	authMethods := make([]ssh.AuthMethod, 0, len(factors)+1)
	hasKeyboardInteractive := false

	for _, factor := range factors {
		switch factor {
		case DesktopServerAuthFactorPassword:
			password := desktopServerCredentialPassword(authMethod, server, credential)
			if password == "" {
				return nil, errors.New("server credential is required")
			}
			authMethods = append(authMethods, ssh.Password(password))
		case DesktopServerAuthFactorKey:
			privateKey := desktopServerCredentialPrivateKey(authMethod, server, credential)
			if strings.TrimSpace(privateKey) == "" {
				return nil, errors.New("server credential is required")
			}
			signer, err := sshutil.ParsePrivateKey(privateKey, desktopServerCredentialPrivateKeyPassphrase(server, credential))
			if err != nil {
				return nil, err
			}
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		case DesktopServerAuthFactorKeyboardInteractive:
			if keyboardInteractive == nil {
				return nil, fmt.Errorf("keyboard_interactive_required")
			}
			hasKeyboardInteractive = true
			authMethods = append(authMethods, ssh.KeyboardInteractive(keyboardInteractive))
		}
	}

	if keyboardInteractive != nil && !hasKeyboardInteractive {
		authMethods = append(authMethods, ssh.KeyboardInteractive(keyboardInteractive))
	}

	return authMethods, nil
}

func desktopServerCredentialPassword(authMethod DesktopServerAuthMethod, server DesktopServer, credential *DesktopSSHCredential) string {
	if credential == nil {
		return server.Password
	}
	if credential.Password != "" {
		return credential.Password
	}
	if credential.Secret != "" && authMethod.RequiresPassword() && !authMethod.RequiresPrivateKey() {
		return credential.Secret
	}
	return server.Password
}

func desktopServerCredentialPrivateKey(authMethod DesktopServerAuthMethod, server DesktopServer, credential *DesktopSSHCredential) string {
	if credential == nil {
		return server.PrivateKey
	}
	if credential.PrivateKey != "" {
		return credential.PrivateKey
	}
	if credential.Secret != "" && authMethod.RequiresPrivateKey() && !authMethod.RequiresPassword() {
		return credential.Secret
	}
	return server.PrivateKey
}

func desktopServerCredentialPrivateKeyPassphrase(server DesktopServer, credential *DesktopSSHCredential) string {
	if credential == nil || credential.PrivateKeyPassphrase == "" && credential.PrivateKey == "" {
		return server.SavedPrivateKeyPassphrase
	}
	return credential.PrivateKeyPassphrase
}

func normalizeDesktopCommandOutput(output string) string {
	return strings.TrimRight(strings.ReplaceAll(output, "\r\n", "\n"), "\n")
}

type desktopServerScanner interface {
	Scan(dest ...any) error
}

func scanDesktopServers(rows *sql.Rows) ([]DesktopServer, error) {
	servers := make([]DesktopServer, 0)
	for rows.Next() {
		server, err := scanDesktopServer(rows)
		if err != nil {
			return nil, err
		}
		servers = append(servers, server)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return servers, nil
}

func scanDesktopServer(scanner desktopServerScanner) (DesktopServer, error) {
	var server DesktopServer
	var tagsJSON string
	var keyID sql.NullString

	err := scanner.Scan(
		&server.ID,
		&server.UserID,
		&server.Name,
		&server.Host,
		&server.Port,
		&server.Username,
		&server.AuthMethod,
		&server.Password,
		&keyID,
		&server.GroupID,
		&server.Group,
		&tagsJSON,
		&server.LastConnected,
		&server.Description,
		&server.OS,
		&server.CreatedAt,
		&server.UpdatedAt,
		&server.connectionRevision,
		&server.sortOrder,
	)
	if err != nil {
		return DesktopServer{}, err
	}

	if strings.TrimSpace(tagsJSON) != "" {
		if err := json.Unmarshal([]byte(tagsJSON), &server.Tags); err != nil {
			server.Tags = []string{}
		}
	}

	server.SSHKeyID = desktopSSHKeyID(keyID)
	server.AuthMethod = normalizeDesktopServerAuthMethod(server.AuthMethod)
	if server.Tags == nil {
		server.Tags = []string{}
	}

	return server, nil
}

// desktopPublicServer only exports protocol fields; stored credentials never enter the DTO.
func desktopPublicServer(server DesktopServer, connected bool) (protocol.Server, error) {
	id, err := uuid.Parse(server.ID)
	if err != nil {
		return protocol.Server{}, err
	}
	auth := protocol.ServerAuthMethod(server.AuthMethod)
	hasPassword, hasPrivateKey := server.Password != "", server.SSHKeyID != nil
	tags := server.Tags
	if tags == nil {
		tags = []string{}
	}
	result := protocol.Server{
		ID: id, Name: server.Name, Host: server.Host, Port: server.Port, Username: server.Username,
		OS: server.OS, Connected: &connected, AuthMethod: &auth, ConnectionRevision: &server.connectionRevision,
		HasPassword: &hasPassword, HasPrivateKey: &hasPrivateKey, GroupID: &server.GroupID,
		Group: &server.Group, Tags: &tags, Description: &server.Description, SortOrder: &server.sortOrder,
	}
	if server.SSHKeyID != nil {
		keyID, err := uuid.Parse(*server.SSHKeyID)
		if err != nil {
			return protocol.Server{}, err
		}
		result.SSHKeyID = &keyID
	}
	created, err := time.Parse(time.RFC3339Nano, server.CreatedAt)
	if err != nil {
		return protocol.Server{}, err
	}
	updated, err := time.Parse(time.RFC3339Nano, server.UpdatedAt)
	if err != nil {
		return protocol.Server{}, err
	}
	result.CreatedAt, result.UpdatedAt = &created, &updated
	if server.LastConnected != "" {
		last, err := time.Parse(time.RFC3339Nano, server.LastConnected)
		if err != nil {
			return protocol.Server{}, err
		}
		result.LastConnected = &last
	}
	return result, nil
}

// Merge only explicitly supplied fields. Secrets remain encrypted until an actual change is requested.
func mergeDesktopServerUpdate(current DesktopServer, input protocol.ServerUpdate) (DesktopServer, error) {
	merged := protocol.ServerCreate{
		Name: current.Name, Host: current.Host, Port: current.Port, Username: current.Username,
		AuthMethod: protocol.ServerAuthMethod(current.AuthMethod), GroupID: current.GroupID,
		Tags: current.Tags, Description: current.Description, PrivateKeyPassphrase: input.PrivateKeyPassphrase,
	}
	if input.Name != nil {
		merged.Name = *input.Name
	}
	if input.Host != nil {
		merged.Host = *input.Host
	}
	if input.Port != nil {
		if *input.Port < 1 || *input.Port > 65535 {
			return DesktopServer{}, errors.New("invalid server port")
		}
		merged.Port = *input.Port
	}
	if input.Username != nil {
		merged.Username = *input.Username
	}
	if input.AuthMethod != nil {
		merged.AuthMethod = *input.AuthMethod
	}
	if input.GroupID != nil {
		merged.GroupID = *input.GroupID
	}
	if input.Tags != nil {
		merged.Tags = *input.Tags
	}
	if input.Description != nil {
		merged.Description = *input.Description
	}
	if input.Password != nil {
		merged.Password = *input.Password
	}
	if input.PrivateKey != nil {
		merged.PrivateKey = *input.PrivateKey
	}
	return normalizeDesktopServerInput(merged)
}

func newDesktopServerID() string { return uuid.NewString() }

func assignDesktopSSHKey(tx *sql.Tx, server *DesktopServer, keyID *uuid.UUID, privateKey *string, passphrase string) error {
	if !server.AuthMethod.RequiresPrivateKey() {
		server.SSHKeyID = nil
		return nil
	}
	if keyID != nil && privateKey != nil && *privateKey != "" {
		return errors.New("choose a saved SSH key or import a key, not both")
	}
	if keyID != nil {
		if *keyID == uuid.Nil {
			server.SSHKeyID = nil
			return nil
		}
		var id string
		if err := tx.QueryRow("SELECT id FROM desktop_ssh_keys WHERE id = ?", keyID.String()).Scan(&id); err != nil {
			return err
		}
		server.SSHKeyID = &id
		return nil
	}
	if privateKey == nil || *privateKey == "" {
		if privateKey != nil {
			server.SSHKeyID = nil
		}
		return nil
	}
	key, err := importDesktopSSHKey(tx, protocol.SSHKeyImportInput{Name: server.Host, PrivateKey: *privateKey, Passphrase: passphrase})
	if err != nil {
		return err
	}
	importedID := key.ID.String()
	server.SSHKeyID = &importedID
	return nil
}

// Call on a raw (decrypted) server snapshot, as used to build SSH authentication.
func (s DesktopServer) credentialDigest() [32]byte {
	return sshutil.CredentialDigest(s.Password, s.PrivateKey, s.SavedPrivateKeyPassphrase)
}
