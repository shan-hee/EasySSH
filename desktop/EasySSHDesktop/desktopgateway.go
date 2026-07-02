package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/crypto/ssh"
)

const (
	desktopGatewayTerminalInitTimeout = 5 * time.Minute
	desktopGatewayAuthMaxAttempts     = 3
	desktopGatewaySSHLatencyInterval  = 15 * time.Second
	desktopGatewayWriteTimeout        = 10 * time.Second
)

type DesktopGatewayInfo struct {
	HTTPBaseURL string `json:"httpBaseUrl"`
	WSBaseURL   string `json:"wsBaseUrl"`
	Token       string `json:"token"`
}

type DesktopGateway struct {
	serverService *DesktopServerService
	scriptService *DesktopScriptService
	monitor       *DesktopMonitorService

	mu          sync.RWMutex
	server      *http.Server
	httpBaseURL string
	wsBaseURL   string
	token       string
}

type desktopGatewayMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

type desktopGatewayResizeMessage struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

type desktopGatewayPingMessage struct {
	ID string `json:"id,omitempty"`
	Ts int64  `json:"ts,omitempty"`
}

type desktopGatewayFetchCompletionDataMessage struct {
	HistoryLimit    int   `json:"historyLimit,omitempty"`
	IncludeHistory  *bool `json:"includeHistory,omitempty"`
	IncludeScripts  *bool `json:"includeScripts,omitempty"`
	CacheTTLMinutes int   `json:"cacheTtlMinutes,omitempty"`
	CacheMaxEntries int   `json:"cacheMaxEntries,omitempty"`
}

type desktopGatewayAuthResponseMessage struct {
	RequestID             string                  `json:"request_id"`
	Answers               []string                `json:"answers"`
	Cancelled             bool                    `json:"cancelled,omitempty"`
	AuthMethod            DesktopServerAuthMethod `json:"auth_method,omitempty"`
	Password              string                  `json:"password,omitempty"`
	PrivateKey            string                  `json:"private_key,omitempty"`
	PrivateKeyPassphrase  string                  `json:"privateKeyPassphrase,omitempty"`
	PrivateKeyPassphrase2 string                  `json:"private_key_passphrase,omitempty"`
}

type desktopGatewayErrorMessage struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

type desktopGatewayAuthPromptItem struct {
	Text string `json:"text"`
	Echo bool   `json:"echo"`
}

type desktopGatewayAuthPromptMessage struct {
	RequestID         string                         `json:"request_id"`
	Kind              string                         `json:"kind,omitempty"`
	Name              string                         `json:"name,omitempty"`
	Prompts           []desktopGatewayAuthPromptItem `json:"prompts"`
	AuthMethod        DesktopServerAuthMethod        `json:"auth_method,omitempty"`
	Attempt           int                            `json:"attempt,omitempty"`
	MaxAttempts       int                            `json:"max_attempts,omitempty"`
	AttemptsRemaining int                            `json:"attempts_remaining,omitempty"`
}

type desktopGatewayTerminalInitResult struct {
	server     DesktopServer
	client     *ssh.Client
	session    *ssh.Session
	stdin      io.WriteCloser
	stdout     io.Reader
	stderr     io.Reader
	credential *DesktopSSHCredential
	err        error
}

type desktopGatewayTerminalRuntime struct {
	conn       *websocket.Conn
	writeMu    sync.Mutex
	promptMu   sync.Mutex
	prompts    map[string]chan desktopGatewayAuthResponseMessage
	serverName string

	terminalMu    sync.Mutex
	stdin         io.Writer
	stdinMu       sync.Mutex
	session       *ssh.Session
	pendingResize *desktopGatewayResizeMessage
}

func NewDesktopGateway(serverService *DesktopServerService, scriptService *DesktopScriptService, monitor *DesktopMonitorService) *DesktopGateway {
	return &DesktopGateway{
		serverService: serverService,
		scriptService: scriptService,
		monitor:       monitor,
		token:         newDesktopGatewayToken(),
	}
}

func (g *DesktopGateway) ServiceName() string {
	return "DesktopGateway"
}

func (g *DesktopGateway) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/terminal", g.handleTerminal)
	mux.HandleFunc("/monitor", g.handleMonitor)

	server := &http.Server{
		Handler: mux,
	}

	address := listener.Addr().String()
	g.mu.Lock()
	g.server = server
	g.httpBaseURL = "http://" + address
	g.wsBaseURL = "ws://" + address
	g.mu.Unlock()

	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("desktop gateway failed: %v", err)
		}
	}()

	return nil
}

