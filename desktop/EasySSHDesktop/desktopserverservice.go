package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/crypto/ssh"
	_ "modernc.org/sqlite"
)

type DesktopServerAuthMethod string

const (
	DesktopServerAuthPassword DesktopServerAuthMethod = "password"
	DesktopServerAuthKey      DesktopServerAuthMethod = "key"
)

type DesktopServerStatus string

const (
	DesktopServerOnline  DesktopServerStatus = "online"
	DesktopServerOffline DesktopServerStatus = "offline"
)

type DesktopServer struct {
	ID            string                  `json:"id"`
	UserID        string                  `json:"user_id"`
	Name          string                  `json:"name,omitempty"`
	Host          string                  `json:"host"`
	Port          int                     `json:"port"`
	Username      string                  `json:"username"`
	AuthMethod    DesktopServerAuthMethod `json:"auth_method"`
	Password      string                  `json:"password,omitempty"`
	PrivateKey    string                  `json:"private_key,omitempty"`
	Group         string                  `json:"group,omitempty"`
	Tags          []string                `json:"tags,omitempty"`
	Status        DesktopServerStatus     `json:"status"`
	LastConnected string                  `json:"last_connected,omitempty"`
	Description   string                  `json:"description,omitempty"`
	CreatedAt     string                  `json:"created_at"`
	UpdatedAt     string                  `json:"updated_at"`
}

type DesktopServerListParams struct {
	Page   int    `json:"page,omitempty"`
	Limit  int    `json:"limit,omitempty"`
	Search string `json:"search,omitempty"`
	Group  string `json:"group,omitempty"`
}

type DesktopServerListResult struct {
	Data  []DesktopServer `json:"data"`
	Total int             `json:"total"`
	Page  int             `json:"page"`
	Limit int             `json:"limit"`
}

type DesktopServerInput struct {
	Name        string                  `json:"name,omitempty"`
	Host        string                  `json:"host"`
	Port        int                     `json:"port"`
	Username    string                  `json:"username"`
	AuthMethod  DesktopServerAuthMethod `json:"auth_method"`
	Password    string                  `json:"password,omitempty"`
	PrivateKey  string                  `json:"private_key,omitempty"`
	Group       string                  `json:"group,omitempty"`
	Tags        []string                `json:"tags,omitempty"`
	Description string                  `json:"description,omitempty"`
}

type DesktopServerCommandInput struct {
	ServerID  string `json:"serverId"`
	Command   string `json:"command"`
	TimeoutMs int    `json:"timeoutMs,omitempty"`
}

type DesktopServerCommandResult struct {
	ServerID    string `json:"serverId"`
	Command     string `json:"command"`
	Output      string `json:"output"`
	ExitCode    int    `json:"exitCode"`
	DurationMs  int64  `json:"durationMs"`
	StartedAt   string `json:"startedAt"`
	CompletedAt string `json:"completedAt"`
}

type desktopSSHCredential struct {
	AuthMethod           DesktopServerAuthMethod
	Secret               string
	PrivateKeyPassphrase string
}

type DesktopServerService struct {
	mu sync.Mutex
	db *sql.DB
}

func NewDesktopServerService() *DesktopServerService {
	return &DesktopServerService{}
}

func (s *DesktopServerService) ServiceName() string {
	return "DesktopServerService"
}

func (s *DesktopServerService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	_, err := s.database()
	return err
}

func (s *DesktopServerService) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return nil
	}

	err := s.db.Close()
	s.db = nil
	return err
}

