package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/zalando/go-keyring"
)

type DesktopRemoteWorkspace struct {
	ID           string `json:"id"`
	Origin       string `json:"origin"`
	GrantID      string `json:"grant_id"`
	PublicID     string `json:"public_id"`
	Name         string `json:"name"`
	ExpiresAt    string `json:"expires_at"`
	LastOpenedAt string `json:"last_opened_at"`
}

type DesktopRemoteWorkspaceContext struct {
	Workspace DesktopRemoteWorkspace `json:"workspace"`
	Access    protocol.AccessContext `json:"access"`
}

type desktopRemoteSessionSecret struct {
	Origin    string `json:"origin"`
	GrantID   string `json:"grant_id"`
	SessionID string `json:"session_id"`
	Token     string `json:"token"`
}

type desktopRemoteSession struct {
	client             *desktopRemoteClient
	transferStore      *desktopRemoteTransferStore
	workspace          DesktopRemoteWorkspace
	window             *application.WebviewWindow
	ctx                context.Context
	cancel             context.CancelFunc
	resourcesMu        sync.Mutex
	connections        map[string]protocol.ConnectionInfo
	streams            map[string]*desktopRemoteStream
	selections         map[string]*desktopRemoteFileSelection
	transfers          map[string]*desktopRemoteTransfer
	pendingConnections int
	stopping           bool
	opening            sync.WaitGroup
}

type desktopPendingHandoff struct {
	origin, id, verifier, confirmation string
	expires                            time.Time
}

type DesktopHandoffPending struct {
	ID           string    `json:"id"` // local request handle, never the verifier
	Origin       string    `json:"origin"`
	Confirmation string    `json:"confirmation"`
	ExpiresAt    time.Time `json:"expires_at"`
}

type DesktopRemoteWorkspaceService struct {
	servers    *DesktopServerService
	boundary   *desktopNativeBoundary
	app        *application.App
	mu         sync.Mutex
	management sync.Mutex
	fileDialog sync.Mutex
	sessions   map[string]*desktopRemoteSession
	handoffs   map[string]desktopPendingHandoff
	incoming   map[string]desktopIncomingLaunch
	ctx        context.Context
	cancel     context.CancelFunc
	closed     bool
	workers    sync.WaitGroup
}

func newDesktopRemoteWorkspaceService(servers *DesktopServerService, boundary *desktopNativeBoundary) *DesktopRemoteWorkspaceService {
	ctx, cancel := context.WithCancel(context.Background())
	return &DesktopRemoteWorkspaceService{servers: servers, boundary: boundary, sessions: make(map[string]*desktopRemoteSession),
		handoffs: make(map[string]desktopPendingHandoff), incoming: make(map[string]desktopIncomingLaunch), ctx: ctx, cancel: cancel}
}

func (s *DesktopRemoteWorkspaceService) ServiceShutdown() error {
	s.cancel()
	s.management.Lock()
	defer s.management.Unlock()
	s.mu.Lock()
	s.closed = true
	for _, session := range s.sessions {
		session.cancel()
		session.client.close()
	}
	clear(s.handoffs)
	clear(s.incoming)
	s.mu.Unlock()
	s.workers.Wait()
	return nil
}

func (s *DesktopRemoteWorkspaceService) requireOwner(ctx context.Context) error {
	id, ok := application.RuntimeWindowID(ctx)
	if !ok {
		return errors.New("action is not permitted")
	}
	window, ok := s.boundary.lookup(id)
	if !ok || window.workspaceID != "" {
		return errors.New("action is not permitted")
	}
	if s.ctx.Err() != nil {
		return s.ctx.Err()
	}
	return nil
}

func (s *DesktopRemoteWorkspaceService) List(ctx context.Context) ([]DesktopRemoteWorkspace, error) {
	if err := s.requireOwner(ctx); err != nil {
		return nil, err
	}
	db, err := s.servers.database()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT id,origin,grant_id,public_id,name,expires_at,last_opened_at FROM desktop_remote_workspaces ORDER BY last_opened_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]DesktopRemoteWorkspace, 0)
	for rows.Next() {
		var value DesktopRemoteWorkspace
		if err := rows.Scan(&value.ID, &value.Origin, &value.GrantID, &value.PublicID, &value.Name, &value.ExpiresAt, &value.LastOpenedAt); err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}

