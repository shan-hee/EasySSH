package ssh

import (
	"context"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/secretcrypto"
	"github.com/easyssh/shared/sshutil"
	"golang.org/x/crypto/ssh"
)

// Client SSH 客户端封装
type Client struct {
	mu        sync.RWMutex
	closed    bool
	conn      *ssh.Client
	serverID  string
	config    *ssh.ClientConfig
	jumps     []sshutil.Hop
	connected bool
	createdAt time.Time
}

type CommandResult struct {
	Command     string
	Output      string
	ExitCode    *int
	Outcome     string
	Error       string
	DurationMs  int64
	StartedAt   time.Time
	CompletedAt time.Time
}

var ErrCredentialRequired = errors.New("server credential is required")
var ErrHostKeyCallbackRequired = errors.New("ssh host key callback is required")

type clientOptions struct {
	keyboardInteractive  ssh.KeyboardInteractiveChallenge
	authMethod           *server.AuthMethod
	authMethodExplicit   bool
	password             string
	privateKey           string
	privateKeyPassphrase string
	hostKeyCallback      sshutil.HostKeyPolicy
}

// ClientOption configures optional SSH client behavior.
type ClientOption func(*clientOptions)

// WithKeyboardInteractive enables SSH keyboard-interactive authentication.
func WithKeyboardInteractive(challenge ssh.KeyboardInteractiveChallenge) ClientOption {
	return func(opts *clientOptions) {
		opts.keyboardInteractive = challenge
	}
}

// WithAuthMethod overrides the server's saved authentication strategy for this connection.
func WithAuthMethod(method server.AuthMethod) ClientOption {
	return func(opts *clientOptions) {
		opts.authMethod = &method
		opts.authMethodExplicit = true
	}
}

// WithPasswordAuth uses a plaintext password for this SSH connection only.
func WithPasswordAuth(password string) ClientOption {
	return func(opts *clientOptions) {
		if !opts.authMethodExplicit {
			method := server.AuthMethodPassword
			opts.authMethod = &method
		}
		opts.password = password
	}
}

// WithPrivateKeyAuth uses a plaintext private key for this SSH connection only.
func WithPrivateKeyAuth(privateKey string) ClientOption {
	return func(opts *clientOptions) {
		if !opts.authMethodExplicit {
			method := server.AuthMethodKey
			opts.authMethod = &method
		}
		opts.privateKey = privateKey
	}
}

// WithPrivateKeyPassphrase uses a plaintext passphrase for an encrypted private key.
func WithPrivateKeyPassphrase(passphrase string) ClientOption {
	return func(opts *clientOptions) {
		opts.privateKeyPassphrase = passphrase
	}
}

// WithHostKeyCallback overrides host key verification for this SSH connection.
func WithHostKeyPolicy(callback sshutil.HostKeyPolicy) ClientOption {
	return func(opts *clientOptions) {
		opts.hostKeyCallback = callback
	}
}

