package app

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/sftputil"
	"github.com/easyssh/shared/sshutil"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/crypto/ssh"
)

const (
	desktopTerminalOutputEvent = "easyssh:desktop-terminal:output"
	desktopTerminalClosedEvent = "easyssh:desktop-terminal:closed"
	desktopTerminalTerm        = "xterm-256color"
)

type DesktopTerminalStartInput struct {
	ClientID             string                  `json:"clientId"`
	ServerID             string                  `json:"serverId"`
	Cols                 int                     `json:"cols"`
	Rows                 int                     `json:"rows"`
	AuthMethod           DesktopServerAuthMethod `json:"authMethod,omitempty"`
	Secret               string                  `json:"secret,omitempty"`
	Password             string                  `json:"password,omitempty"`
	PrivateKey           string                  `json:"privateKey,omitempty"`
	PrivateKeyPassphrase string                  `json:"privateKeyPassphrase,omitempty"`
}

type DesktopTerminalWriteInput struct {
	ClientID string `json:"clientId"`
	Data     string `json:"data"`
}

type DesktopTerminalResizeInput struct {
	ClientID string `json:"clientId"`
	Cols     int    `json:"cols"`
	Rows     int    `json:"rows"`
}

type DesktopTerminalCloseInput struct {
	ClientID string `json:"clientId"`
}

type DesktopTerminalPingInput struct {
	ClientID string `json:"clientId"`
}

type DesktopTerminalPingResult struct {
	LatencyMs  int64 `json:"latencyMs"`
	MeasuredAt int64 `json:"measuredAt"`
}

type DesktopTerminalCompletionHistoryInput struct {
	ClientID string `json:"clientId"`
}

type DesktopTerminalCompletionHistoryResult struct {
	History []string `json:"history"`
}

type DesktopTerminalOutputEvent struct {
	ClientID string `json:"clientId"`
	Data     string `json:"data"`
}

type DesktopTerminalClosedEvent struct {
	Code     int    `json:"code"`
	ClientID string `json:"clientId"`
	Reason   string `json:"reason,omitempty"`
}

type DesktopTerminalService struct {
	mu            sync.Mutex
	serverService *DesktopServerService
	activity      *ActivityLogService
	stopping      bool
	workers       sync.WaitGroup
	sessions      map[string]*desktopTerminalSession
}

type desktopTerminalSession struct {
	ctx        context.Context
	cancel     context.CancelFunc
	done       chan struct{}
	ready      chan error
	client     *ssh.Client
	session    *ssh.Session
	stdin      io.WriteCloser
	writeMutex sync.Mutex
}

func NewDesktopTerminalService(serverService *DesktopServerService, activity *ActivityLogService) *DesktopTerminalService {
	return &DesktopTerminalService{
		serverService: serverService,
		activity:      activity,
		sessions:      map[string]*desktopTerminalSession{},
	}
}

func (s *DesktopTerminalService) ServiceShutdown() error {
	s.mu.Lock()
	s.stopping = true
	for _, entry := range s.sessions {
		entry.cancel()
	}
	s.mu.Unlock()
	s.workers.Wait()
	return nil
}

func (s *DesktopTerminalService) Start(input DesktopTerminalStartInput) error {
	input.ClientID, input.ServerID = strings.TrimSpace(input.ClientID), strings.TrimSpace(input.ServerID)
	if input.ClientID == "" || input.ServerID == "" {
		return errors.New("terminal client and server ids are required")
	}
	s.mu.Lock()
	if s.stopping || len(s.sessions) >= 128 {
		s.mu.Unlock()
		return errors.New("terminal service is unavailable")
	}
	if s.sessions[input.ClientID] != nil {
		s.mu.Unlock()
		return errors.New("terminal client id is already in use")
	}
	ctx, cancel := context.WithCancel(context.Background())
	entry := &desktopTerminalSession{ctx: ctx, cancel: cancel, done: make(chan struct{}), ready: make(chan error, 1)}
	s.sessions[input.ClientID] = entry
	s.workers.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.workers.Done()
		defer close(entry.done)
		defer func() { s.mu.Lock(); delete(s.sessions, input.ClientID); s.mu.Unlock() }()
		s.runSession(input, entry)
	}()
	return <-entry.ready
}