func (s *DesktopRemoteWorkspaceService) metadata(ctx context.Context, id string) (DesktopRemoteWorkspace, error) {
	var value DesktopRemoteWorkspace
	if !validRemoteUUID(id) {
		return value, remoteError("invalid_workspace")
	}
	db, err := s.servers.database()
	if err != nil {
		return value, err
	}
	err = db.QueryRowContext(ctx, `SELECT id,origin,grant_id,public_id,name,expires_at,last_opened_at FROM desktop_remote_workspaces WHERE id=?`, id).
		Scan(&value.ID, &value.Origin, &value.GrantID, &value.PublicID, &value.Name, &value.ExpiresAt, &value.LastOpenedAt)
	return value, err
}

func desktopRemoteKeyAccount(id string) string {
	// Bind entries to this local installation, so restored metadata in another
	// directory does not silently revive a previous desktop access session.
	root := filepath.Clean(desktopDataDir())
	hash := sha256.Sum256([]byte(root))
	return "remote-access/" + hex.EncodeToString(hash[:]) + "/" + id
}

func (s *DesktopRemoteWorkspaceService) loadClient(value DesktopRemoteWorkspace) (*desktopRemoteClient, error) {
	encoded, err := keyring.Get("EasySSH Desktop", desktopRemoteKeyAccount(value.ID))
	if errors.Is(err, keyring.ErrNotFound) {
		return nil, remoteError("reauthorization_required")
	}
	if err != nil {
		return nil, remoteError("credential_store_locked")
	}
	var secret desktopRemoteSessionSecret
	if len(encoded) > 4096 || json.Unmarshal([]byte(encoded), &secret) != nil || secret.Origin != value.Origin || secret.GrantID != value.GrantID || !validRemoteUUID(secret.SessionID) {
		return nil, remoteError("reauthorization_required")
	}
	token, err := base64.RawURLEncoding.DecodeString(secret.Token)
	if err != nil || len(token) != 32 {
		return nil, remoteError("reauthorization_required")
	}
	client, err := newDesktopRemoteClient(value.Origin)
	if err != nil {
		return nil, err
	}
	client.token, client.sessionID, client.grantID = secret.Token, secret.SessionID, secret.GrantID
	return client, nil
}