// NewClient 创建 SSH 客户端
func NewClient(ctx context.Context, srv *server.Server, encryptor *crypto.Encryptor, hostKeyCallback sshutil.HostKeyPolicy, opts ...ClientOption) (*Client, error) {
	if srv == nil {
		return nil, access.ErrForbidden
	}
	scope := srv.ExecutionScope()
	if err := scope.Check(ctx, access.Requirement{Action: protocol.WorkspaceRead, ServerID: srv.ID.String()}); err != nil {
		return nil, err
	}
	if hostKeyCallback == nil {
		return nil, ErrHostKeyCallbackRequired
	}

	options := &clientOptions{}
	for _, opt := range opts {
		if opt != nil {
			opt(options)
		}
	}
	if !scope.IsOwner() && (options.authMethod != nil || options.password != "" || options.privateKey != "" || options.privateKeyPassphrase != "") {
		return nil, access.ErrForbidden
	}
	if options.keyboardInteractive != nil {
		if !scope.IsOwner() && !srv.Auth.AuthMethod.SupportsKeyboardInteractive() {
			options.keyboardInteractive = nil
		} else {
			challenge := options.keyboardInteractive
			options.keyboardInteractive = func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				if err := scope.CheckInteractive(ctx, srv.ID.String()); err != nil {
					return nil, err
				}
				answers, err := challenge(user, instruction, questions, echos)
				if err != nil {
					return nil, err
				}
				if err := scope.CheckInteractive(ctx, srv.ID.String()); err != nil {
					return nil, err
				}
				return answers, nil
			}
		}
	}
	if options.hostKeyCallback != nil {
		hostKeyCallback = options.hostKeyCallback
	}

	// 解密认证信息
	var authMethods []ssh.AuthMethod

	authMethod := srv.Auth.AuthMethod
	if options.authMethod != nil {
		authMethod = *options.authMethod
	}

	factors, ok := authMethod.AuthFactors()
	if !ok {
		return nil, fmt.Errorf("unsupported auth method: %s", authMethod)
	}

	hasKeyboardInteractive := false
	for _, factor := range factors {
		switch factor {
		case server.AuthFactorPassword:
			password := options.password
			if password == "" {
				var err error
				password, err = encryptor.DecryptWithAAD(srv.Auth.Password, srv.CredentialAAD("password"))
				if err != nil {
					return nil, fmt.Errorf("failed to decrypt password: %w", err)
				}
			}
			if password == "" {
				return nil, ErrCredentialRequired
			}
			authMethods = append(authMethods, ssh.Password(password))
		case server.AuthFactorKey:
			privateKey := options.privateKey
			phrase := options.privateKeyPassphrase
			if privateKey == "" && srv.Auth.SSHKeyID != nil {
				if srv.Auth.SSHKey == nil || srv.Auth.SSHKey.ID != *srv.Auth.SSHKeyID {
					return nil, errors.New("saved SSH key is unavailable")
				}
				var err error
				if phrase == "" && srv.Auth.SSHKey.SavedPassphrase != "" {
					phrase, err = encryptor.DecryptSecret(srv.Auth.SSHKey.SavedPassphrase, srv.Auth.SSHKey.PassphraseAAD())
					if err != nil {
						return nil, err
					}
				}
				privateKey, err = encryptor.DecryptWithAAD(srv.Auth.SSHKey.PrivateKey, srv.Auth.SSHKey.PrivateKeyAAD())
				if err != nil {
					return nil, fmt.Errorf("failed to decrypt private key: %w", err)
				}
			}
			if privateKey == "" {
				return nil, ErrCredentialRequired
			}

			signer, err := sshutil.ParsePrivateKey(privateKey, phrase)
			if err != nil {
				return nil, err
			}
			authMethods = append(authMethods, ssh.PublicKeys(signer))
		case server.AuthFactorKeyboardInteractive:
			if options.keyboardInteractive == nil {
				return nil, fmt.Errorf("keyboard_interactive_required")
			}
			hasKeyboardInteractive = true
			authMethods = append(authMethods, ssh.KeyboardInteractive(options.keyboardInteractive))
		}
	}

	if options.keyboardInteractive != nil && !hasKeyboardInteractive {
		authMethods = append(authMethods, ssh.KeyboardInteractive(options.keyboardInteractive))
	}

	verifyHostKey, algorithms, err := hostKeyCallback(srv.Host, srv.Port)
	if err != nil {
		return nil, err
	}
	config := &ssh.ClientConfig{
		User:              srv.Username,
		Auth:              authMethods,
		HostKeyCallback:   verifyHostKey,
		HostKeyAlgorithms: algorithms,
		Timeout:           30 * time.Second,
	}

	client := &Client{
		serverID:  srv.ID.String(),
		config:    config,
		connected: false,
		createdAt: time.Now(),
	}

	jumps, err := srv.JumpServers(ctx)
	if err != nil {
		return nil, err
	}
	for _, jump := range jumps {
		// Only the target may use the caller's temporary credentials. Each jump uses
		// its own saved identity and the same host-key / interactive approval policy.
		endpoint := *jump
		endpoint.JumpServerID = nil
		hop, err := NewClient(ctx, &endpoint, encryptor, hostKeyCallback, WithKeyboardInteractive(options.keyboardInteractive))
		if err != nil {
			return nil, fmt.Errorf("jump server %s: %w", jump.Host, err)
		}
		client.jumps = append(client.jumps, sshutil.Hop{Address: net.JoinHostPort(jump.Host, fmt.Sprint(jump.Port)), Config: hop.config})
	}
	return client, nil
}