func (g *DesktopGateway) ServiceShutdown() error {
	g.mu.Lock()
	server := g.server
	g.server = nil
	g.httpBaseURL = ""
	g.wsBaseURL = ""
	g.mu.Unlock()

	if server == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return server.Shutdown(ctx)
}

func (g *DesktopGateway) Info() DesktopGatewayInfo {
	g.mu.RLock()
	defer g.mu.RUnlock()

	return DesktopGatewayInfo{
		HTTPBaseURL: g.httpBaseURL,
		WSBaseURL:   g.wsBaseURL,
		Token:       g.token,
	}
}

func (g *DesktopGateway) validateRequest(r *http.Request) bool {
	if r.URL.Query().Get("ticket") == g.token {
		return true
	}
	if r.URL.Query().Get("token") == g.token {
		return true
	}
	if r.Header.Get("X-EasySSH-Desktop-Gateway-Token") == g.token {
		return true
	}
	return false
}

func (g *DesktopGateway) handleTerminal(w http.ResponseWriter, r *http.Request) {
	if !g.validateRequest(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	serverID := strings.TrimSpace(r.URL.Query().Get("serverId"))
	if serverID == "" {
		serverID = strings.TrimSpace(r.URL.Query().Get("server_id"))
	}
	if serverID == "" {
		http.Error(w, "server id is required", http.StatusBadRequest)
		return
	}

	cols := parsePositiveInt(r.URL.Query().Get("cols"), 80)
	rows := parsePositiveInt(r.URL.Query().Get("rows"), 24)

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("desktop terminal websocket accept failed: %v", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "closed")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runtime := &desktopGatewayTerminalRuntime{
		conn:    conn,
		prompts: map[string]chan desktopGatewayAuthResponseMessage{},
	}

	done := make(chan struct{})
	var closeOnce sync.Once
	closeDone := func() {
		closeOnce.Do(func() {
			close(done)
		})
	}

	var terminalClientMu sync.RWMutex
	var terminalClient *ssh.Client
	var sshLatencyMs atomic.Int64
	var sshLatencyMeasuredAt atomic.Int64
	var sshLatencyProbeInFlight atomic.Bool
	sshLatencyMs.Store(-1)

	refreshSSHLatency := func() {
		if measuredAt := sshLatencyMeasuredAt.Load(); measuredAt > 0 {
			if time.Since(time.UnixMilli(measuredAt)) < desktopGatewaySSHLatencyInterval {
				return
			}
		}
		if !sshLatencyProbeInFlight.CompareAndSwap(false, true) {
			return
		}

		terminalClientMu.RLock()
		client := terminalClient
		terminalClientMu.RUnlock()
		if client == nil {
			sshLatencyProbeInFlight.Store(false)
			return
		}

		go func() {
			defer sshLatencyProbeInFlight.Store(false)
			latency, err := measureDesktopSSHLatency(client)
			if err != nil {
				return
			}
			sshLatencyMs.Store(latency.Milliseconds())
			sshLatencyMeasuredAt.Store(time.Now().UnixMilli())
		}()
	}

	onPing := func(ping desktopGatewayPingMessage) {
		now := time.Now().UnixMilli()
		response := map[string]any{
			"id":           ping.ID,
			"ts":           ping.Ts,
			"serverRecvTs": now,
		}
		if latency := sshLatencyMs.Load(); latency >= 0 {
			response["sshLatencyMs"] = latency
			response["sshLatencyMeasuredAt"] = sshLatencyMeasuredAt.Load()
		}
		response["serverSendTs"] = time.Now().UnixMilli()
		data, _ := json.Marshal(response)
		_ = runtime.writeJSON(ctx, desktopGatewayMessage{
			Type: "pong",
			Data: data,
		})
		refreshSSHLatency()
	}

	onFetchCompletionData := func(options desktopGatewayFetchCompletionDataMessage) {
		g.sendTerminalCompletionData(ctx, runtime, options)
	}

	readerCtx, cancelReader := context.WithCancel(ctx)
	defer cancelReader()
	go runtime.readTerminalMessages(readerCtx, closeDone, onPing, onFetchCompletionData)

	if err := runtime.writeJSON(ctx, desktopGatewayMessage{
		Type: "handshake_complete",
		Data: json.RawMessage(`{"status":"connecting"}`),
	}); err != nil {
		return
	}

	initCtx, cancelInit := context.WithTimeout(ctx, desktopGatewayTerminalInitTimeout)
	defer cancelInit()

	resultCh := make(chan desktopGatewayTerminalInitResult, 1)
	go func() {
		resultCh <- g.initializeTerminalSession(initCtx, runtime, serverID, cols, rows)
	}()

	var init desktopGatewayTerminalInitResult
	select {
	case init = <-resultCh:
	case <-done:
		return
	case <-initCtx.Done():
		runtime.sendError(ctx, "initialization_timeout", "SSH connection timeout")
		return
	}

	if init.err != nil {
		code, message := classifyDesktopGatewayTerminalError(init.err)
		runtime.sendError(ctx, code, message)
		return
	}
	defer init.client.Close()
	defer init.session.Close()
	defer init.stdin.Close()

	terminalClientMu.Lock()
	terminalClient = init.client
	terminalClientMu.Unlock()
	defer func() {
		terminalClientMu.Lock()
		terminalClient = nil
		terminalClientMu.Unlock()
	}()

	if init.credential != nil {
		g.serverService.setTemporaryCredential(serverID, *init.credential)
	}
	if _, err := g.serverService.MarkConnected(serverID); err != nil {
		log.Printf("failed to mark desktop server connected: %v", err)
	}

	runtime.setTerminalIO(init.stdin, init.session)
	defer runtime.clearTerminalIO()

	if err := runtime.writeJSON(ctx, desktopGatewayMessage{
		Type: "connected",
		Data: json.RawMessage(`{"session_id":"desktop"}`),
	}); err != nil {
		return
	}
	refreshSSHLatency()

	go runtime.copyTerminalOutput(ctx, init.stdout, closeDone)
	go runtime.copyTerminalOutput(ctx, init.stderr, closeDone)
	go func() {
		if err := init.session.Wait(); err != nil && !errors.Is(err, io.EOF) {
			message := strings.ToLower(err.Error())
			if !strings.Contains(message, "closed") {
				log.Printf("desktop terminal session ended: %v", err)
			}
		}
		closeDone()
	}()

	select {
	case <-done:
	case <-ctx.Done():
	}

	_ = runtime.writeJSON(context.Background(), desktopGatewayMessage{Type: "closed"})
}

func (g *DesktopGateway) initializeTerminalSession(
	ctx context.Context,
	runtime *desktopGatewayTerminalRuntime,
	serverID string,
	cols int,
	rows int,
) desktopGatewayTerminalInitResult {
	server, err := g.serverService.getByIDRaw(serverID)
	if err != nil {
		return desktopGatewayTerminalInitResult{err: err}
	}
	runtime.serverName = serverDisplayName(server)

	var credential *DesktopSSHCredential
	client, err := g.connectDesktopSSH(ctx, server, nil)
	if err != nil && isDesktopTerminalPassphraseError(err) && server.AuthMethod == DesktopServerAuthKey {
		var lastErr error = err
		for attempt := 1; attempt <= desktopGatewayAuthMaxAttempts; attempt++ {
			passphrase, promptErr := runtime.requestPrivateKeyPassphrase(ctx, attempt, desktopGatewayAuthMaxAttempts)
			if promptErr != nil {
				return desktopGatewayTerminalInitResult{server: server, err: promptErr}
			}
			credential = &DesktopSSHCredential{
				AuthMethod:           DesktopServerAuthKey,
				Secret:               "",
				PrivateKeyPassphrase: passphrase,
			}
			client, err = g.connectDesktopSSH(ctx, server, credential)
			if err == nil {
				break
			}
			lastErr = err
			if !isDesktopTerminalPassphraseError(err) {
				break
			}
		}
		if err != nil {
			err = lastErr
		}
	}

	if err != nil && isDesktopTerminalAuthRetryable(err) {
		nextAuthMethod := server.AuthMethod
		var lastErr error = err
		for attempt := 1; attempt <= desktopGatewayAuthMaxAttempts; attempt++ {
			nextCredential, promptErr := runtime.requestCredential(ctx, nextAuthMethod, attempt, desktopGatewayAuthMaxAttempts)
			if promptErr != nil {
				return desktopGatewayTerminalInitResult{server: server, err: promptErr}
			}
			nextAuthMethod = nextCredential.AuthMethod
			credential = nextCredential
			client, err = g.connectDesktopSSH(ctx, server, credential)
			if err != nil && credential.AuthMethod == DesktopServerAuthKey && isDesktopTerminalPassphraseError(err) {
				var passphraseErr error = err
				for passphraseAttempt := 1; passphraseAttempt <= desktopGatewayAuthMaxAttempts; passphraseAttempt++ {
					passphrase, promptErr := runtime.requestPrivateKeyPassphrase(ctx, passphraseAttempt, desktopGatewayAuthMaxAttempts)
					if promptErr != nil {
						return desktopGatewayTerminalInitResult{server: server, err: promptErr}
					}
					credential.PrivateKeyPassphrase = passphrase
					client, err = g.connectDesktopSSH(ctx, server, credential)
					if err == nil {
						break
					}
					passphraseErr = err
					if !isDesktopTerminalPassphraseError(err) {
						break
					}
				}
				if err != nil {
					err = passphraseErr
				}
			}
			if err == nil {
				break
			}
			lastErr = err
			if !isDesktopTerminalAuthRetryable(err) {
				break
			}
		}
		if err != nil {
			err = lastErr
		}
	}

	if err != nil {
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}

	sshSession, err := client.NewSession()
	if err != nil {
		client.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}

	cols, rows = runtime.terminalSize(cols, rows)
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sshSession.RequestPty(desktopTerminalTerm, rows, cols, modes); err != nil {
		sshSession.Close()
		client.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}

	stdin, err := sshSession.StdinPipe()
	if err != nil {
		sshSession.Close()
		client.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}
	stdout, err := sshSession.StdoutPipe()
	if err != nil {
		sshSession.Close()
		client.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}
	stderr, err := sshSession.StderrPipe()
	if err != nil {
		sshSession.Close()
		client.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}
	if err := sshSession.Shell(); err != nil {
		sshSession.Close()
		client.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}
	go g.serverService.detectAndPersistOSIfEmpty(server, client)

	return desktopGatewayTerminalInitResult{
		server:     server,
		client:     client,
		session:    sshSession,
		stdin:      stdin,
		stdout:     stdout,
		stderr:     stderr,
		credential: credential,
	}
}

func (g *DesktopGateway) connectDesktopSSH(ctx context.Context, server DesktopServer, credential *DesktopSSHCredential) (*ssh.Client, error) {
	if credential == nil {
		if cachedCredential, ok := g.serverService.getTemporaryCredential(server.ID); ok {
			credential = cachedCredential
		}
	}
	authMethods, err := buildDesktopServerSSHAuthMethodsWithCredential(server, credential)
	if err != nil {
		return nil, err
	}
	if len(authMethods) == 0 {
		return nil, errors.New("server credential is required")
	}

	config := &ssh.ClientConfig{
		User:            server.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         12 * time.Second,
	}
	address := net.JoinHostPort(server.Host, strconv.Itoa(server.Port))

	type dialResult struct {
		client *ssh.Client
		err    error
	}
	done := make(chan dialResult, 1)
	go func() {
		client, err := ssh.Dial("tcp", address, config)
		done <- dialResult{client: client, err: err}
	}()

	select {
	case result := <-done:
		return result.client, result.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (g *DesktopGateway) handleMonitor(w http.ResponseWriter, r *http.Request) {
	if !g.validateRequest(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if g.monitor == nil {
		http.Error(w, "monitor service is unavailable", http.StatusServiceUnavailable)
		return
	}

	serverID := strings.TrimSpace(r.URL.Query().Get("serverId"))
	if serverID == "" {
		serverID = strings.TrimSpace(r.URL.Query().Get("server_id"))
	}
	if serverID == "" {
		http.Error(w, "server id is required", http.StatusBadRequest)
		return
	}

	interval := time.Duration(parsePositiveInt(r.URL.Query().Get("interval"), 2)) * time.Second
	if interval < time.Second {
		interval = time.Second
	}
	if interval > 10*time.Second {
		interval = 10 * time.Second
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("desktop monitor websocket accept failed: %v", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "closed")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	writeMu := &sync.Mutex{}
	writeJSON := func(value any) error {
		data, err := json.Marshal(value)
		if err != nil {
			return err
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		writeCtx, cancelWrite := context.WithTimeout(ctx, desktopGatewayWriteTimeout)
		defer cancelWrite()
		return conn.Write(writeCtx, websocket.MessageText, data)
	}
	writeBinary := func(data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		writeCtx, cancelWrite := context.WithTimeout(ctx, desktopGatewayWriteTimeout)
		defer cancelWrite()
		return conn.Write(writeCtx, websocket.MessageBinary, data)
	}

	_ = writeJSON(map[string]any{"type": "handshake_complete", "status": "connecting"})
	_ = writeJSON(map[string]any{"type": "ready"})

	done := make(chan struct{})
	var closeOnce sync.Once
	closeDone := func() {
		closeOnce.Do(func() {
			close(done)
		})
	}

	go func() {
		for {
			messageType, payload, err := conn.Read(ctx)
			if err != nil {
				closeDone()
				return
			}
			if messageType != websocket.MessageText {
				continue
			}
			var message struct {
				Type string `json:"type"`
				Ts   int64  `json:"ts,omitempty"`
			}
			if err := json.Unmarshal(payload, &message); err != nil {
				continue
			}
			if message.Type == "ping" {
				serverRecvTs := time.Now().UnixMilli()
				_ = writeJSON(map[string]any{
					"type":         "pong",
					"ts":           message.Ts,
					"serverRecvTs": serverRecvTs,
					"serverSendTs": time.Now().UnixMilli(),
				})
			}
		}
	}()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	var previousSnapshot *DesktopMonitorSnapshot
	sendSnapshot := func() {
		timeout := maxInt(15000, int(interval.Milliseconds())+10000)
		snapshot, err := g.monitor.Collect(DesktopMonitorCollectInput{
			ServerID:  serverID,
			TimeoutMs: timeout,
		})
		if err != nil {
			_ = writeJSON(map[string]any{"type": "error", "message": err.Error()})
			return
		}
		metrics := encodeDesktopMonitorSnapshotProto(snapshot, previousSnapshot)
		snapshotCopy := snapshot
		previousSnapshot = &snapshotCopy

		_ = writeBinary(metrics)
	}

	sendSnapshot()
	for {
		select {
		case <-ticker.C:
			sendSnapshot()
		case <-done:
			return
		case <-ctx.Done():
			return
		}
	}
}

func (g *DesktopGateway) sendTerminalCompletionData(
	ctx context.Context,
	runtime *desktopGatewayTerminalRuntime,
	options desktopGatewayFetchCompletionDataMessage,
) {
	includeScripts := true
	if options.IncludeScripts != nil {
		includeScripts = *options.IncludeScripts
	}

	scripts := []map[string]any{}
	if includeScripts && g.scriptService != nil {
		result, err := g.scriptService.List(DesktopScriptListParams{
			Page:  1,
			Limit: 1000,
		})
		if err != nil {
			log.Printf("failed to load desktop completion scripts: %v", err)
		} else {
			scripts = make([]map[string]any, 0, len(result.Data))
			for _, script := range result.Data {
				scripts = append(scripts, map[string]any{
					"name":        script.Name,
					"content":     script.Content,
					"description": script.Description,
					"executions":  script.Executions,
					"tags":        script.Tags,
				})
			}
		}
	}

	data, _ := json.Marshal(map[string]any{
		"history":   []string{},
		"scripts":   scripts,
		"timestamp": time.Now().UnixMilli(),
	})
	_ = runtime.writeJSON(ctx, desktopGatewayMessage{
		Type: "completion_data",
		Data: data,
	})
}

func (r *desktopGatewayTerminalRuntime) writeJSON(ctx context.Context, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	writeCtx, cancel := context.WithTimeout(ctx, desktopGatewayWriteTimeout)
	defer cancel()
	return r.conn.Write(writeCtx, websocket.MessageText, data)
}

func (r *desktopGatewayTerminalRuntime) writeBinary(ctx context.Context, data []byte) error {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	writeCtx, cancel := context.WithTimeout(ctx, desktopGatewayWriteTimeout)
	defer cancel()
	return r.conn.Write(writeCtx, websocket.MessageBinary, data)
}

func (r *desktopGatewayTerminalRuntime) sendError(ctx context.Context, code string, message string) {
	data, _ := json.Marshal(desktopGatewayErrorMessage{
		Error:   code,
		Message: message,
	})
	_ = r.writeJSON(ctx, desktopGatewayMessage{
		Type: "error",
		Data: data,
	})
}

func (r *desktopGatewayTerminalRuntime) copyTerminalOutput(ctx context.Context, reader io.Reader, closeDone func()) {
	buffer := make([]byte, 32768)
	for {
		read, err := reader.Read(buffer)
		if read > 0 {
			if writeErr := r.writeBinary(ctx, buffer[:read]); writeErr != nil {
				closeDone()
				return
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				log.Printf("desktop terminal output read failed: %v", err)
			}
			closeDone()
			return
		}
	}
}

func (r *desktopGatewayTerminalRuntime) readTerminalMessages(
	ctx context.Context,
	closeDone func(),
	onPing func(desktopGatewayPingMessage),
	onFetchCompletionData func(desktopGatewayFetchCompletionDataMessage),
) {
	for {
		messageType, payload, err := r.conn.Read(ctx)
		if err != nil {
			closeDone()
			return
		}
		switch messageType {
		case websocket.MessageBinary:
			if len(payload) == 0 {
				continue
			}
			if err := r.writeTerminalInput(payload); err != nil {
				closeDone()
				return
			}
		case websocket.MessageText:
			var message desktopGatewayMessage
			if err := json.Unmarshal(payload, &message); err != nil {
				continue
			}
			switch message.Type {
			case "resize":
				var resize desktopGatewayResizeMessage
				if err := json.Unmarshal(message.Data, &resize); err != nil {
					continue
				}
				r.resizeTerminal(resize.Cols, resize.Rows)
			case "input":
				var input struct {
					Data string `json:"data"`
				}
				if err := json.Unmarshal(message.Data, &input); err != nil {
					continue
				}
				if input.Data == "" {
					continue
				}
				if err := r.writeTerminalInput([]byte(input.Data)); err != nil {
					closeDone()
					return
				}
			case "ping":
				var ping desktopGatewayPingMessage
				if len(message.Data) > 0 {
					_ = json.Unmarshal(message.Data, &ping)
				}
				onPing(ping)
			case "auth_response":
				var response desktopGatewayAuthResponseMessage
				if err := json.Unmarshal(message.Data, &response); err != nil {
					continue
				}
				r.resolvePrompt(response)
			case "fetch_completion_data":
				var options desktopGatewayFetchCompletionDataMessage
				if len(message.Data) > 0 {
					_ = json.Unmarshal(message.Data, &options)
				}
				onFetchCompletionData(options)
			case "completion_update":
			}
		}
	}
}

func (r *desktopGatewayTerminalRuntime) setTerminalIO(stdin io.Writer, session *ssh.Session) {
	var pending *desktopGatewayResizeMessage

	r.terminalMu.Lock()
	r.stdin = stdin
	r.session = session
	if r.pendingResize != nil {
		resize := *r.pendingResize
		pending = &resize
		r.pendingResize = nil
	}
	r.terminalMu.Unlock()

	if pending != nil {
		if err := session.WindowChange(pending.Rows, pending.Cols); err != nil {
			log.Printf("desktop terminal pending resize failed: %v", err)
		}
	}
}

func (r *desktopGatewayTerminalRuntime) clearTerminalIO() {
	r.terminalMu.Lock()
	r.stdin = nil
	r.session = nil
	r.terminalMu.Unlock()
}

func (r *desktopGatewayTerminalRuntime) terminalSize(cols int, rows int) (int, int) {
	cols = normalizeTerminalCols(cols)
	rows = normalizeTerminalRows(rows)

	r.terminalMu.Lock()
	defer r.terminalMu.Unlock()
	if r.pendingResize != nil {
		cols = normalizeTerminalCols(r.pendingResize.Cols)
		rows = normalizeTerminalRows(r.pendingResize.Rows)
	}
	return cols, rows
}

func (r *desktopGatewayTerminalRuntime) resizeTerminal(cols int, rows int) {
	cols = normalizeTerminalCols(cols)
	rows = normalizeTerminalRows(rows)

	r.terminalMu.Lock()
	session := r.session
	if session == nil {
		r.pendingResize = &desktopGatewayResizeMessage{Cols: cols, Rows: rows}
		r.terminalMu.Unlock()
		return
	}
	r.terminalMu.Unlock()

	if err := session.WindowChange(rows, cols); err != nil {
		log.Printf("desktop terminal resize failed: %v", err)
	}
}

func (r *desktopGatewayTerminalRuntime) writeTerminalInput(payload []byte) error {
	r.terminalMu.Lock()
	stdin := r.stdin
	r.terminalMu.Unlock()
	if stdin == nil {
		return nil
	}

	r.stdinMu.Lock()
	defer r.stdinMu.Unlock()
	_, err := stdin.Write(payload)
	return err
}

func (r *desktopGatewayTerminalRuntime) registerPrompt(ch chan desktopGatewayAuthResponseMessage) string {
	id := fmt.Sprintf("desktop-terminal-auth-%d", time.Now().UnixNano())
	r.promptMu.Lock()
	r.prompts[id] = ch
	r.promptMu.Unlock()
	return id
}

func (r *desktopGatewayTerminalRuntime) unregisterPrompt(id string) {
	r.promptMu.Lock()
	delete(r.prompts, id)
	r.promptMu.Unlock()
}

func (r *desktopGatewayTerminalRuntime) resolvePrompt(response desktopGatewayAuthResponseMessage) {
	r.promptMu.Lock()
	ch := r.prompts[response.RequestID]
	r.promptMu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- response:
	default:
	}
}

func (r *desktopGatewayTerminalRuntime) requestCredential(
	ctx context.Context,
	authMethod DesktopServerAuthMethod,
	attempt int,
	maxAttempts int,
) (*DesktopSSHCredential, error) {
	ch := make(chan desktopGatewayAuthResponseMessage, 1)
	id := r.registerPrompt(ch)
	defer r.unregisterPrompt(id)

	authMethod = normalizeDesktopGatewayAuthMethod(authMethod, DesktopServerAuthPassword)
	promptText := "Password"
	if authMethod == DesktopServerAuthKey {
		promptText = "Private key"
	}

	prompt := desktopGatewayAuthPromptMessage{
		RequestID: id,
		Kind:      "credential_retry",
		Name:      r.serverName,
		Prompts: []desktopGatewayAuthPromptItem{{
			Text: promptText,
			Echo: false,
		}},
		AuthMethod:        authMethod,
		Attempt:           attempt,
		MaxAttempts:       maxAttempts,
		AttemptsRemaining: maxAttempts - attempt,
	}
	data, _ := json.Marshal(prompt)
	if err := r.writeJSON(ctx, desktopGatewayMessage{Type: "auth_prompt", Data: data}); err != nil {
		return nil, err
	}

	select {
	case response := <-ch:
		if response.Cancelled {
			return nil, errors.New("auth_cancelled")
		}
		nextMethod := normalizeDesktopGatewayAuthMethod(response.AuthMethod, authMethod)
		secret := firstString(response.Answers)
		if nextMethod == DesktopServerAuthPassword && strings.TrimSpace(response.Password) != "" {
			secret = response.Password
		}
		if nextMethod == DesktopServerAuthKey && strings.TrimSpace(response.PrivateKey) != "" {
			secret = response.PrivateKey
		}

		return &DesktopSSHCredential{
			AuthMethod: nextMethod,
			Secret:     secret,
		}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (r *desktopGatewayTerminalRuntime) requestPrivateKeyPassphrase(ctx context.Context, attempt int, maxAttempts int) (string, error) {
	ch := make(chan desktopGatewayAuthResponseMessage, 1)
	id := r.registerPrompt(ch)
	defer r.unregisterPrompt(id)

	prompt := desktopGatewayAuthPromptMessage{
		RequestID: id,
		Kind:      "private_key_passphrase",
		Name:      r.serverName,
		Prompts: []desktopGatewayAuthPromptItem{{
			Text: "Private key passphrase",
			Echo: false,
		}},
		AuthMethod:        DesktopServerAuthKey,
		Attempt:           attempt,
		MaxAttempts:       maxAttempts,
		AttemptsRemaining: maxAttempts - attempt,
	}
	data, _ := json.Marshal(prompt)
	if err := r.writeJSON(ctx, desktopGatewayMessage{Type: "auth_prompt", Data: data}); err != nil {
		return "", err
	}

	select {
	case response := <-ch:
		if response.Cancelled {
			return "", errors.New("auth_cancelled")
		}
		if response.PrivateKeyPassphrase != "" {
			return response.PrivateKeyPassphrase, nil
		}
		if response.PrivateKeyPassphrase2 != "" {
			return response.PrivateKeyPassphrase2, nil
		}
		return firstString(response.Answers), nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func calculateDesktopGatewayCPUUsage(snapshot DesktopMonitorSnapshot, previous *DesktopMonitorSnapshot) float64 {
	if previous == nil {
		return clampDesktopGatewayPercent(snapshot.CPU.UsagePercent)
	}

	idleDelta := float64(snapshot.CPU.IdleTicks) - float64(previous.CPU.IdleTicks)
	totalDelta := float64(snapshot.CPU.TotalTicks) - float64(previous.CPU.TotalTicks)
	if totalDelta <= 0 || idleDelta < 0 {
		return clampDesktopGatewayPercent(snapshot.CPU.UsagePercent)
	}

	return clampDesktopGatewayPercent((1 - idleDelta/totalDelta) * 100)
}

type desktopGatewayNetworkRate struct {
	bytesRecvPerSec uint64
	bytesSentPerSec uint64
}

func calculateDesktopGatewayNetworkRate(snapshot DesktopMonitorSnapshot, previous *DesktopMonitorSnapshot) desktopGatewayNetworkRate {
	if previous == nil {
		return desktopGatewayNetworkRate{}
	}

	elapsedSeconds := snapshot.Timestamp - previous.Timestamp
	if elapsedSeconds <= 0 {
		elapsedSeconds = 1
	}

	recvDelta := safeUint64Delta(snapshot.Network.BytesRecvTotal, previous.Network.BytesRecvTotal)
	sentDelta := safeUint64Delta(snapshot.Network.BytesSentTotal, previous.Network.BytesSentTotal)
	return desktopGatewayNetworkRate{
		bytesRecvPerSec: recvDelta / uint64(elapsedSeconds),
		bytesSentPerSec: sentDelta / uint64(elapsedSeconds),
	}
}

func safeUint64Delta(current uint64, previous uint64) uint64 {
	if current < previous {
		return 0
	}
	return current - previous
}

func clampDesktopGatewayPercent(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func measureDesktopSSHLatency(client *ssh.Client) (time.Duration, error) {
	started := time.Now()
	session, err := client.NewSession()
	if err != nil {
		return 0, err
	}
	defer session.Close()

	done := make(chan error, 1)
	go func() {
		done <- session.Run("true")
	}()

	select {
	case err := <-done:
		if err != nil {
			return 0, err
		}
	case <-time.After(5 * time.Second):
		_ = session.Close()
		return 0, errors.New("terminal ping timed out")
	}

	return time.Since(started), nil
}

func classifyDesktopGatewayTerminalError(err error) (string, string) {
	message := err.Error()
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "auth_cancelled"):
		return "auth_cancelled", "Authentication cancelled"
	case strings.Contains(lower, "private_key_passphrase_required"):
		return "private_key_passphrase_required", message
	case strings.Contains(lower, "private_key_passphrase_invalid"):
		return "private_key_passphrase_invalid", message
	case strings.Contains(lower, "failed to parse private key"):
		return "private_key_invalid", message
	case strings.Contains(lower, "server credential is required"):
		return "credential_required", message
	case isDesktopTerminalAuthRetryable(err):
		return "auth_failed", message
	case strings.Contains(lower, "connection refused"):
		return "connection_refused", message
	case strings.Contains(lower, "no route to host"):
		return "no_route_to_host", message
	case strings.Contains(lower, "network is unreachable"):
		return "network_unreachable", message
	case strings.Contains(lower, "timeout") || strings.Contains(lower, "deadline exceeded"):
		return "connection_timeout", message
	default:
		return "initialization_failed", message
	}
}

func isDesktopTerminalAuthRetryable(err error) bool {
	if err == nil {
		return false
	}

	message := strings.ToLower(err.Error())
	markers := []string{
		"server credential is required",
		"unable to authenticate",
		"permission denied",
		"authentication failed",
		"no supported methods remain",
		"attempted methods",
	}
	for _, marker := range markers {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func isDesktopTerminalPassphraseError(err error) bool {
	if err == nil {
		return false
	}

	message := strings.ToLower(err.Error())
	return strings.Contains(message, "private_key_passphrase_required") ||
		strings.Contains(message, "private_key_passphrase_invalid")
}

func normalizeDesktopGatewayAuthMethod(method DesktopServerAuthMethod, fallback DesktopServerAuthMethod) DesktopServerAuthMethod {
	if method == DesktopServerAuthKey {
		return DesktopServerAuthKey
	}
	if method == DesktopServerAuthPassword {
		return DesktopServerAuthPassword
	}
	return fallback
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func normalizeTerminalCols(cols int) int {
	if cols <= 0 {
		return 80
	}
	return cols
}

func normalizeTerminalRows(rows int) int {
	if rows <= 0 {
		return 24
	}
	return rows
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func serverDisplayName(server DesktopServer) string {
	if strings.TrimSpace(server.Name) != "" {
		return server.Name
	}
	return fmt.Sprintf("%s@%s:%d", server.Username, server.Host, server.Port)
}

func newDesktopGatewayToken() string {
	var bytes [24]byte
	if _, err := rand.Read(bytes[:]); err == nil {
		return hex.EncodeToString(bytes[:])
	}
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