func (s *DesktopRemoteWorkspaceService) saveClient(ctx context.Context, client *desktopRemoteClient, publicID string, info protocol.AccessContext) (DesktopRemoteWorkspace, error) {
	value := DesktopRemoteWorkspace{ID: uuid.NewString(), Origin: client.origin, GrantID: info.Actor.GrantID, PublicID: publicID,
		Name: info.GrantName, ExpiresAt: info.ExpiresAt.UTC().Format(time.RFC3339Nano), LastOpenedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	db, err := s.servers.database()
	if err != nil {
		return value, err
	}
	var previousID, previousPublicID string
	err = db.QueryRowContext(ctx, `SELECT id,public_id FROM desktop_remote_workspaces WHERE origin=? AND grant_id=?`, value.Origin, value.GrantID).Scan(&previousID, &previousPublicID)
	if err == nil {
		value.ID = previousID
		if value.PublicID == "" {
			value.PublicID = previousPublicID
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return value, err
	}
	_, err = db.ExecContext(ctx, `INSERT INTO desktop_remote_workspaces(id,origin,grant_id,public_id,name,expires_at,last_opened_at) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(origin,grant_id) DO UPDATE SET public_id=excluded.public_id,name=excluded.name,expires_at=excluded.expires_at,last_opened_at=excluded.last_opened_at`,
		value.ID, value.Origin, value.GrantID, value.PublicID, value.Name, value.ExpiresAt, value.LastOpenedAt)
	if err != nil {
		return value, err
	}
	encoded, err := json.Marshal(desktopRemoteSessionSecret{client.origin, client.grantID, client.sessionID, client.token})
	if err != nil {
		return value, err
	}
	if err = keyring.Set("EasySSH Desktop", desktopRemoteKeyAccount(value.ID), string(encoded)); err != nil {
		return value, remoteError("credential_store_locked")
	}
	return value, nil
}

func (s *DesktopRemoteWorkspaceService) OpenShare(ctx context.Context, raw string) (DesktopRemoteWorkspace, error) {
	if err := s.requireOwner(ctx); err != nil {
		return DesktopRemoteWorkspace{}, err
	}
	link, err := parseDesktopShareLink(raw)
	if err != nil {
		return DesktopRemoteWorkspace{}, err
	}
	s.management.Lock()
	defer s.management.Unlock()
	client, err := newDesktopRemoteClient(link.origin)
	if err != nil {
		return DesktopRemoteWorkspace{}, err
	}
	db, err := s.servers.database()
	if err != nil {
		client.close()
		return DesktopRemoteWorkspace{}, err
	}
	var previousID string
	err = db.QueryRowContext(ctx, `SELECT id FROM desktop_remote_workspaces WHERE origin=? AND public_id=?`, link.origin, link.publicID).Scan(&previousID)
	if err == nil {
		previous, err := s.metadata(ctx, previousID)
		if err != nil {
			client.close()
			return DesktopRemoteWorkspace{}, err
		}
		saved, err := s.loadClient(previous)
		if err == nil {
			client.close()
			client = saved
		} else {
			var remote *desktopRemoteError
			if !errors.As(err, &remote) || remote.code != "reauthorization_required" {
				client.close()
				return DesktopRemoteWorkspace{}, err
			}
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		client.close()
		return DesktopRemoteWorkspace{}, err
	}
	previousSessionID := client.sessionID
	info, err := client.exchange(ctx, link)
	if err != nil {
		client.close()
		return DesktopRemoteWorkspace{}, err
	}
	return s.finishExchange(ctx, client, link.publicID, info, previousSessionID != client.sessionID)
}

func (s *DesktopRemoteWorkspaceService) finishExchange(ctx context.Context, client *desktopRemoteClient, publicID string, info protocol.AccessContext, revokeOnFailure bool) (DesktopRemoteWorkspace, error) {
	value, err := s.saveClient(ctx, client, publicID, info)
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if revokeOnFailure {
			_ = client.endSession(cleanup)
		}
		client.close()
		return DesktopRemoteWorkspace{}, err
	}
	if err := s.openWindow(value, client); err != nil {
		client.close()
		return value, err
	}
	return value, nil
}

func (s *DesktopRemoteWorkspaceService) OpenRecent(ctx context.Context, id string) (DesktopRemoteWorkspace, error) {
	if err := s.requireOwner(ctx); err != nil {
		return DesktopRemoteWorkspace{}, err
	}
	s.management.Lock()
	defer s.management.Unlock()
	value, err := s.metadata(ctx, id)
	if err != nil {
		return value, err
	}
	client, err := s.loadClient(value)
	if err != nil {
		return value, err
	}
	info, err := client.currentContext(ctx)
	if err != nil {
		client.close()
		return value, err
	}
	return s.finishExchange(ctx, client, value.PublicID, info, false)
}

func (s *DesktopRemoteWorkspaceService) openWindow(value DesktopRemoteWorkspace, client *desktopRemoteClient) error {
	s.mu.Lock()
	if s.closed || s.app == nil {
		s.mu.Unlock()
		return remoteError("desktop_unavailable")
	}
	old := s.sessions[value.ID]
	if old != nil && old.client.sessionID == client.sessionID {
		s.mu.Unlock()
		client.close()
		if old.ctx.Err() != nil {
			return remoteError("workspace_closing")
		}
		old.window.Show()
		old.window.Focus()
		return nil
	}
	expires, err := time.Parse(time.RFC3339Nano, value.ExpiresAt)
	if err != nil || !expires.After(time.Now()) {
		s.mu.Unlock()
		return remoteError("reauthorization_required")
	}
	db, err := s.servers.database()
	if err != nil {
		s.mu.Unlock()
		return remoteError("transfer_store_unavailable")
	}
	transferStore := &desktopRemoteTransferStore{db: db, workspaceID: value.ID, origin: client.origin, actor: protocol.Actor{Kind: protocol.Visitor, ID: client.sessionID, SessionID: client.sessionID, GrantID: client.grantID}}
	if err := transferStore.recoverStopped(s.ctx); err != nil {
		s.mu.Unlock()
		return err
	}
	sessionCtx, cancel := context.WithDeadline(s.ctx, expires)
	session := &desktopRemoteSession{client: client, transferStore: transferStore, workspace: value, ctx: sessionCtx, cancel: cancel, connections: make(map[string]protocol.ConnectionInfo), streams: make(map[string]*desktopRemoteStream), selections: make(map[string]*desktopRemoteFileSelection), transfers: make(map[string]*desktopRemoteTransfer)}
	window := application.NewWindow(application.WebviewWindowOptions{
		Name: "remote-" + uuid.NewString(), Title: value.Name + " · " + value.Origin, Width: 1320, Height: 860, MinWidth: 960, MinHeight: 620,
		URL: "/#/remote-workspace/" + value.ID, RestrictNavigation: true, IsolatedStorage: true, EnableFileDrop: false,
	})
	session.window = window
	s.sessions[value.ID] = session
	s.workers.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.workers.Done()
		session.run()
		s.mu.Lock()
		if s.sessions[value.ID] == session {
			delete(s.sessions, value.ID)
		}
		s.mu.Unlock()
	}()
	if old != nil {
		old.cancel()
		old.window.Close()
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = old.client.endSession(cleanup)
		cancel()
		old.client.close()
	}
	// Register before any asset loads or runtime calls can originate in it.
	s.boundary.register(window, value.ID)
	window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		cancel()
		client.close()
	})
	s.app.Window.Add(window)
	window.Run()
	return nil
}

