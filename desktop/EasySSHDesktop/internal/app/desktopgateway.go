package app

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
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
	"github.com/easyssh/shared/monitoring"
	"github.com/easyssh/shared/sftputil"
	"github.com/easyssh/shared/sshutil"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/crypto/ssh"
)

const (
	desktopGatewayTerminalInitTimeout = 5 * time.Minute
	desktopGatewayAuthMaxAttempts     = 3
	desktopGatewaySSHLatencyInterval  = 15 * time.Second
	desktopGatewayWriteTimeout        = 10 * time.Second
)

type DesktopGatewayInfo = protocol.DesktopGatewayInfo

type DesktopGateway struct {
	stopping      bool
	handlers      map[uint64]context.CancelFunc
	handlerID     uint64
	handlerWG     sync.WaitGroup
	serverService *DesktopServerService
	scriptService *DesktopScriptService
	monitor       *DesktopMonitorService
	sftpService   *DesktopSFTPService
	activity      *ActivityLogService

	mu          sync.RWMutex
	server      *http.Server
	httpBaseURL string
	wsBaseURL   string
	token       string
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
	prompts    map[string]chan protocol.TerminalAuthResponse
	hostKeys   map[string]chan protocol.TerminalHostKeyResponse
	serverName string
	serverID   string

	terminalMu    sync.Mutex
	stdin         io.Writer
	stdinMu       sync.Mutex
	session       *ssh.Session
	pendingResize *protocol.TerminalResize
}