// Connect 连接到服务器
func (c *Client) Connect(host string, port int) error {
	return c.ConnectContext(context.Background(), host, port)
}

// ConnectContext bounds establishment of the entire route by the caller's deadline.
func (c *Client) ConnectContext(ctx context.Context, host string, port int) error {
	if _, ok := ctx.Deadline(); !ok && c.config.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.config.Timeout)
		defer cancel()
	}
	route := append([]sshutil.Hop(nil), c.jumps...)
	route = append(route, sshutil.Hop{Address: net.JoinHostPort(host, fmt.Sprint(port)), Config: c.config})
	conn, err := sshutil.DialRoute(ctx, route)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	return c.attach(conn)
}

// NewSession 创建新会话
func (c *Client) NewSession(ctx context.Context) (*ssh.Session, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	conn := c.GetRawConnection()
	if conn == nil {
		return nil, fmt.Errorf("client not connected")
	}

	done := make(chan struct{})
	stop := context.AfterFunc(ctx, func() { defer close(done); _ = conn.Close() })
	session, err := conn.NewSession()
	if !stop() {
		<-done
	}
	if ctx.Err() != nil {
		if session != nil {
			_ = session.Close()
		}
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	return session, nil
}

// MeasureTransportLatency measures the SSH transport round trip without
// starting a remote shell command. Unsupported keepalive requests still
// require a server reply, so they are useful as a low-overhead RTT probe.
func (c *Client) MeasureTransportLatency() (time.Duration, error) {
	conn := c.GetRawConnection()
	if conn == nil {
		return 0, fmt.Errorf("client not connected")
	}

	start := time.Now()
	_, _, err := conn.SendRequest("keepalive@openssh.com", true, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to measure ssh latency: %w", err)
	}

	return time.Since(start), nil
}

// Close 关闭连接
func (c *Client) Close() error {
	c.mu.Lock()
	c.closed = true
	conn := c.conn
	c.conn = nil
	c.connected = false
	c.mu.Unlock()
	if conn != nil {
		return conn.Close()
	}
	return nil
}
func (c *Client) attach(conn *ssh.Client) error {
	c.mu.Lock()
	if c.closed || c.conn != nil {
		c.mu.Unlock()
		_ = conn.Close()
		return errors.New("SSH client is closed or already connected")
	}
	c.conn = conn
	c.connected = true
	c.mu.Unlock()
	return nil
}
func (c *Client) IsConnected() bool { return c.GetRawConnection() != nil }

// GetServerID 获取服务器 ID
func (c *Client) GetServerID() string {
	return c.serverID
}

// GetUptime 获取连接持续时间
func (c *Client) GetUptime() time.Duration {
	return time.Since(c.createdAt)
}

// ExecuteCommand 执行命令
func (c *Client) ExecuteCommand(ctx context.Context, cmd string) (string, error) {
	result, err := c.ExecuteCommandDetailedContext(ctx, cmd)
	if result == nil {
		return "", err
	}
	return result.Output, err
}

func (c *Client) ExecuteCommandDetailedContext(ctx context.Context, cmd string) (*CommandResult, error) {
	session, err := c.NewSession(ctx)
	if err != nil {
		return nil, err
	}
	defer sshutil.CloseSession(session, c.GetRawConnection())
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	started := time.Now().UTC()
	output := aiworkspace.NewOutput(ctx)
	session.Stdout, session.Stderr = output, output
	done := make(chan error, 1)
	go func() {
		err := session.Run(cmd)
		output.Flush()
		done <- err
	}()
	var runErr error
	canceled := false
	select {
	case runErr = <-done:
	case <-ctx.Done():
		canceled = true
		runErr = c.stopRemote(session, done)
	}
	result := sshCommandResult(cmd, []byte(output.String()), runErr, started, time.Now().UTC())
	var exit *ssh.ExitError
	if canceled && errors.As(runErr, &exit) && (exit.Signal() == string(ssh.SIGTERM) || exit.Signal() == string(ssh.SIGKILL)) {
		// Confirmed stopped by our signal; effects produced before it remain.
		result.Outcome, result.Error = "canceled", "command canceled; remote process ended by SIG"+exit.Signal()
		return result, errors.Join(ctx.Err(), runErr)
	}
	if result.Outcome == "unknown" {
		return result, errors.Join(sshutil.ErrCommandOutcomeUnknown, runErr)
	}
	return result, runErr
}

// A command without a PTY receives no SIGHUP when the connection drops, so
// closing alone may leave it running. Signal the session's process group first;
// closing an unresponsive transport leaves the remote outcome unknown.
func (c *Client) stopRemote(session *ssh.Session, done <-chan error) error {
	// Signal itself writes to the transport and can block. Bound that write as
	// well as the exit wait, then join an already-started close before returning.
	closed := make(chan struct{})
	timer := time.AfterFunc(3*time.Second, func() { defer close(closed); _ = c.Close() })
	defer func() {
		if !timer.Stop() {
			<-closed
		}
	}()
	for _, step := range []struct {
		signal ssh.Signal
		wait   time.Duration
	}{{ssh.SIGTERM, 2 * time.Second}, {ssh.SIGKILL, time.Second}} {
		_ = session.Signal(step.signal)
		select {
		case err := <-done:
			return err
		case <-time.After(step.wait):
		}
	}
	_ = c.Close()
	return <-done
}

func sshCommandResult(cmd string, output []byte, err error, started time.Time, completed time.Time) *CommandResult {
	outcome, exitCode, message := sshutil.CommandOutcome(err)
	return &CommandResult{
		Command: cmd, Output: strings.TrimRight(strings.ReplaceAll(string(output), "\r\n", "\n"), "\n"),
		Outcome: outcome, ExitCode: exitCode, Error: message,
		DurationMs: completed.Sub(started).Milliseconds(), StartedAt: started, CompletedAt: completed,
	}
}

var osDetectionCommands = []string{
	`sh -c 'os=$(awk -F= '"'"'/^PRETTY_NAME=/ { gsub(/^"|"$/, "", $2); print $2; exit }'"'"' /etc/os-release 2>/dev/null); if [ -n "$os" ]; then printf "%s\n" "$os"; elif command -v sw_vers >/dev/null 2>&1; then printf "%s %s\n" "$(sw_vers -productName)" "$(sw_vers -productVersion)"; else uname -s 2>/dev/null; fi'`,
	`powershell -NoProfile -NonInteractive -Command "$os = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption; if (-not $os) { $os = (Get-WmiObject Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption }; if ($os) { [Console]::Out.WriteLine($os) }"`,
	`cmd /C ver`,
}

func (c *Client) DetectOS(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var lastErr error
	for _, command := range osDetectionCommands {
		output, err := c.ExecuteCommand(ctx, command)
		osValue := strings.TrimSpace(output)
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

// GetRawConnection 获取原始 SSH 连接（用于 SFTP）
func (c *Client) GetRawConnection() *ssh.Client {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.conn
}