func (s *DesktopRemoteWorkspaceService) session(ctx context.Context) (*desktopRemoteSession, context.Context, func(), error) {
	id, err := s.boundary.remoteWorkspace(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	nativeID, _ := application.RuntimeWindowID(ctx)
	s.mu.Lock()
	value := s.sessions[id]
	s.mu.Unlock()
	if value == nil || value.window.ID() != nativeID {
		return nil, nil, nil, remoteError("workspace_closed")
	}
	requestCtx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(value.ctx, cancel)
	return value, requestCtx, func() { stop(); cancel() }, nil
}

func (s *DesktopRemoteWorkspaceService) Context(ctx context.Context) (DesktopRemoteWorkspaceContext, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteWorkspaceContext{}, err
	}
	defer done()
	info, err := session.client.currentContext(ctx)
	if err != nil {
		if isRemoteAccessEnded(err) {
			session.cancel()
		}
		return DesktopRemoteWorkspaceContext{}, err
	}
	return DesktopRemoteWorkspaceContext{session.workspace, info}, nil
}

func desktopRemoteBindingAllowed(name string) bool {
	t := reflect.TypeFor[DesktopRemoteWorkspaceService]()
	prefix := t.PkgPath() + "." + t.Name() + "."
	for _, method := range []string{"Context", "CreateConnection", "HeartbeatConnection", "CloseConnection",
		"OpenRemoteDesktop", "WriteRemoteDesktop",
		"RemoteAIConfig", "ListRemoteAISessions", "RemoteAIHistory", "GetRemoteAISession", "LatestRemoteAISession", "CreateRemoteAISession", "RenameRemoteAISession", "CancelRemoteAISession", "DeleteRemoteAISession", "UpdateRemoteAIMessage", "DeleteRemoteAIMessage", "GetRemoteAITaskFile", "OpenRemoteAIChat", "ResumeRemoteAIChat",
		"RemoteActivityOverview", "GetRemoteActivity", "AvailableRemoteScripts", "ExecuteRemoteScript",
		"ListRemoteTasks", "ListRemoteTaskEvents", "GetRemoteTask", "RemoteTaskStatistics", "CancelRemoteTask",
		"StartRemoteRelay", "ListRemoteTransfers", "GetRemoteTransfer", "CancelRemoteTransfer",
		"ChooseUploadFile", "DiscardUploadFile", "StartFileUpload", "StartFileDownload", "ListFileTransfers", "CancelFileTransfer", "RefreshFileTransfer", "DismissFileTransfer",
		"ListRemoteDirectory", "StatRemoteFile", "ReadRemoteFile", "WriteRemoteFile", "CreateRemoteDirectory", "RenameRemoteFile", "DeleteRemoteFile", "ChmodRemoteFile", "RemoteDiskUsage", "BatchDeleteRemoteFiles",
		"DeleteRemotePaths", "GetRemoteContent", "ReadRemoteContent",
		"ListDockerContainers", "ListDockerImages", "DockerSystemInfo", "DockerStats", "DockerResources", "DockerContainerStats", "DockerContainerLogs", "CheckDockerImageUpdate", "ApplyDockerAction", "DockerActionResult", "OpenFileAuthentication", "AnswerFileChallenge", "OpenTerminal", "OpenMonitor", "ReadStream", "CloseStream", "WriteTerminal", "PingTerminal", "ResizeTerminal", "AnswerTerminalChallenge", "RequestTerminalCompletion"} {
		if name == prefix+method {
			return true
		}
	}
	return false
}

func (s *DesktopRemoteWorkspaceService) Forget(ctx context.Context, id string) error {
	if err := s.requireOwner(ctx); err != nil {
		return err
	}
	s.management.Lock()
	defer s.management.Unlock()
	value, err := s.metadata(ctx, id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	session := s.sessions[id]
	delete(s.sessions, id)
	s.mu.Unlock()
	if session != nil {
		session.cancel()
		session.window.Close()
		session.client.close()
	}
	client, loadErr := s.loadClient(value)
	if loadErr == nil {
		// A network failure must not prevent the user from deleting local
		// access. The remote session then expires at the source's deadline.
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = client.endSession(cleanup)
		cancel()
		client.close()
	}
	if err := keyring.Delete("EasySSH Desktop", desktopRemoteKeyAccount(id)); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return remoteError("credential_store_locked")
	}
	db, err := s.servers.database()
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `DELETE FROM desktop_remote_workspaces WHERE id=?`, id)
	return err
}

