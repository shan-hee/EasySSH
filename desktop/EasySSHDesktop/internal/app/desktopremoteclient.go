package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/easyssh/easyssh-desktop/internal/accesslink"
	"github.com/google/uuid"
)

const desktopRemoteResponseLimit = 8 << 20

type desktopRemoteError struct{ code string }

func (e *desktopRemoteError) Error() string { return e.code }
func remoteError(code string) error         { return &desktopRemoteError{code} }

func normalizeRemoteOrigin(raw string) (string, error) {
	origin, err := accesslink.NormalizeOrigin(raw)
	if err != nil {
		return "", remoteError(err.Error())
	}
	return origin, nil
}

type desktopShareLink struct{ origin, publicID, secret string }

func parseDesktopShareLink(raw string) (desktopShareLink, error) {
	if len(raw) > 4096 {
		return desktopShareLink{}, remoteError("invalid_share_link")
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Opaque != "" {
		return desktopShareLink{}, remoteError("invalid_share_link")
	}
	origin, err := normalizeRemoteOrigin(u.Scheme + "://" + u.Host)
	if err != nil {
		return desktopShareLink{}, err
	}
	id := strings.TrimPrefix(u.Path, "/share/")
	parsed, err := uuid.Parse(id)
	secret, secretErr := base64.RawURLEncoding.DecodeString(u.Fragment)
	if u.RawPath != "" || !strings.HasPrefix(u.Path, "/share/") || err != nil || parsed == uuid.Nil || parsed.String() != id || secretErr != nil || len(secret) != 32 {
		return desktopShareLink{}, remoteError("invalid_share_link")
	}
	return desktopShareLink{origin, id, u.Fragment}, nil
}

// desktopRemoteClient has no exported arbitrary-URL API. All paths below are
// fixed by Go; credentials remain tied to exactly one origin and session.
type desktopRemoteClient struct {
	origin     string
	token      string
	sessionID  string
	grantID    string
	http       *http.Client
	streamHTTP *http.Client
	fileHTTP   *http.Client
	slots      chan struct{}
}

func newDesktopRemoteClient(origin string) (*desktopRemoteClient, error) {
	canonical, err := normalizeRemoteOrigin(origin)
	if err != nil {
		return nil, err
	}
	transport := desktopHTTPTransportTemplate.Clone()
	transport.Proxy = func(req *http.Request) (*url.URL, error) {
		current := desktopHTTPProxy.current.Load()
		if current == nil {
			return nil, remoteError("proxy_unavailable")
		}
		if current.Proxy == nil {
			return nil, nil
		}
		return current.Proxy(req)
	}
	transport.MaxConnsPerHost = 8
	transport.MaxResponseHeaderBytes = 64 << 10
	transport.ResponseHeaderTimeout = 20 * time.Second
	streamTransport := transport.Clone()
	streamTransport.MaxConnsPerHost = remoteStreamCountLimit
	fileTransport := transport.Clone()
	fileTransport.MaxConnsPerHost = remoteFileActiveLimit
	return &desktopRemoteClient{
		fileHTTP:   &http.Client{Transport: fileTransport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		streamHTTP: &http.Client{Transport: streamTransport, Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
		origin:     canonical, slots: make(chan struct{}, 8),
		http: &http.Client{Transport: transport, Timeout: 30 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }},
	}, nil
}

type desktopRemoteRequestOptions struct {
	timeout       time.Duration
	query         url.Values
	connectionID  string
	requestLimit  int
	responseLimit int
	rawResponse   bool
}

func (c *desktopRemoteClient) request(ctx context.Context, method, path string, body, output any, authenticated bool) error {
	return c.requestWithOptions(ctx, method, path, body, output, authenticated, desktopRemoteRequestOptions{})
}

// Options are chosen by typed Go methods, never supplied by the renderer.
func (c *desktopRemoteClient) requestWithOptions(ctx context.Context, method, path string, body, output any, authenticated bool, options desktopRemoteRequestOptions) error {
	if options.requestLimit == 0 {
		options.requestLimit = 2 << 20
	}
	if options.responseLimit == 0 {
		options.responseLimit = desktopRemoteResponseLimit
	}
	if options.connectionID != "" && !protocol.ValidConnectionID(options.connectionID) {
		return remoteError("invalid_connection_id")
	}

	select {
	case c.slots <- struct{}{}:
		defer func() { <-c.slots }()
	case <-ctx.Done():
		return ctx.Err()
	}
	if !validRemoteAPIPath(path) {
		return remoteError("invalid_remote_path")
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil || len(encoded) > options.requestLimit {
			return remoteError("invalid_request")
		}
		reader = bytes.NewReader(encoded)
	}
	endpoint := c.origin + path
	if len(options.query) > 0 {
		endpoint += "?" + options.query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return remoteError("invalid_request")
	}
	req.Header.Set("Accept", "application/json")
	if options.rawResponse {
		req.Header.Set("Accept", "text/plain")
	}
	if options.connectionID != "" {
		req.Header.Set("X-EasySSH-Connection", options.connectionID)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authenticated {
		if c.token == "" || c.sessionID == "" {
			return remoteError("reauthorization_required")
		}
		req.Header.Set("Authorization", "Access "+c.token)
		req.Header.Set("X-EasySSH-Access-Session", c.sessionID)
	}
	client := c.http
	if options.timeout > 0 {
		copy := *c.http
		copy.Timeout = options.timeout
		client = &copy
	}
	response, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return remoteError("remote_unavailable") // never return URLs, tokens or response text
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		return remoteError("remote_redirect_rejected")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, int64(options.responseLimit)+1))
	if err != nil || len(data) > options.responseLimit {
		return remoteError("invalid_remote_response")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return remoteResponseError(data)
	}
	if options.rawResponse {
		target, ok := output.(*[]byte)
		if !ok {
			return remoteError("invalid_request")
		}
		*target = data
		return nil
	}
	if output == nil {
		if len(bytes.TrimSpace(data)) != 0 {
			return remoteError("invalid_remote_response")
		}
		return nil
	}
	if err := json.Unmarshal(data, output); err != nil {
		return remoteError("invalid_remote_response")
	}
	return nil
}

func validRemoteAPIPath(path string) bool {
	if !strings.HasPrefix(path, "/api/v1/") || strings.ContainsAny(path, "?#\\") {
		return false
	}
	for _, part := range strings.Split(path, "/") {
		decoded, err := url.PathUnescape(part)
		if err != nil || decoded == "." || decoded == ".." || strings.ContainsAny(decoded, "/\\") {
			return false
		}
	}
	return true
}

func validateRemoteContext(value protocol.AccessContext) error {
	if value.ProtocolVersion != protocol.AccessVersion {
		return remoteError("protocol_mismatch")
	}
	if value.Actor.Kind != protocol.Visitor || !value.Actor.Valid() ||
		!validRemoteUUID(value.Actor.ID) || !validRemoteUUID(value.Actor.GrantID) ||
		!value.ExpiresAt.After(time.Now()) || value.MaxConnections < 1 || value.MaxConnections > desktopRemoteMaxConnections ||
		len(value.Resources) > 2000 || !remoteText(value.GrantName, 512) {
		return remoteError("invalid_remote_response")
	}
	switch value.DefaultContent {
	case "terminal", "files", "monitor", "docker":
	default:
		return remoteError("invalid_remote_response")
	}
	seen := make(map[uuid.UUID]bool, len(value.Resources))
	for _, resource := range value.Resources {
		if resource.ID == uuid.Nil || seen[resource.ID] || !remoteText(resource.Name, 512) ||
			!remoteText(resource.Host, 1024) || !remoteText(resource.Username, 512) ||
			(!resource.Paused && (resource.Port < 1 || resource.Port > 65535)) || len(resource.Actions) > 32 {
			return remoteError("invalid_remote_response")
		}
		seen[resource.ID] = true
		for _, action := range resource.Actions {
			if !action.Shareable() {
				return remoteError("invalid_remote_response")
			}
		}
	}
	return nil
}

func validRemoteUUID(raw string) bool {
	id, err := uuid.Parse(raw)
	return err == nil && id != uuid.Nil && id.String() == raw
}
func remoteText(raw string, max int) bool {
	return len(raw) <= max && strings.IndexFunc(raw, unicode.IsControl) < 0
}

func (c *desktopRemoteClient) acceptExchange(value protocol.DesktopAccessExchange) error {
	if err := validateRemoteContext(value.Context); err != nil {
		return err
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value.SessionToken)
	if err != nil || len(decoded) != 32 {
		return remoteError("invalid_remote_response")
	}
	c.token, c.sessionID, c.grantID = value.SessionToken, value.Context.Actor.SessionID, value.Context.Actor.GrantID
	return nil
}

func (c *desktopRemoteClient) exchange(ctx context.Context, link desktopShareLink) (protocol.AccessContext, error) {
	if c.origin != link.origin {
		return protocol.AccessContext{}, remoteError("origin_mismatch")
	}
	var result protocol.DesktopAccessExchange
	err := c.request(ctx, http.MethodPost, "/api/v1/access/exchanges", protocol.AccessExchangeInput{
		PublicID: link.publicID, Secret: link.secret, ClientKind: "desktop", ProtocolMin: int(protocol.AccessVersion), ProtocolMax: int(protocol.AccessVersion),
	}, &result, c.token != "")
	if err != nil {
		return protocol.AccessContext{}, err
	}
	if err := c.acceptExchange(result); err != nil {
		return protocol.AccessContext{}, err
	}
	return result.Context, nil
}

func (c *desktopRemoteClient) currentContext(ctx context.Context) (protocol.AccessContext, error) {
	var result protocol.AccessContext
	if err := c.request(ctx, http.MethodGet, "/api/v1/access/context", nil, &result, true); err != nil {
		return result, err
	}
	if err := validateRemoteContext(result); err != nil {
		return protocol.AccessContext{}, err
	}
	if result.Actor.SessionID != c.sessionID || result.Actor.GrantID != c.grantID {
		return protocol.AccessContext{}, remoteError("remote_identity_changed")
	}
	return result, nil
}

func (c *desktopRemoteClient) endSession(ctx context.Context) error {
	if !validRemoteUUID(c.sessionID) {
		return remoteError("reauthorization_required")
	}
	return c.request(ctx, http.MethodDelete, "/api/v1/access/sessions/"+c.sessionID, nil, nil, true)
}

func (c *desktopRemoteClient) close() {
	c.http.CloseIdleConnections()
	c.streamHTTP.CloseIdleConnections()
	if c.fileHTTP != nil {
		c.fileHTTP.CloseIdleConnections()
	}
}

func isRemoteAccessEnded(err error) bool {
	var remote *desktopRemoteError
	return errors.As(err, &remote) && (remote.code == "invalid_access" || remote.code == "access_ended")
}

func remoteResponseError(data []byte) error {
	var problem struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(data, &problem)
	switch problem.Error {
	case "storage_unavailable", "ai_search_too_long", "ai_runtime_stopped", "ai_snapshot_conflict", "server_reference_unavailable", "session_not_found", "message_not_found", "session_conflict", "ai_history_limit", "validation_error",
		"task_run_not_found", "record_not_found", "script_not_found", "invalid_script", "invalid_batch_task", "invalid_task_event_query", "invalid_activity_query", "invalid_activity_window",
		"invalid_docker_operation", "docker_stopped", "task_not_found", "invalid_task_id", "invalid_docker_reference", "docker_error", "protocol_mismatch", "invalid_access", "access_ended", "forbidden", "resource_paused",
		"access_denied", "capacity_reached", "quota_exhausted", "state_changed", "not_found", "connection_unavailable",
		"directory_not_found", "directory_permission_denied", "file_not_found", "file_too_large", "content_too_large",
		"not_a_file", "invalid_path", "invalid_mode", "directory_delete_requires_delete_paths",
		"sftp_credential_required", "sftp_host_key_changed", "host_key_revoked", "keyboard_interactive_required",
		"sftp_private_key_passphrase_required", "sftp_private_key_passphrase_invalid", "sftp_connection_error",
		"invalid_task_content_query", "task_content_changed", "invalid_content_range", "content_changed", "content_not_ready", "content_not_found", "delete_unavailable",
		"invalid_upload", "upload_unavailable", "upload_failed", "upload_record_failed", "download_failed":
		return remoteError(problem.Error)
	default:
		return remoteError("remote_request_failed")
	}
}