func NewDesktopGateway(serverService *DesktopServerService, scriptService *DesktopScriptService, monitor *DesktopMonitorService, sftpService *DesktopSFTPService, activity *ActivityLogService) *DesktopGateway {
	return &DesktopGateway{
		serverService: serverService,
		scriptService: scriptService,
		monitor:       monitor,
		sftpService:   sftpService,
		activity:      activity,
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
	mux.HandleFunc("/terminal", g.trackHandler(g.handleTerminal))
	mux.HandleFunc("/monitor", g.trackHandler(g.handleMonitor))
	mux.HandleFunc("/sftp-auth", g.trackHandler(g.handleSFTPAuth))
	mux.HandleFunc("/sftp/auth", g.trackHandler(g.handleSFTPAuth))
	mux.HandleFunc("/sftp/upload", g.trackHandler(g.handleSFTPUpload))

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
	g.stopping = true
	cancels := make([]context.CancelFunc, 0, len(g.handlers))
	for _, cancel := range g.handlers {
		cancels = append(cancels, cancel)
	}
	g.server = nil
	g.httpBaseURL = ""
	g.wsBaseURL = ""
	g.mu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
	var err error
	if server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		err = server.Shutdown(ctx)
		cancel()
		if err != nil {
			_ = server.Close()
		}
	}
	g.handlerWG.Wait()
	return err
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

func desktopGatewayTokenMatches(provided, expected string) bool {
	// ConstantTimeCompare considers two empty slices equal; empty tokens must never authenticate.
	return provided != "" && expected != "" && subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func (g *DesktopGateway) validateRequest(r *http.Request) bool {
	if desktopGatewayTokenMatches(r.URL.Query().Get("ticket"), g.token) {
		return true
	}
	if desktopGatewayTokenMatches(r.URL.Query().Get("token"), g.token) {
		return true
	}
	if desktopGatewayTokenMatches(r.Header.Get("X-EasySSH-Desktop-Gateway-Token"), g.token) {
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

	server, err := g.serverService.getByIDRaw(serverID)
	if err != nil {
		http.Error(w, "server not found", http.StatusNotFound)
		return
	}
	observation, err := g.activity.beginConnection(r.Context(), server)
	if err != nil {
		http.Error(w, "connection observation storage is unavailable", http.StatusServiceUnavailable)
		return
	}
	outcome, outcomeCode := DesktopActivityLogStatus("canceled"), "client_closed"
	var disconnectedAt time.Time
	defer func() { observation.finish(outcome, outcomeCode, disconnectedAt) }()
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

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	runtime := &desktopGatewayTerminalRuntime{
		conn:     conn,
		prompts:  map[string]chan protocol.TerminalAuthResponse{},
		hostKeys: map[string]chan protocol.TerminalHostKeyResponse{},
		serverID: serverID,
	}

	done := make(chan struct{})
	var closeOnce sync.Once
	closeDone := func() {
		closeOnce.Do(func() {
			close(done)
			cancel()
		})
	}

	var terminalClientMu sync.RWMutex
	var terminalClient *ssh.Client
	var workers sync.WaitGroup
	spawn := func(work func()) { workers.Add(1); go func() { defer workers.Done(); work() }() }
	defer func() {
		cancel()
		terminalClientMu.Lock()
		client := terminalClient
		terminalClient = nil
		terminalClientMu.Unlock()
		if client != nil {
			_ = client.Close()
		}
		disconnectedAt = time.Now().UTC()
		_ = conn.CloseNow()
		workers.Wait()
		runtime.clearTerminalIO()
	}()
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

		spawn(func() {
			defer sshLatencyProbeInFlight.Store(false)
			latency, err := measureDesktopSSHLatency(ctx, client)
			if err != nil {
				return
			}
			sshLatencyMs.Store(latency.Milliseconds())
			sshLatencyMeasuredAt.Store(time.Now().UnixMilli())
		})
	}

	onPing := func(ping protocol.TerminalPing) {
		now := time.Now().UnixMilli()
		response := protocol.TerminalPong{
			ID:           &ping.ID,
			TS:           &ping.TS,
			ServerRecvTS: &now,
		}
		if latency := sshLatencyMs.Load(); latency >= 0 {
			response.SSHLatencyMs = &latency
			measuredAt := sshLatencyMeasuredAt.Load()
			response.SSHLatencyMeasuredAt = &measuredAt
		}
		sendTS := time.Now().UnixMilli()
		response.ServerSendTS = &sendTS
		data, _ := json.Marshal(response)
		_ = runtime.writeJSON(ctx, protocol.TerminalEnvelope{
			Type: string(protocol.TerminalServerMessageTypePong),
			Data: data,
		})
		refreshSSHLatency()
	}

	var completionInFlight atomic.Bool
	onFetchCompletionData := func(options protocol.TerminalFetchCompletionData) {
		terminalClientMu.RLock()
		client := terminalClient
		terminalClientMu.RUnlock()
		if client == nil {
			g.sendTerminalCompletionData(ctx, runtime, nil, options)
			return
		}
		if !completionInFlight.CompareAndSwap(false, true) {
			return
		}
		spawn(func() {
			defer completionInFlight.Store(false)
			g.sendTerminalCompletionData(ctx, runtime, client, options)
		})
	}

	readerCtx, cancelReader := context.WithCancel(ctx)
	defer cancelReader()
	spawn(func() { runtime.readTerminalMessages(readerCtx, closeDone, onPing, onFetchCompletionData) })

	handshakeData, _ := json.Marshal(protocol.TerminalHandshake{Status: "connecting"})
	if err := runtime.writeJSON(ctx, protocol.TerminalEnvelope{
		Type: string(protocol.TerminalServerMessageTypeHandshakeComplete),
		Data: handshakeData,
	}); err != nil {
		return
	}

	initCtx, cancelInit := context.WithTimeout(ctx, desktopGatewayTerminalInitTimeout)
	defer cancelInit()

	init := g.initializeTerminalSession(initCtx, runtime, server, cols, rows)
	cancelInit()

	if init.err != nil {
		outcome = "failure"
		if errors.Is(init.err, context.Canceled) {
			outcome = "canceled"
		}
		if errors.Is(init.err, context.DeadlineExceeded) {
			outcome = "timeout"
		}
		code, message := classifyDesktopGatewayTerminalError(init.err)
		outcomeCode = code
		runtime.sendError(ctx, code, message)
		return
	}

	terminalClientMu.Lock()
	terminalClient = init.client
	terminalClientMu.Unlock()
	// Close the transport before waiting for I/O workers, even when cancellation
	// occurs while a writer owns the terminal input lock.
	stopTransport := sftputil.CloseOnCancel(ctx, init.client.Close)
	defer stopTransport()
	if err := observation.established(); err != nil {
		outcome, outcomeCode = "unknown", "connection_persistence_failed"
		runtime.sendError(ctx, outcomeCode, "connection state could not be saved")
		return
	}
	outcome, outcomeCode = "success", "connection_closed"
	spawn(func() { observation.heartbeat(ctx) })

	if init.credential != nil {
		g.serverService.setTemporaryCredential(serverID, init.server.connectionRevision, init.server.credentialDigest(), *init.credential)
	}

	runtime.setTerminalIO(init.stdin, init.session)

	connectedData, _ := json.Marshal(protocol.TerminalConnected{SessionID: observation.record.Item.SourceID})
	if err := runtime.writeJSON(ctx, protocol.TerminalEnvelope{
		Type: string(protocol.TerminalServerMessageTypeConnected),
		Data: connectedData,
	}); err != nil {
		return
	}
	refreshSSHLatency()
	sessionResult := make(chan error, 1)
	spawn(func() { g.serverService.detectAndPersistOSIfEmpty(ctx, init.server, init.client) })
	var outputWG sync.WaitGroup
	outputWG.Add(2)
	spawn(func() { defer outputWG.Done(); runtime.copyTerminalOutput(ctx, init.stdout, cancel) })
	spawn(func() { defer outputWG.Done(); runtime.copyTerminalOutput(ctx, init.stderr, cancel) })
	spawn(func() {
		err := init.session.Wait()
		outputWG.Wait()
		sessionResult <- err
		if err != nil && !errors.Is(err, io.EOF) {
			message := strings.ToLower(err.Error())
			if !strings.Contains(message, "closed") {
				log.Printf("desktop terminal session ended: %v", err)
			}
		}
		closeDone()
	})

	select {
	case <-done:
	case <-ctx.Done():
	}

	select {
	case err := <-sessionResult:
		var exitErr *ssh.ExitError
		if err != nil && !errors.As(err, &exitErr) {
			outcome, outcomeCode = "unknown", "remote_transport_lost"
		}
	default:
	}
	_ = runtime.writeJSON(ctx, protocol.TerminalEnvelope{Type: string(protocol.TerminalServerMessageTypeClosed)})
}

func (g *DesktopGateway) initializeTerminalSession(
	ctx context.Context,
	runtime *desktopGatewayTerminalRuntime,
	server DesktopServer,
	cols int,
	rows int,
) (result desktopGatewayTerminalInitResult) {
	defer func() {
		if result.err != nil && ctx.Err() != nil {
			result.err = ctx.Err()
		}
	}()
	runtime.serverName = serverDisplayName(server)

	var credential *DesktopSSHCredential
	client, err := g.connectDesktopSSH(ctx, runtime, server, nil)
	if err != nil && isDesktopTerminalPassphraseError(err) && server.AuthMethod.RequiresPrivateKey() {
		var lastErr error = err
		for attempt := 1; attempt <= desktopGatewayAuthMaxAttempts; attempt++ {
			passphrase, promptErr := runtime.requestPrivateKeyPassphrase(ctx, attempt, desktopGatewayAuthMaxAttempts)
			if promptErr != nil {
				return desktopGatewayTerminalInitResult{server: server, err: promptErr}
			}
			credential = &DesktopSSHCredential{
				AuthMethod:           server.AuthMethod,
				PrivateKeyPassphrase: passphrase,
			}
			client, err = g.connectDesktopSSH(ctx, runtime, server, credential)
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
			client, err = g.connectDesktopSSH(ctx, runtime, server, credential)
			if err != nil && credential.AuthMethod.RequiresPrivateKey() && isDesktopTerminalPassphraseError(err) {
				var passphraseErr error = err
				for passphraseAttempt := 1; passphraseAttempt <= desktopGatewayAuthMaxAttempts; passphraseAttempt++ {
					passphrase, promptErr := runtime.requestPrivateKeyPassphrase(ctx, passphraseAttempt, desktopGatewayAuthMaxAttempts)
					if promptErr != nil {
						return desktopGatewayTerminalInitResult{server: server, err: promptErr}
					}
					credential.PrivateKeyPassphrase = passphrase
					client, err = g.connectDesktopSSH(ctx, runtime, server, credential)
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

	stopInitialization := sftputil.CloseOnCancel(ctx, client.Close)
	defer stopInitialization()
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
		client.Close()
		sshSession.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}

	stdin, err := sshSession.StdinPipe()
	if err != nil {
		client.Close()
		sshSession.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}
	stdout, err := sshSession.StdoutPipe()
	if err != nil {
		client.Close()
		sshSession.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}
	stderr, err := sshSession.StderrPipe()
	if err != nil {
		client.Close()
		sshSession.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}
	if err := sshSession.Shell(); err != nil {
		client.Close()
		sshSession.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}

	if err := ctx.Err(); err != nil {
		_ = client.Close()
		return desktopGatewayTerminalInitResult{server: server, err: err}
	}
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

func (g *DesktopGateway) connectDesktopSSH(
	ctx context.Context,
	runtime *desktopGatewayTerminalRuntime,
	server DesktopServer,
	credential *DesktopSSHCredential,
) (*ssh.Client, error) {
	if credential == nil {
		if cachedCredential, ok := g.serverService.getTemporaryCredential(server.ID, server.connectionRevision, server.credentialDigest()); ok {
			credential = cachedCredential
		}
	}
	var keyboardInteractive ssh.KeyboardInteractiveChallenge
	if runtime != nil {
		keyboardInteractive = runtime.keyboardInteractiveChallenge(ctx)
	}
	authMethods, err := buildDesktopServerSSHAuthMethodsWithCredentialAndKeyboard(server, credential, keyboardInteractive)
	if err != nil {
		return nil, err
	}
	if len(authMethods) == 0 {
		return nil, errors.New("server credential is required")
	}

	config := &ssh.ClientConfig{
		User: server.Username,
		Auth: authMethods,
		HostKeyCallback: desktopHostKeyCallbackWithChangeApproval(func(details *DesktopHostKeyVerificationError) (bool, error) {
			if runtime == nil {
				return false, errors.New("terminal runtime is not available")
			}
			return runtime.requestHostKeyApproval(ctx, details)
		}),
		Timeout: 12 * time.Second,
	}
	if err := configureDesktopHostKeyAlgorithms(config, server.Host, server.Port); err != nil {
		return nil, err
	}
	return dialDesktopSSH(ctx, server, config, keyboardInteractive)
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

	ctx, cancel := context.WithCancel(r.Context())
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

	_ = writeJSON(protocol.MonitorHandshake{Type: string(protocol.MonitorServerMessageTypeHandshakeComplete), Status: "connecting"})
	_ = writeJSON(protocol.MonitorReady{Type: string(protocol.MonitorServerMessageTypeReady)})

	done := make(chan struct{})
	var closeOnce sync.Once
	closeDone := func() {
		closeOnce.Do(func() {
			close(done)
		})
	}

	readerDone := make(chan struct{})
	defer func() { cancel(); _ = conn.CloseNow(); <-readerDone }()
	go func() {
		defer close(readerDone)
		for {
			messageType, payload, err := conn.Read(ctx)
			if err != nil {
				closeDone()
				return
			}
			if messageType != websocket.MessageText {
				continue
			}
			var message protocol.MonitorPing
			if err := json.Unmarshal(payload, &message); err != nil {
				continue
			}
			if message.Type == string(protocol.MonitorClientMessageTypePing) {
				serverRecvTs := time.Now().UnixMilli()
				_ = writeJSON(protocol.MonitorPong{
					Type:         string(protocol.MonitorServerMessageTypePong),
					TS:           message.TS,
					ServerRecvTS: serverRecvTs,
					ServerSendTS: time.Now().UnixMilli(),
				})
			}
		}
	}()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	var sampler monitoring.Sampler
	sendSnapshot := func() {
		timeout := maxInt(15000, int(interval.Milliseconds())+10000)
		sample, err := g.monitor.collect(ctx, DesktopMonitorCollectInput{
			ServerID:  serverID,
			TimeoutMs: timeout,
		})
		if err != nil {
			_ = writeJSON(protocol.MonitorError{Type: string(protocol.MonitorServerMessageTypeError),
				Message: err.Error()})
			return
		}
		metrics, err := encodeDesktopMonitorProto(sample, &sampler)
		if err != nil {
			_ = writeJSON(protocol.MonitorError{Type: string(protocol.MonitorServerMessageTypeError),
				Message: err.Error()})
			return
		}

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

func (g *DesktopGateway) handleSFTPAuth(w http.ResponseWriter, r *http.Request) {
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

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("desktop sftp auth websocket accept failed: %v", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "closed")

	ctx, cancel := context.WithTimeout(r.Context(), desktopGatewayTerminalInitTimeout)
	defer cancel()
	runtime := &desktopGatewayTerminalRuntime{
		conn:     conn,
		prompts:  map[string]chan protocol.TerminalAuthResponse{},
		hostKeys: map[string]chan protocol.TerminalHostKeyResponse{},
		serverID: serverID,
	}

	writeStatus := func(status string) {
		data, _ := json.Marshal(protocol.SFTPAuthStatus{Status: status})
		_ = runtime.writeJSON(ctx, protocol.TerminalEnvelope{
			Type: string(protocol.SFTPAuthServerMessageTypeStatus),
			Data: data,
		})
	}
	writeError := func(code string, err error) {
		message := ""
		if err != nil {
			message = err.Error()
		}
		data, _ := json.Marshal(protocol.TerminalError{
			Error:   code,
			Message: message,
		})
		_ = runtime.writeJSON(ctx, protocol.TerminalEnvelope{
			Type: string(protocol.TerminalServerMessageTypeError),
			Data: data,
		})
	}

	server, err := g.serverService.getByIDRaw(serverID)
	if err != nil {
		writeError("server_not_found", err)
		return
	}
	runtime.serverName = serverDisplayName(server)

	writeStatus("authenticating")
	start, err := runtime.readSFTPAuthStart(ctx)
	if err != nil {
		writeError("sftp_auth_request_failed", err)
		return
	}

	authCtx, cancelAuth := context.WithCancel(ctx)
	defer cancelAuth()
	readerDone := make(chan struct{})
	defer func() { cancelAuth(); _ = conn.CloseNow(); <-readerDone }()
	go func() { defer close(readerDone); runtime.readSFTPAuthMessages(authCtx, cancelAuth) }()

	authMethod := normalizeDesktopGatewayAuthMethod(DesktopServerAuthMethod(start.AuthMethod), server.AuthMethod)
	credential := &DesktopSSHCredential{
		AuthMethod:           authMethod,
		Secret:               start.Secret,
		Password:             start.Password,
		PrivateKey:           start.PrivateKey,
		PrivateKeyPassphrase: start.PrivateKeyPassphrase,
	}

	if g.sftpService == nil {
		writeError("sftp_service_unavailable", errors.New("file service is unavailable"))
		return
	}
	g.sftpService.authenticatedMu.Lock()
	version := g.sftpService.authenticatedVersion
	g.sftpService.authenticatedMu.Unlock()
	client, closer, revision, err := g.connectDesktopSFTPAuthSSH(authCtx, runtime, server, credential)
	if err != nil {
		code, message := classifyDesktopGatewaySFTPAuthError(err)
		writeError(code, errors.New(message))
		return
	}
	if authCtx.Err() != nil {
		closer()
		return
	}

	if err = g.sftpService.setAuthenticatedSSHClient(serverID, client, closer, revision, version); err != nil {
		writeError("sftp_service_unavailable", err)
		return
	}
	g.serverService.setTemporaryCredential(serverID, revision, server.credentialDigest(), *credential)

	data, _ := json.Marshal(protocol.SFTPAuthStatus{Status: "authenticated"})
	_ = runtime.writeJSON(ctx, protocol.TerminalEnvelope{
		Type: string(protocol.SFTPAuthServerMessageTypeAuthenticated),
		Data: data,
	})
}

func (g *DesktopGateway) connectDesktopSFTPAuthSSH(
	ctx context.Context,
	runtime *desktopGatewayTerminalRuntime,
	server DesktopServer,
	credential *DesktopSSHCredential,
) (*ssh.Client, func(), int64, error) {
	var keyboardInteractive ssh.KeyboardInteractiveChallenge
	if runtime != nil {
		keyboardInteractive = runtime.keyboardInteractiveChallenge(ctx)
	}
	authMethods, err := buildDesktopServerSSHAuthMethodsWithCredentialAndKeyboard(server, credential, keyboardInteractive)
	if err != nil {
		return nil, nil, 0, err
	}
	if len(authMethods) == 0 {
		return nil, nil, 0, errors.New("server credential is required")
	}

	var negotiatedHostKey ssh.PublicKey
	config := &ssh.ClientConfig{
		User: server.Username,
		Auth: authMethods,
		HostKeyCallback: desktopHostKeyCallbackWithChangeApproval(func(details *DesktopHostKeyVerificationError) (bool, error) {
			if runtime == nil {
				return false, errors.New("sftp auth runtime is not available")
			}
			return runtime.requestHostKeyApproval(ctx, details)
		}),
		Timeout: 12 * time.Second,
	}
	verifyHost := config.HostKeyCallback
	config.HostKeyCallback = func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		if err := verifyHost(hostname, remote, key); err != nil {
			return err
		}
		negotiatedHostKey = key
		return nil
	}
	if err := configureDesktopHostKeyAlgorithms(config, server.Host, server.Port); err != nil {
		return nil, nil, 0, err
	}
	if g.sftpService == nil {
		return nil, nil, 0, errors.New("file service is unavailable")
	}
	client, closeClient, err := g.sftpService.dialFileSSH(ctx, server, config, desktopGatewayTerminalInitTimeout, keyboardInteractive)
	if err != nil {
		return nil, nil, 0, err
	}
	// Host confirmation may advance revision during authentication. Recheck the
	// actual key and connection definition before caching that confirmed version.
	current, err := g.serverService.getByIDRaw(server.ID)
	if err != nil || !desktopSameJumpRoute(current, server) || current.Host != server.Host || current.Port != server.Port || current.Username != server.Username || current.AuthMethod != server.AuthMethod || current.Password != server.Password || current.PrivateKey != server.PrivateKey || current.SavedPrivateKeyPassphrase != server.SavedPrivateKeyPassphrase {
		closeClient()
		return nil, nil, 0, errors.New("server connection configuration changed; reconnect")
	}
	if negotiatedHostKey == nil {
		closeClient()
		return nil, nil, 0, errors.New("SSH host verification did not complete")
	}
	if err = desktopHostKeyCallback()(net.JoinHostPort(server.Host, strconv.Itoa(server.Port)), client.RemoteAddr(), negotiatedHostKey); err != nil {
		closeClient()
		return nil, nil, 0, err
	}
	return client, closeClient, current.connectionRevision, nil
}

func (g *DesktopGateway) sendTerminalCompletionData(
	ctx context.Context,
	runtime *desktopGatewayTerminalRuntime,
	client *ssh.Client,
	options protocol.TerminalFetchCompletionData,
) {
	includeHistory := true
	if options.IncludeHistory != nil {
		includeHistory = *options.IncludeHistory
	}
	includeScripts := true
	if options.IncludeScripts != nil {
		includeScripts = *options.IncludeScripts
	}

	history := []string{}
	if includeHistory && client != nil {
		remoteHistory, err := sshutil.FetchCompletionHistory(ctx, client)
		if err != nil {
			log.Printf("failed to load desktop remote completion history: %v", err)
		} else {
			history = remoteHistory
		}
	}

	scripts := []protocol.TerminalCompletionScript{}
	if includeScripts && g.scriptService != nil {
		result, err := g.scriptService.List(DesktopScriptListParams{
			Page:  1,
			Limit: 1000,
		})
		if err != nil {
			log.Printf("failed to load desktop completion scripts: %v", err)
		} else {
			scripts = make([]protocol.TerminalCompletionScript, 0, len(result.Data))
			for _, script := range result.Data {
				scripts = append(scripts, protocol.TerminalCompletionScript{
					Name:        script.Name,
					Content:     script.Content,
					Description: script.Description,
					Executions:  script.Executions,
					Tags:        script.Tags,
				})
			}
		}
	}

	data, _ := json.Marshal(protocol.TerminalCompletionData{
		History:   history,
		Scripts:   scripts,
		Timestamp: time.Now().UnixMilli(),
	})
	_ = runtime.writeJSON(ctx, protocol.TerminalEnvelope{
		Type: string(protocol.TerminalServerMessageTypeCompletionData),
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
	data, _ := json.Marshal(protocol.TerminalError{
		Error:   code,
		Message: message,
	})
	_ = r.writeJSON(ctx, protocol.TerminalEnvelope{
		Type: string(protocol.TerminalServerMessageTypeError),
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
				closeDone()
			}
			return
		}
	}
}

func (r *desktopGatewayTerminalRuntime) readTerminalMessages(
	ctx context.Context,
	closeDone func(),
	onPing func(protocol.TerminalPing),
	onFetchCompletionData func(protocol.TerminalFetchCompletionData),
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
			var message protocol.TerminalEnvelope
			if err := json.Unmarshal(payload, &message); err != nil {
				continue
			}
			switch message.Type {
			case string(protocol.TerminalClientMessageTypeResize):
				var resize protocol.TerminalResize
				if err := json.Unmarshal(message.Data, &resize); err != nil {
					continue
				}
				r.resizeTerminal(resize.Cols, resize.Rows)
			case string(protocol.TerminalClientMessageTypeInput):
				var input protocol.TerminalInput
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
			case string(protocol.TerminalClientMessageTypePing):
				var ping protocol.TerminalPing
				if len(message.Data) > 0 {
					_ = json.Unmarshal(message.Data, &ping)
				}
				onPing(ping)
			case string(protocol.TerminalClientMessageTypeAuthResponse):
				var response protocol.TerminalAuthResponse
				if err := json.Unmarshal(message.Data, &response); err != nil {
					continue
				}
				r.resolvePrompt(response)
			case string(protocol.TerminalClientMessageTypeHostKeyResponse):
				var response protocol.TerminalHostKeyResponse
				if err := json.Unmarshal(message.Data, &response); err != nil {
					continue
				}
				r.resolveHostKeyPrompt(response)
			case string(protocol.TerminalClientMessageTypeFetchCompletionData):
				var options protocol.TerminalFetchCompletionData
				if len(message.Data) > 0 {
					_ = json.Unmarshal(message.Data, &options)
				}
				onFetchCompletionData(options)
			}
		}
	}
}

func (r *desktopGatewayTerminalRuntime) readSFTPAuthStart(ctx context.Context) (protocol.SFTPAuthStart, error) {
	for {
		messageType, payload, err := r.conn.Read(ctx)
		if err != nil {
			return protocol.SFTPAuthStart{}, err
		}
		if messageType != websocket.MessageText {
			continue
		}

		var message protocol.TerminalEnvelope
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}
		switch message.Type {
		case string(protocol.TerminalClientMessageTypePing):
			_ = r.writeJSON(ctx, protocol.TerminalEnvelope{
				Type: string(protocol.TerminalServerMessageTypePong),
				Data: message.Data,
			})
		case string(protocol.SFTPAuthClientMessageTypeAuthStart):
			var start protocol.SFTPAuthStart
			if len(message.Data) > 0 {
				if err := json.Unmarshal(message.Data, &start); err != nil {
					return protocol.SFTPAuthStart{}, err
				}
			}
			return start, nil
		}
	}
}

func (r *desktopGatewayTerminalRuntime) readSFTPAuthMessages(ctx context.Context, cancel context.CancelFunc) {
	defer cancel()

	for {
		messageType, payload, err := r.conn.Read(ctx)
		if err != nil {
			return
		}
		if messageType != websocket.MessageText {
			continue
		}

		var message protocol.TerminalEnvelope
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}
		switch message.Type {
		case string(protocol.TerminalClientMessageTypePing):
			_ = r.writeJSON(ctx, protocol.TerminalEnvelope{
				Type: string(protocol.TerminalServerMessageTypePong),
				Data: message.Data,
			})
		case string(protocol.TerminalClientMessageTypeAuthResponse):
			var response protocol.TerminalAuthResponse
			if err := json.Unmarshal(message.Data, &response); err != nil {
				continue
			}
			r.resolvePrompt(response)
		case string(protocol.TerminalClientMessageTypeHostKeyResponse):
			var response protocol.TerminalHostKeyResponse
			if err := json.Unmarshal(message.Data, &response); err != nil {
				continue
			}
			r.resolveHostKeyPrompt(response)
		}
	}
}

func (r *desktopGatewayTerminalRuntime) setTerminalIO(stdin io.Writer, session *ssh.Session) {
	var pending *protocol.TerminalResize

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
		r.pendingResize = &protocol.TerminalResize{Cols: cols, Rows: rows}
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

func (r *desktopGatewayTerminalRuntime) registerPrompt(ch chan protocol.TerminalAuthResponse) string {
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

func (r *desktopGatewayTerminalRuntime) resolvePrompt(response protocol.TerminalAuthResponse) {
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

func (r *desktopGatewayTerminalRuntime) registerHostKeyPrompt(ch chan protocol.TerminalHostKeyResponse) string {
	id := fmt.Sprintf("desktop-terminal-host-key-%d", time.Now().UnixNano())
	r.promptMu.Lock()
	r.hostKeys[id] = ch
	r.promptMu.Unlock()
	return id
}

func (r *desktopGatewayTerminalRuntime) unregisterHostKeyPrompt(id string) {
	r.promptMu.Lock()
	delete(r.hostKeys, id)
	r.promptMu.Unlock()
}

func (r *desktopGatewayTerminalRuntime) resolveHostKeyPrompt(response protocol.TerminalHostKeyResponse) {
	r.promptMu.Lock()
	ch := r.hostKeys[response.RequestID]
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
	ch := make(chan protocol.TerminalAuthResponse, 1)
	id := r.registerPrompt(ch)
	defer r.unregisterPrompt(id)

	authMethod = normalizeDesktopGatewayAuthMethod(authMethod, DesktopServerAuthPassword)
	factors, _ := authMethod.AuthFactors()
	prompts := make([]protocol.TerminalAuthPromptItem, 0, len(factors))
	for _, factor := range factors {
		switch factor {
		case DesktopServerAuthFactorPassword:
			prompts = append(prompts, protocol.TerminalAuthPromptItem{
				Text: "Password",
				Echo: false,
			})
		case DesktopServerAuthFactorKey:
			prompts = append(prompts, protocol.TerminalAuthPromptItem{
				Text: "Private key",
				Echo: false,
			})
		}
	}
	if len(prompts) == 0 {
		prompts = append(prompts, protocol.TerminalAuthPromptItem{
			Text: "Password",
			Echo: false,
		})
	}

	prompt := protocol.TerminalAuthPrompt{
		RequestID:         id,
		Kind:              "credential_retry",
		Name:              r.serverName,
		Prompts:           prompts,
		AuthMethod:        string(authMethod),
		Attempt:           attempt,
		MaxAttempts:       maxAttempts,
		AttemptsRemaining: maxAttempts - attempt,
	}
	data, _ := json.Marshal(prompt)
	if err := r.writeJSON(ctx, protocol.TerminalEnvelope{Type: string(protocol.TerminalServerMessageTypeAuthPrompt), Data: data}); err != nil {
		return nil, err
	}

	select {
	case response := <-ch:
		if response.Cancelled {
			return nil, errors.New("auth_cancelled")
		}
		nextMethod := normalizeDesktopGatewayAuthMethod(DesktopServerAuthMethod(response.AuthMethod), authMethod)
		password, privateKey := desktopGatewayCredentialValues(nextMethod, response)

		return &DesktopSSHCredential{
			AuthMethod: nextMethod,
			Secret:     firstString(response.Answers),
			Password:   password,
			PrivateKey: privateKey,
		}, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (r *desktopGatewayTerminalRuntime) keyboardInteractiveChallenge(ctx context.Context) ssh.KeyboardInteractiveChallenge {
	return func(name string, instruction string, questions []string, echos []bool) ([]string, error) {
		if len(questions) == 0 {
			return []string{}, nil
		}

		ch := make(chan protocol.TerminalAuthResponse, 1)
		id := r.registerPrompt(ch)
		defer r.unregisterPrompt(id)

		prompts := make([]protocol.TerminalAuthPromptItem, len(questions))
		for index, question := range questions {
			echo := false
			if index < len(echos) {
				echo = echos[index]
			}
			prompts[index] = protocol.TerminalAuthPromptItem{
				Text: question,
				Echo: echo,
			}
		}

		prompt := protocol.TerminalAuthPrompt{
			RequestID:   id,
			Kind:        "keyboard_interactive",
			Name:        name,
			Instruction: instruction,
			Prompts:     prompts,
		}
		data, _ := json.Marshal(prompt)
		if err := r.writeJSON(ctx, protocol.TerminalEnvelope{Type: string(protocol.TerminalServerMessageTypeAuthPrompt), Data: data}); err != nil {
			return nil, err
		}

		select {
		case response := <-ch:
			if response.Cancelled {
				return nil, errors.New("auth_cancelled")
			}
			answers := make([]string, len(questions))
			copy(answers, response.Answers)
			return answers, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

func (r *desktopGatewayTerminalRuntime) requestHostKeyApproval(ctx context.Context, details *DesktopHostKeyVerificationError) (bool, error) {
	ch := make(chan protocol.TerminalHostKeyResponse, 1)
	id := r.registerHostKeyPrompt(ch)
	defer r.unregisterHostKeyPrompt(id)

	payload := protocol.TerminalHostKeyPrompt{
		RequestID:       id,
		Host:            details.Host,
		Port:            details.Port,
		ExpectedKey:     details.ExpectedKey,
		ReceivedKey:     details.ReceivedKey,
		ExpectedKeyType: details.ExpectedKeyType,
		ReceivedKeyType: details.ReceivedKeyType,
		Message:         details.Message,
	}
	data, _ := json.Marshal(payload)
	if err := r.writeJSON(ctx, protocol.TerminalEnvelope{Type: string(protocol.TerminalServerMessageTypeHostKeyPrompt), Data: data}); err != nil {
		return false, err
	}

	select {
	case response := <-ch:
		if !response.Accepted {
			return false, nil
		}
		if response.Fingerprint != "" && response.Fingerprint != details.ReceivedKey {
			return false, fmt.Errorf(
				"host key response fingerprint mismatch: approved %s, expected %s",
				response.Fingerprint,
				details.ReceivedKey,
			)
		}
		return true, nil
	case <-ctx.Done():
		return false, ctx.Err()
	}
}

func (r *desktopGatewayTerminalRuntime) requestPrivateKeyPassphrase(ctx context.Context, attempt int, maxAttempts int) (string, error) {
	ch := make(chan protocol.TerminalAuthResponse, 1)
	id := r.registerPrompt(ch)
	defer r.unregisterPrompt(id)

	prompt := protocol.TerminalAuthPrompt{
		RequestID: id,
		Kind:      "private_key_passphrase",
		Name:      r.serverName,
		Prompts: []protocol.TerminalAuthPromptItem{{
			Text: "Private key passphrase",
			Echo: false,
		}},
		AuthMethod:        string(DesktopServerAuthKey),
		Attempt:           attempt,
		MaxAttempts:       maxAttempts,
		AttemptsRemaining: maxAttempts - attempt,
	}
	data, _ := json.Marshal(prompt)
	if err := r.writeJSON(ctx, protocol.TerminalEnvelope{Type: string(protocol.TerminalServerMessageTypeAuthPrompt), Data: data}); err != nil {
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
		if response.PrivateKeyPassphraseSnake != "" {
			return response.PrivateKeyPassphraseSnake, nil
		}
		return firstString(response.Answers), nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func measureDesktopSSHLatency(ctx context.Context, client *ssh.Client) (time.Duration, error) {
	started := time.Now()
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_, err := sshutil.CommandOutput(bounded, client, "true", 4096)
	if err != nil {
		return 0, err
	}
	return time.Since(started), nil
}

func classifyDesktopGatewayTerminalError(err error) (string, string) {
	message := err.Error()
	lower := strings.ToLower(message)
	var hostKeyErr *DesktopHostKeyVerificationError
	switch {
	case errors.Is(err, sshutil.ErrForwardingDenied):
		return "ssh_forwarding_denied", message
	case errors.As(err, &hostKeyErr):
		return "host_key_changed", message
	case errors.Is(err, errDesktopHostKeyRevoked):
		return "host_key_revoked", message
	case strings.Contains(lower, "host key verification failed"):
		return "host_key_changed", message
	case strings.Contains(lower, "host key trust has been revoked"):
		return "host_key_revoked", message
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

func classifyDesktopGatewaySFTPAuthError(err error) (string, string) {
	if err == nil {
		return "sftp_auth_failed", ""
	}

	message := err.Error()
	lower := strings.ToLower(message)
	var hostKeyErr *DesktopHostKeyVerificationError
	switch {
	case errors.As(err, &hostKeyErr):
		return "sftp_host_key_changed", message
	case errors.Is(err, errDesktopHostKeyRevoked):
		return "host_key_revoked", message
	case strings.Contains(lower, "host key verification failed"):
		return "sftp_host_key_changed", message
	case strings.Contains(lower, "host key trust has been revoked"):
		return "host_key_revoked", message
	case strings.Contains(lower, "auth_cancelled") ||
		strings.Contains(lower, "authentication cancelled"):
		return "auth_cancelled", "Authentication cancelled"
	case strings.Contains(lower, "private_key_passphrase_required"):
		return "sftp_private_key_passphrase_required", message
	case strings.Contains(lower, "private_key_passphrase_invalid"):
		return "sftp_private_key_passphrase_invalid", message
	case strings.Contains(lower, "keyboard_interactive_required"):
		return "keyboard_interactive_required", message
	case isDesktopTerminalAuthRetryable(err):
		return "sftp_credential_required", message
	default:
		return "sftp_auth_failed", message
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
		"failed to parse private key",
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
	method = normalizeDesktopServerAuthMethod(method)
	if method.IsValid() {
		return method
	}
	return fallback
}

func desktopGatewayCredentialValues(method DesktopServerAuthMethod, response protocol.TerminalAuthResponse) (string, string) {
	password := response.Password
	privateKey := response.PrivateKey

	answers := response.Answers
	answerIndex := 0
	factors, ok := method.AuthFactors()
	if !ok {
		return "", ""
	}
	for _, factor := range factors {
		if factor != DesktopServerAuthFactorPassword && factor != DesktopServerAuthFactorKey {
			continue
		}
		if answerIndex >= len(answers) {
			break
		}
		switch factor {
		case DesktopServerAuthFactorPassword:
			if password == "" {
				password = answers[answerIndex]
			}
		case DesktopServerAuthFactorKey:
			if strings.TrimSpace(privateKey) == "" {
				privateKey = answers[answerIndex]
			}
		}
		answerIndex++
	}
	return password, privateKey
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