func (s *DesktopRemoteWorkspaceService) BeginHandoff(ctx context.Context, origin, id string) (DesktopHandoffPending, error) {
	if err := s.requireOwner(ctx); err != nil {
		return DesktopHandoffPending{}, err
	}
	if !validRemoteUUID(id) {
		return DesktopHandoffPending{}, remoteError("invalid_handoff")
	}
	client, err := newDesktopRemoteClient(origin)
	if err != nil {
		return DesktopHandoffPending{}, err
	}
	defer client.close()
	s.management.Lock()
	defer s.management.Unlock()
	if err := s.requireOwner(ctx); err != nil {
		return DesktopHandoffPending{}, err
	}
	s.mu.Lock()
	for key, pending := range s.handoffs {
		if !pending.expires.After(time.Now()) {
			delete(s.handoffs, key)
		} else if pending.origin == client.origin && pending.id == id {
			s.mu.Unlock()
			return DesktopHandoffPending{key, pending.origin, pending.confirmation, pending.expires}, nil
		}
	}
	full := len(s.handoffs) >= 8
	s.mu.Unlock()
	if full {
		return DesktopHandoffPending{}, remoteError("handoff_capacity_reached")
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return DesktopHandoffPending{}, err
	}
	verifier := base64.RawURLEncoding.EncodeToString(random)
	clear(random)
	challenge := sha256.Sum256([]byte(verifier))
	var result protocol.AccessHandoff
	err = client.request(ctx, http.MethodPost, "/api/v1/access/handoffs/"+id+"/bind",
		protocol.BindAccessHandoffInput{Challenge: hex.EncodeToString(challenge[:]), Name: "EasySSH Desktop"}, &result, false)
	if err != nil {
		return DesktopHandoffPending{}, err
	}
	if result.ID.String() != id || !result.ExpiresAt.After(time.Now()) || result.ExpiresAt.After(time.Now().Add(2*time.Minute+5*time.Second)) ||
		result.Confirmation != strings.ToUpper(hex.EncodeToString(challenge[:4])) || result.ApprovedAt != nil || result.ConsumedAt != nil {
		return DesktopHandoffPending{}, remoteError("invalid_remote_response")
	}
	localID := uuid.NewString()
	s.mu.Lock()
	s.handoffs[localID] = desktopPendingHandoff{client.origin, id, verifier, result.Confirmation, result.ExpiresAt}
	for key, value := range s.incoming {
		if value.Origin == client.origin && value.HandoffID == id {
			value.dismissed = true
			s.incoming[key] = value
		}
	}
	s.mu.Unlock()
	return DesktopHandoffPending{localID, client.origin, result.Confirmation, result.ExpiresAt}, nil
}

func (s *DesktopRemoteWorkspaceService) ClaimHandoff(ctx context.Context, localID string) (DesktopRemoteWorkspace, error) {
	if err := s.requireOwner(ctx); err != nil {
		return DesktopRemoteWorkspace{}, err
	}
	s.management.Lock()
	defer s.management.Unlock()
	s.mu.Lock()
	pending, ok := s.handoffs[localID]
	if ok && !pending.expires.After(time.Now()) {
		delete(s.handoffs, localID)
		ok = false
	}
	s.mu.Unlock()
	if !ok {
		return DesktopRemoteWorkspace{}, remoteError("handoff_expired")
	}
	client, err := newDesktopRemoteClient(pending.origin)
	if err != nil {
		return DesktopRemoteWorkspace{}, err
	}
	var result protocol.DesktopAccessExchange
	err = client.request(ctx, http.MethodPost, "/api/v1/access/handoffs/"+pending.id+"/claim",
		protocol.ClaimAccessHandoffInput{Verifier: pending.verifier, ProtocolMin: int(protocol.AccessVersion), ProtocolMax: int(protocol.AccessVersion)}, &result, false)
	if err != nil {
		client.close()
		return DesktopRemoteWorkspace{}, err
	}
	s.mu.Lock()
	delete(s.handoffs, localID)
	s.mu.Unlock()
	if err := client.acceptExchange(result); err != nil {
		client.close()
		return DesktopRemoteWorkspace{}, err
	}
	return s.finishExchange(ctx, client, "", result.Context, true)
}

func (s *DesktopRemoteWorkspaceService) CancelHandoff(ctx context.Context, localID string) error {
	if err := s.requireOwner(ctx); err != nil {
		return err
	}
	s.management.Lock()
	defer s.management.Unlock()
	s.mu.Lock()
	delete(s.handoffs, localID)
	s.mu.Unlock()
	return nil
}