func (s *DesktopTerminalService) runSession(input DesktopTerminalStartInput, entry *desktopTerminalSession) {
	var result error
	var readyOnce sync.Once
	ready := func(err error) { readyOnce.Do(func() { entry.ready <- err }) }
	defer func() { ready(result) }()
	defer entry.cancel()
	server, err := s.serverService.getByIDRaw(input.ServerID)
	if err != nil {
		result = err
		return
	}
	observation, err := s.activity.beginConnection(entry.ctx, server)
	if err != nil {
		result = err
		return
	}
	outcome, code := DesktopActivityLogStatus("failure"), "initialization_failed"
	var disconnectedAt time.Time
	defer func() {
		if result != nil && outcome != "success" {
			if errors.Is(result, context.Canceled) {
				outcome = "canceled"
				code = "connection_canceled"
			}
			if errors.Is(result, context.DeadlineExceeded) {
				outcome = "timeout"
				code = "initialization_timeout"
			}
		}
		observation.finish(outcome, code, disconnectedAt)
		s.emitClosed(input.ClientID, code, 1000)
	}()
	initCtx, cancelInit := context.WithTimeout(entry.ctx, 12*time.Second)
	defer cancelInit()
	defer func() {
		if result != nil && initCtx.Err() != nil && outcome != "unknown" {
			result = initCtx.Err()
		}
	}()
	var credential *DesktopSSHCredential
	input.AuthMethod = normalizeDesktopServerAuthMethod(input.AuthMethod)
	if input.AuthMethod.IsValid() {
		credential = &DesktopSSHCredential{AuthMethod: input.AuthMethod, Secret: input.Secret, Password: input.Password, PrivateKey: input.PrivateKey, PrivateKeyPassphrase: input.PrivateKeyPassphrase}
	} else if cached, ok := s.serverService.getTemporaryCredential(server.ID, server.connectionRevision, server.credentialDigest()); ok {
		credential = cached
	}
	authMethods, err := buildDesktopServerSSHAuthMethodsWithCredential(server, credential)
	if err != nil {
		result = err
		return
	}
	if len(authMethods) == 0 {
		result = errors.New("server credential is required")
		return
	}
	config := &ssh.ClientConfig{User: server.Username, Auth: authMethods, HostKeyCallback: desktopHostKeyCallback(), Timeout: 12 * time.Second}
	if err = configureDesktopHostKeyAlgorithms(config, server.Host, server.Port); err != nil {
		result = err
		return
	}
	client, err := dialDesktopSSH(initCtx, server, config)
	if err != nil {
		result = err
		return
	}
	var workers sync.WaitGroup
	spawn := func(work func()) { workers.Add(1); go func() { defer workers.Done(); work() }() }
	defer func() { entry.cancel(); _ = client.Close(); disconnectedAt = time.Now().UTC(); workers.Wait() }()
	stopTransport := sftputil.CloseOnCancel(entry.ctx, client.Close)
	defer stopTransport()
	stopInit := sftputil.CloseOnCancel(initCtx, client.Close)
	defer stopInit()
	session, err := client.NewSession()
	if err != nil {
		result = err
		return
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		result = err
		return
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		result = err
		return
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		result = err
		return
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}
	if err = session.RequestPty(desktopTerminalTerm, normalizeTerminalRows(input.Rows), normalizeTerminalCols(input.Cols), modes); err != nil {
		result = err
		return
	}
	if err = session.Shell(); err != nil {
		result = err
		return
	}
	stopInit()
	if err = initCtx.Err(); err != nil {
		result = err
		return
	}
	cancelInit()
	if err = observation.established(); err != nil {
		result = err
		outcome, code = "unknown", "connection_persistence_failed"
		return
	}
	outcome, code = "success", "connection_closed"
	s.mu.Lock()
	if entry.ctx.Err() != nil {
		s.mu.Unlock()
		result = entry.ctx.Err()
		return
	}
	entry.client, entry.session, entry.stdin = client, session, stdin
	s.mu.Unlock()
	if credential != nil {
		s.serverService.setTemporaryCredential(server.ID, server.connectionRevision, server.credentialDigest(), *credential)
	}
	spawn(func() { observation.heartbeat(entry.ctx) })
	spawn(func() { s.serverService.detectAndPersistOSIfEmpty(entry.ctx, server, client) })
	var outputWG sync.WaitGroup
	outputWG.Add(2)
	spawn(func() { defer outputWG.Done(); s.copyOutput(input.ClientID, stdout) })
	spawn(func() { defer outputWG.Done(); s.copyOutput(input.ClientID, stderr) })
	ended := make(chan error, 1)
	spawn(func() { err := session.Wait(); outputWG.Wait(); ended <- err })
	ready(nil)
	select {
	case err = <-ended:
		var exitErr *ssh.ExitError
		if err != nil && !errors.As(err, &exitErr) {
			outcome, code = "unknown", "remote_transport_lost"
		}
	case <-entry.ctx.Done():
	}
}

