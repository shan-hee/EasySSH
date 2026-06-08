package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

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

type DesktopTerminalOutputEvent struct {
	ClientID string `json:"clientId"`
	Data     string `json:"data"`
}

type DesktopTerminalClosedEvent struct {
	ClientID string `json:"clientId"`
	Reason   string `json:"reason,omitempty"`
}

type DesktopTerminalService struct {
	mu            sync.Mutex
	serverService *DesktopServerService
	sessions      map[string]*desktopTerminalSession
}

type desktopTerminalSession struct {
	client     *ssh.Client
	session    *ssh.Session
	stdin      io.WriteCloser
	writeMutex sync.Mutex
}

func NewDesktopTerminalService(serverService *DesktopServerService) *DesktopTerminalService {
	return &DesktopTerminalService{
		serverService: serverService,
		sessions:      map[string]*desktopTerminalSession{},
	}
}

func (s *DesktopTerminalService) ServiceShutdown() error {
	s.mu.Lock()
	clientIDs := make([]string, 0, len(s.sessions))
	for clientID := range s.sessions {
		clientIDs = append(clientIDs, clientID)
	}
	s.mu.Unlock()

	for _, clientID := range clientIDs {
		s.closeByID(clientID, "application shutdown")
	}

	return nil
}

func (s *DesktopTerminalService) Start(input DesktopTerminalStartInput) error {
	clientID := strings.TrimSpace(input.ClientID)
	serverID := strings.TrimSpace(input.ServerID)
	if clientID == "" {
		return errors.New("terminal client id is required")
	}
	if serverID == "" {
		return errors.New("server id is required")
	}

	cols := input.Cols
	if cols <= 0 {
		cols = 80
	}
	rows := input.Rows
	if rows <= 0 {
		rows = 24
	}

	s.closeByID(clientID, "session replaced")

	server, err := s.serverService.GetById(serverID)
	if err != nil {
		return err
	}

	var credential *DesktopSSHCredential
	if input.AuthMethod == DesktopServerAuthPassword || input.AuthMethod == DesktopServerAuthKey {
		credential = &DesktopSSHCredential{
			AuthMethod:           input.AuthMethod,
			Secret:               input.Secret,
			PrivateKeyPassphrase: input.PrivateKeyPassphrase,
		}
	} else if cachedCredential, ok := s.serverService.getTemporaryCredential(serverID); ok {
		credential = cachedCredential
	}

	authMethods, err := buildDesktopServerSSHAuthMethodsWithCredential(server, credential)
	if err != nil {
		return err
	}
	if len(authMethods) == 0 {
		return errors.New("server credential is required")
	}

	config := &ssh.ClientConfig{
		User:            server.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         12 * time.Second,
	}

	address := net.JoinHostPort(server.Host, strconv.Itoa(server.Port))
	client, err := ssh.Dial("tcp", address, config)
	if err != nil {
		return err
	}

	sshSession, err := client.NewSession()
	if err != nil {
		client.Close()
		return err
	}

	stdin, err := sshSession.StdinPipe()
	if err != nil {
		sshSession.Close()
		client.Close()
		return err
	}

	stdout, err := sshSession.StdoutPipe()
	if err != nil {
		sshSession.Close()
		client.Close()
		return err
	}

	stderr, err := sshSession.StderrPipe()
	if err != nil {
		sshSession.Close()
		client.Close()
		return err
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sshSession.RequestPty(desktopTerminalTerm, rows, cols, modes); err != nil {
		sshSession.Close()
		client.Close()
		return err
	}

	terminalSession := &desktopTerminalSession{
		client:  client,
		session: sshSession,
		stdin:   stdin,
	}

	s.mu.Lock()
	s.sessions[clientID] = terminalSession
	s.mu.Unlock()

	go s.copyOutput(clientID, stdout)
	go s.copyOutput(clientID, stderr)

	if err := sshSession.Shell(); err != nil {
		s.closeByID(clientID, err.Error())
		return err
	}

	if credential != nil {
		s.serverService.setTemporaryCredential(serverID, *credential)
	}

	go s.waitForSession(clientID, sshSession)

	if _, err := s.serverService.MarkConnected(serverID); err != nil {
		fmt.Printf("failed to mark desktop server connected: %v\n", err)
	}

	return nil
}

func (s *DesktopTerminalService) Write(input DesktopTerminalWriteInput) error {
	clientID := strings.TrimSpace(input.ClientID)
	if clientID == "" {
		return errors.New("terminal client id is required")
	}

	data, err := base64.StdEncoding.DecodeString(input.Data)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return nil
	}

	terminalSession := s.getSession(clientID)
	if terminalSession == nil {
		return errors.New("terminal session is not active")
	}

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

	terminalSession := s.getSession(clientID)
	if terminalSession == nil {
		return errors.New("terminal session is not active")
	}

	return terminalSession.session.WindowChange(rows, cols)
}