func (s *DesktopServerService) List(params DesktopServerListParams) (DesktopServerListResult, error) {
	database, err := s.database()
	if err != nil {
		return DesktopServerListResult{}, err
	}

	params = normalizeDesktopServerListParams(params)
	where, args := buildDesktopServerWhere(params)

	var total int
	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM desktop_servers WHERE %s", where)
	if err := database.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return DesktopServerListResult{}, err
	}

	offset := (params.Page - 1) * params.Limit
	queryArgs := append(append([]any{}, args...), params.Limit, offset)
	querySQL := fmt.Sprintf(`
		SELECT id, user_id, name, host, port, username, auth_method, password, private_key,
			server_group, tags_json, status, last_connected, description, created_at, updated_at
		FROM desktop_servers
		WHERE %s
		ORDER BY sort_order ASC, created_at ASC, id ASC
		LIMIT ? OFFSET ?`, where)

	rows, err := database.Query(querySQL, queryArgs...)
	if err != nil {
		return DesktopServerListResult{}, err
	}
	defer rows.Close()

	servers, err := scanDesktopServers(rows)
	if err != nil {
		return DesktopServerListResult{}, err
	}

	return DesktopServerListResult{
		Data:  servers,
		Total: total,
		Page:  params.Page,
		Limit: params.Limit,
	}, nil
}

func (s *DesktopServerService) GetById(id string) (DesktopServer, error) {
	database, err := s.database()
	if err != nil {
		return DesktopServer{}, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return DesktopServer{}, errors.New("server id is required")
	}

	row := database.QueryRow(`
		SELECT id, user_id, name, host, port, username, auth_method, password, private_key,
			server_group, tags_json, status, last_connected, description, created_at, updated_at
		FROM desktop_servers
		WHERE id = ?`, id)

	return scanDesktopServer(row)
}