func (s *DesktopTerminalService) Write(input DesktopTerminalWriteInput) error {
	clientID := strings.TrimSpace(input.ClientID)
	if clientID == "" {
		return errors.New("terminal client id is required")
	}

	if len(input.Data) > base64.StdEncoding.EncodedLen(1<<20) {
		return errors.New("terminal input exceeds size limit")
	}
	data, err := base64.StdEncoding.DecodeString(input.Data)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}

	terminalSession, done, err := s.borrowSession(clientID)
	if err != nil {
		return err
	}
	defer done()

	terminalSession.writeMutex.Lock()
	defer terminalSession.writeMutex.Unlock()

	_, err = terminalSession.stdin.Write(data)
	return err
}

func (s *DesktopTerminalService) Resize(input DesktopTerminalResizeInput) error {
	clientID := strings.TrimSpace(input.ClientID)
	if clientID == "" {
		return errors.New("terminal client id is required")
	}

	cols := input.Cols
	if cols <= 0 {
		cols = 80
	}
	rows := input.Rows
	if rows <= 0 {
		rows = 24
	}

	terminalSession, done, err := s.borrowSession(clientID)
	if err != nil {
		return err
	}
	defer done()

	return terminalSession.session.WindowChange(rows, cols)
}

func (s *DesktopTerminalService) Close(input DesktopTerminalCloseInput) error {
	clientID := strings.TrimSpace(input.ClientID)
	if clientID == "" {
		return nil
	}

	s.closeByID(clientID, "client closed", 1000)
	return nil
}

func (s *DesktopTerminalService) Ping(input DesktopTerminalPingInput) (DesktopTerminalPingResult, error) {
	entry, done, err := s.borrowSession(input.ClientID)
	if err != nil {
		return DesktopTerminalPingResult{}, err
	}
	defer done()
	latency, err := measureDesktopSSHLatency(entry.ctx, entry.client)
	if err != nil {
		return DesktopTerminalPingResult{}, err
	}
	return DesktopTerminalPingResult{LatencyMs: latency.Milliseconds(), MeasuredAt: time.Now().UnixMilli()}, nil
}

func (s *DesktopTerminalService) FetchCompletionHistory(ctx context.Context, input DesktopTerminalCompletionHistoryInput) (DesktopTerminalCompletionHistoryResult, error) {
	entry, done, err := s.borrowSession(input.ClientID)
	if err != nil {
		return DesktopTerminalCompletionHistoryResult{}, err
	}
	defer done()
	bounded, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(entry.ctx, cancel)
	defer stop()
	defer cancel()
	history, err := sshutil.FetchCompletionHistory(bounded, entry.client)
	return DesktopTerminalCompletionHistoryResult{History: history}, err
}

func (s *DesktopTerminalService) borrowSession(clientID string) (*desktopTerminalSession, func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.sessions[strings.TrimSpace(clientID)]
	if s.stopping || entry == nil || entry.session == nil || entry.ctx.Err() != nil {
		return nil, nil, errors.New("terminal session is not active")
	}
	s.workers.Add(1)
	return entry, s.workers.Done, nil
}

func (s *DesktopTerminalService) closeByID(clientID string, reason string, code int) {
	s.mu.Lock()
	entry := s.sessions[clientID]
	if entry != nil {
		entry.cancel()
	}
	s.mu.Unlock()
	if entry != nil {
		<-entry.done
	}
}

func (s *DesktopTerminalService) copyOutput(clientID string, reader io.Reader) {
	buffer := make([]byte, 4096)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			s.emitOutput(clientID, buffer[:n])
		}
		if err != nil {
			return
		}
	}
}

func (s *DesktopTerminalService) emitOutput(clientID string, data []byte) {
	app := application.Get()
	if app == nil || app.Event == nil {
		return
	}

	app.Event.Emit(desktopTerminalOutputEvent, DesktopTerminalOutputEvent{
		ClientID: clientID,
		Data:     base64.StdEncoding.EncodeToString(data),
	})
}

func (s *DesktopTerminalService) emitClosed(clientID string, reason string, code int) {
	app := application.Get()
	if app == nil || app.Event == nil {
		return
	}

	app.Event.Emit(desktopTerminalClosedEvent, DesktopTerminalClosedEvent{
		Code:     code,
		ClientID: clientID,
		Reason:   reason,
	})
}