func (s *DesktopTerminalService) Close(input DesktopTerminalCloseInput) error {
	clientID := strings.TrimSpace(input.ClientID)
	if clientID == "" {
		return nil
	}

	s.closeByID(clientID, "client closed")
	return nil
}

func (s *DesktopTerminalService) Ping(input DesktopTerminalPingInput) (DesktopTerminalPingResult, error) {
	clientID := strings.TrimSpace(input.ClientID)
	if clientID == "" {
		return DesktopTerminalPingResult{}, errors.New("terminal client id is required")
	}

	terminalSession := s.getSession(clientID)
	if terminalSession == nil || terminalSession.client == nil {
		return DesktopTerminalPingResult{}, errors.New("terminal session is not active")
	}

	started := time.Now()
	sshSession, err := terminalSession.client.NewSession()
	if err != nil {
		return DesktopTerminalPingResult{}, err
	}
	defer sshSession.Close()

	done := make(chan error, 1)
	go func() {
		done <- sshSession.Run("true")
	}()

	select {
	case err := <-done:
		if err != nil {
			return DesktopTerminalPingResult{}, err
		}
	case <-time.After(5 * time.Second):
		_ = sshSession.Close()
		return DesktopTerminalPingResult{}, errors.New("terminal ping timed out")
	}

	return DesktopTerminalPingResult{
		LatencyMs:  time.Since(started).Milliseconds(),
		MeasuredAt: time.Now().UnixMilli(),
	}, nil
}

func (s *DesktopTerminalService) getSession(clientID string) *desktopTerminalSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessions[clientID]
}

func (s *DesktopTerminalService) closeByID(clientID string, reason string) {
	s.mu.Lock()
	terminalSession := s.sessions[clientID]
	delete(s.sessions, clientID)
	s.mu.Unlock()

	if terminalSession == nil {
		return
	}

	if terminalSession.stdin != nil {
		_ = terminalSession.stdin.Close()
	}
	if terminalSession.session != nil {
		_ = terminalSession.session.Close()
	}
	if terminalSession.client != nil {
		_ = terminalSession.client.Close()
	}

	s.emitClosed(clientID, reason)
}

func (s *DesktopTerminalService) copyOutput(clientID string, reader io.Reader) {
	buffer := make([]byte, 4096)
	for {
		read, err := reader.Read(buffer)
		if read > 0 {
			s.emitOutput(clientID, buffer[:read])
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				s.closeByID(clientID, err.Error())
			}
			return
		}
	}
}

func (s *DesktopTerminalService) waitForSession(clientID string, sshSession *ssh.Session) {
	err := sshSession.Wait()
	reason := "remote closed"
	if err != nil {
		reason = err.Error()
	}
	s.closeByID(clientID, reason)
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

func (s *DesktopTerminalService) emitClosed(clientID string, reason string) {
	app := application.Get()
	if app == nil || app.Event == nil {
		return
	}

	app.Event.Emit(desktopTerminalClosedEvent, DesktopTerminalClosedEvent{
		ClientID: clientID,
		Reason:   reason,
	})
}