func (s *DesktopServerService) Create(input DesktopServerInput) (DesktopServer, error) {
	database, err := s.database()
	if err != nil {
		return DesktopServer{}, err
	}

	server, tagsJSON, err := normalizeDesktopServerInput(input)
	if err != nil {
		return DesktopServer{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	server.ID = newDesktopServerID()
	server.UserID = "local"
	server.Status = DesktopServerOffline
	server.CreatedAt = now
	server.UpdatedAt = now

	var sortOrder int
	if err := database.QueryRow("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM desktop_servers").Scan(&sortOrder); err != nil {
		return DesktopServer{}, err
	}

	_, err = database.Exec(`
		INSERT INTO desktop_servers (
			id, user_id, name, host, port, username, auth_method, password, private_key,
			server_group, tags_json, status, last_connected, description, sort_order, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		server.ID, server.UserID, server.Name, server.Host, server.Port, server.Username,
		server.AuthMethod, server.Password, server.PrivateKey, server.Group, tagsJSON,
		server.Status, server.LastConnected, server.Description, sortOrder, server.CreatedAt, server.UpdatedAt)
	if err != nil {
		return DesktopServer{}, err
	}

	return s.GetById(server.ID)
}

func (s *DesktopServerService) Update(id string, input DesktopServerInput) (DesktopServer, error) {
	database, err := s.database()
	if err != nil {
		return DesktopServer{}, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return DesktopServer{}, errors.New("server id is required")
	}

	server, tagsJSON, err := normalizeDesktopServerInput(input)
	if err != nil {
		return DesktopServer{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := database.Exec(`
		UPDATE desktop_servers
		SET name = ?, host = ?, port = ?, username = ?, auth_method = ?, password = ?, private_key = ?,
			server_group = ?, tags_json = ?, description = ?, updated_at = ?
		WHERE id = ?`,
		server.Name, server.Host, server.Port, server.Username, server.AuthMethod,
		server.Password, server.PrivateKey, server.Group, tagsJSON, server.Description, now, id)
	if err != nil {
		return DesktopServer{}, err
	}

	if changed, _ := result.RowsAffected(); changed == 0 {
		return DesktopServer{}, sql.ErrNoRows
	}

	return s.GetById(id)
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

	_, err = database.Exec("DELETE FROM desktop_servers WHERE id = ?", id)
	return err
}

func (s *DesktopServerService) Reorder(serverIds []string) error {
	database, err := s.database()
	if err != nil {
		return err
	}

	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	for index, id := range serverIds {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}

		if _, err := tx.Exec("UPDATE desktop_servers SET sort_order = ?, updated_at = ? WHERE id = ?", index, now, id); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *DesktopServerService) MarkConnected(id string) (DesktopServer, error) {
	database, err := s.database()
	if err != nil {
		return DesktopServer{}, err
	}

	id = strings.TrimSpace(id)
	if id == "" {
		return DesktopServer{}, errors.New("server id is required")
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	result, err := database.Exec(`
		UPDATE desktop_servers
		SET status = ?, last_connected = ?, updated_at = ?
		WHERE id = ?`, DesktopServerOnline, now, now, id)
	if err != nil {
		return DesktopServer{}, err
	}

	if changed, _ := result.RowsAffected(); changed == 0 {
		return DesktopServer{}, sql.ErrNoRows
	}

	return s.GetById(id)
}

func (s *DesktopServerService) ExecuteCommand(input DesktopServerCommandInput) (DesktopServerCommandResult, error) {
	serverID := strings.TrimSpace(input.ServerID)
	command := strings.TrimSpace(input.Command)
	if serverID == "" {
		return DesktopServerCommandResult{}, errors.New("server id is required")
	}
	if command == "" {
		return DesktopServerCommandResult{}, errors.New("command is required")
	}

	server, err := s.GetById(serverID)
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

	started := time.Now().UTC()
	config := &ssh.ClientConfig{
		User:            server.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         12 * time.Second,
	}

	address := net.JoinHostPort(server.Host, strconv.Itoa(server.Port))
	client, err := ssh.Dial("tcp", address, config)
	if err != nil {
		completed := time.Now().UTC()
		return DesktopServerCommandResult{
			ServerID:    serverID,
			Command:     command,
			Output:      err.Error(),
			ExitCode:    255,
			DurationMs:  completed.Sub(started).Milliseconds(),
			StartedAt:   started.Format(time.RFC3339Nano),
			CompletedAt: completed.Format(time.RFC3339Nano),
		}, nil
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		completed := time.Now().UTC()
		return DesktopServerCommandResult{
			ServerID:    serverID,
			Command:     command,
			Output:      err.Error(),
			ExitCode:    255,
			DurationMs:  completed.Sub(started).Milliseconds(),
			StartedAt:   started.Format(time.RFC3339Nano),
			CompletedAt: completed.Format(time.RFC3339Nano),
		}, nil
	}
	defer session.Close()

	type commandResponse struct {
		output []byte
		err    error
	}

	done := make(chan commandResponse, 1)
	go func() {
		output, err := session.CombinedOutput(command)
		done <- commandResponse{output: output, err: err}
	}()

	var output []byte
	exitCode := 0
	select {
	case response := <-done:
		output = response.output
		if response.err != nil {
			exitCode = 1
			var exitErr *ssh.ExitError
			if errors.As(response.err, &exitErr) {
				exitCode = exitErr.ExitStatus()
			}
		}
	case <-time.After(timeout):
		client.Close()
		completed := time.Now().UTC()
		return DesktopServerCommandResult{
			ServerID:    serverID,
			Command:     command,
			Output:      "command timed out",
			ExitCode:    124,
			DurationMs:  completed.Sub(started).Milliseconds(),
			StartedAt:   started.Format(time.RFC3339Nano),
			CompletedAt: completed.Format(time.RFC3339Nano),
		}, nil
	}

	completed := time.Now().UTC()
	return DesktopServerCommandResult{
		ServerID:    serverID,
		Command:     command,
		Output:      normalizeDesktopCommandOutput(string(output)),
		ExitCode:    exitCode,
		DurationMs:  completed.Sub(started).Milliseconds(),
		StartedAt:   started.Format(time.RFC3339Nano),
		CompletedAt: completed.Format(time.RFC3339Nano),
	}, nil
}

func (s *DesktopServerService) database() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

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

	if err := configureDesktopServerDatabase(database); err != nil {
		database.Close()
		return nil, err
	}

	s.db = database
	return s.db, nil
}

func configureDesktopServerDatabase(database *sql.DB) error {
	database.SetMaxOpenConns(1)

	statements := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
		`CREATE TABLE IF NOT EXISTS desktop_servers (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT 'local',
			name TEXT NOT NULL DEFAULT '',
			host TEXT NOT NULL,
			port INTEGER NOT NULL DEFAULT 22,
			username TEXT NOT NULL,
			auth_method TEXT NOT NULL DEFAULT 'password',
			password TEXT NOT NULL DEFAULT '',
			private_key TEXT NOT NULL DEFAULT '',
			server_group TEXT NOT NULL DEFAULT '',
			tags_json TEXT NOT NULL DEFAULT '[]',
			status TEXT NOT NULL DEFAULT 'offline',
			last_connected TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '',
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		"CREATE INDEX IF NOT EXISTS idx_desktop_servers_host ON desktop_servers (host)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_servers_group ON desktop_servers (server_group)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_servers_sort ON desktop_servers (sort_order)",
	}

	for _, statement := range statements {
		if _, err := database.Exec(statement); err != nil {
			return err
		}
	}

	return database.Ping()
}

func normalizeDesktopServerListParams(params DesktopServerListParams) DesktopServerListParams {
	if params.Page < 1 {
		params.Page = 1
	}

	if params.Limit < 1 {
		params.Limit = 100
	}

	if params.Limit > 500 {
		params.Limit = 500
	}

	params.Search = strings.TrimSpace(params.Search)
	params.Group = strings.TrimSpace(params.Group)
	if strings.EqualFold(params.Group, "all") {
		params.Group = ""
	}

	return params
}

func buildDesktopServerWhere(params DesktopServerListParams) (string, []any) {
	params = normalizeDesktopServerListParams(params)
	clauses := []string{"1 = 1"}
	args := make([]any, 0)

	if params.Group != "" {
		clauses = append(clauses, "server_group = ?")
		args = append(args, params.Group)
	}

	if params.Search != "" {
		like := "%" + strings.ToLower(params.Search) + "%"
		clauses = append(clauses, `(LOWER(name) LIKE ? OR LOWER(host) LIKE ? OR LOWER(username) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags_json) LIKE ?)`)
		args = append(args, like, like, like, like, like)
	}

	return strings.Join(clauses, " AND "), args
}

func normalizeDesktopServerInput(input DesktopServerInput) (DesktopServer, string, error) {
	host := strings.TrimSpace(input.Host)
	if host == "" {
		return DesktopServer{}, "", errors.New("server host is required")
	}

	username := strings.TrimSpace(input.Username)
	if username == "" {
		return DesktopServer{}, "", errors.New("server username is required")
	}

	port := input.Port
	if port < 1 || port > 65535 {
		port = 22
	}

	authMethod := input.AuthMethod
	if authMethod == "" {
		authMethod = DesktopServerAuthPassword
	}
	if !isValidDesktopServerAuthMethod(authMethod) {
		return DesktopServer{}, "", fmt.Errorf("unsupported auth method: %s", authMethod)
	}

	tags := normalizeDesktopServerTags(input.Tags)
	tagsJSONBytes, err := json.Marshal(tags)
	if err != nil {
		return DesktopServer{}, "", err
	}

	return DesktopServer{
		Name:        strings.TrimSpace(input.Name),
		Host:        host,
		Port:        port,
		Username:    username,
		AuthMethod:  authMethod,
		Password:    input.Password,
		PrivateKey:  input.PrivateKey,
		Group:       strings.TrimSpace(input.Group),
		Tags:        tags,
		Description: strings.TrimSpace(input.Description),
	}, string(tagsJSONBytes), nil
}

func normalizeDesktopServerTags(tags []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[tag] {
			continue
		}

		seen[tag] = true
		result = append(result, tag)
	}

	return result
}

func isValidDesktopServerAuthMethod(method DesktopServerAuthMethod) bool {
	switch method {
	case DesktopServerAuthPassword, DesktopServerAuthKey:
		return true
	default:
		return false
	}
}

func buildDesktopServerSSHAuthMethods(server DesktopServer) ([]ssh.AuthMethod, error) {
	return buildDesktopServerSSHAuthMethodsWithCredential(server, nil)
}

func buildDesktopServerSSHAuthMethodsWithCredential(server DesktopServer, credential *desktopSSHCredential) ([]ssh.AuthMethod, error) {
	authMethods := make([]ssh.AuthMethod, 0, 2)
	if credential != nil {
		switch credential.AuthMethod {
		case DesktopServerAuthPassword:
			if strings.TrimSpace(credential.Secret) != "" {
				authMethods = append(authMethods, ssh.Password(credential.Secret))
			}
			return authMethods, nil
		case DesktopServerAuthKey:
			privateKey := strings.TrimSpace(credential.Secret)
			if privateKey == "" {
				privateKey = strings.TrimSpace(server.PrivateKey)
			}
			if privateKey == "" {
				return authMethods, nil
			}

			signer, err := parseDesktopPrivateKey(privateKey, credential.PrivateKeyPassphrase)
			if err != nil {
				return nil, err
			}

			authMethods = append(authMethods, ssh.PublicKeys(signer))
			return authMethods, nil
		default:
			return nil, fmt.Errorf("unsupported auth method: %s", credential.AuthMethod)
		}
	}

	if server.AuthMethod == DesktopServerAuthPassword {
		if strings.TrimSpace(server.Password) != "" {
			authMethods = append(authMethods, ssh.Password(server.Password))
		}
		return authMethods, nil
	}

	privateKey := strings.TrimSpace(server.PrivateKey)
	if privateKey == "" {
		return authMethods, nil
	}

	signer, err := parseDesktopPrivateKey(privateKey, server.Password)
	if err != nil {
		return nil, err
	}

	authMethods = append(authMethods, ssh.PublicKeys(signer))
	return authMethods, nil
}

func parseDesktopPrivateKey(privateKey string, passphrase string) (ssh.Signer, error) {
	signer, err := ssh.ParsePrivateKey([]byte(privateKey))
	if err == nil {
		return signer, nil
	}

	var missingPassphrase *ssh.PassphraseMissingError
	if !errors.As(err, &missingPassphrase) {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	if strings.TrimSpace(passphrase) == "" {
		return nil, fmt.Errorf("private_key_passphrase_required: %w", err)
	}

	signer, passphraseErr := ssh.ParsePrivateKeyWithPassphrase([]byte(privateKey), []byte(passphrase))
	if passphraseErr != nil {
		return nil, fmt.Errorf("private_key_passphrase_invalid: %w", passphraseErr)
	}

	return signer, nil
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

	err := scanner.Scan(
		&server.ID,
		&server.UserID,
		&server.Name,
		&server.Host,
		&server.Port,
		&server.Username,
		&server.AuthMethod,
		&server.Password,
		&server.PrivateKey,
		&server.Group,
		&tagsJSON,
		&server.Status,
		&server.LastConnected,
		&server.Description,
		&server.CreatedAt,
		&server.UpdatedAt,
	)
	if err != nil {
		return DesktopServer{}, err
	}

	if strings.TrimSpace(tagsJSON) != "" {
		if err := json.Unmarshal([]byte(tagsJSON), &server.Tags); err != nil {
			server.Tags = []string{}
		}
	}

	if server.Tags == nil {
		server.Tags = []string{}
	}

	return server, nil
}

func newDesktopServerID() string {
	var randomBytes [8]byte
	if _, err := rand.Read(randomBytes[:]); err == nil {
		return fmt.Sprintf("srv_%d_%s", time.Now().UnixNano(), hex.EncodeToString(randomBytes[:]))
	}

	return fmt.Sprintf("srv_%d", time.Now().UnixNano())
}
