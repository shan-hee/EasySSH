package ws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/server/internal/domain/server"
	sftpDomain "github.com/easyssh/server/internal/domain/sftp"
	sshDomain "github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/server/internal/domain/sshhostkey"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

const sftpAuthInitTimeout = 5 * time.Minute

// SFTPAuthHandler handles interactive SFTP pre-authentication over WebSocket.
type SFTPAuthHandler struct {
	pool            *sftpDomain.Pool
	serverService   server.Service
	securityService security.Service
	hostKeyService  *sshhostkey.Service
	webDevPort      int
}

type sftpAuthRequest struct {
	AuthMethod           server.AuthMethod `json:"auth_method,omitempty"`
	Password             string            `json:"password,omitempty"`
	PrivateKey           string            `json:"private_key,omitempty"`
	Secret               string            `json:"secret,omitempty"`
	PrivateKeyPassphrase string            `json:"private_key_passphrase,omitempty"`
}

// NewSFTPAuthHandler creates an interactive SFTP authentication handler.
func NewSFTPAuthHandler(pool *sftpDomain.Pool, serverService server.Service, securityService security.Service, hostKeyService *sshhostkey.Service, webDevPort int) *SFTPAuthHandler {
	if webDevPort <= 0 {
		webDevPort = 3000
	}
	return &SFTPAuthHandler{
		pool:            pool,
		serverService:   serverService,
		securityService: securityService,
		hostKeyService:  hostKeyService,
		webDevPort:      webDevPort,
	}
}

func (h *SFTPAuthHandler) getUpgrader() websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			allowed := middleware.IsAllowedOrigin(r, h.securityService, h.webDevPort)
			if !allowed {
				log.Printf("[SFTPAuthWS] connection rejected: origin %s not allowed (host=%s)", r.Header.Get("Origin"), r.Host)
			}
			return allowed
		},
	}
}

// HandleAuthWebSocket pre-authenticates SFTP with interactive SSH challenges.
// WS /api/v1/sftp/:server_id/auth/ws
func (h *SFTPAuthHandler) HandleAuthWebSocket(c *gin.Context) {
	userIDStr, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, err := uuid.Parse(userIDStr.(string))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}
	serverID, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_server_id"})
		return
	}

	upgrader := h.getUpgrader()
	wsConn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[SFTPAuthWS] upgrade failed: %v", err)
		return
	}
	defer wsConn.Close()
	wsConn.SetReadLimit(512 << 10)

	var writeMu sync.Mutex
	safeWriteJSON := func(v interface{}) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return wsConn.WriteJSON(v)
	}

	writeStatus := func(status string) {
		payload, _ := json.Marshal(map[string]string{"status": status})
		if err := safeWriteJSON(Message{Type: "status", Data: payload}); err != nil {
			log.Printf("[SFTPAuthWS] failed to send status: %v", err)
		}
	}
	writeError := func(code string, err error) {
		payload, _ := json.Marshal(map[string]string{
			"error":   code,
			"message": err.Error(),
		})
		if writeErr := safeWriteJSON(Message{Type: "error", Data: payload}); writeErr != nil {
			log.Printf("[SFTPAuthWS] failed to send error: %v", writeErr)
		}
	}

	if h.pool == nil || h.serverService == nil {
		writeError("sftp_auth_unavailable", fmt.Errorf("sftp auth service is not available"))
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), sftpAuthInitTimeout)
	defer cancel()

	srv, err := h.serverService.GetByID(ctx, userID, serverID)
	if err != nil {
		writeError("server_not_found", err)
		return
	}

	writeStatus("authenticating")
	req, err := h.readInitialAuthRequest(wsConn, safeWriteJSON)
	if err != nil {
		writeError("sftp_auth_request_failed", err)
		return
	}

	credential := sftpDomain.Credential{
		AuthMethod:           req.AuthMethod,
		Secret:               req.Secret,
		Password:             req.Password,
		PrivateKey:           req.PrivateKey,
		PrivateKeyPassphrase: req.PrivateKeyPassphrase,
	}
	if credential.AuthMethod == "" {
		credential.AuthMethod = srv.AuthMethod
	}
	if credential.AuthMethod == "" || !credential.AuthMethod.IsValid() {
		writeError("unsupported_auth_method", fmt.Errorf("unsupported auth method: %s", credential.AuthMethod))
		return
	}

	client, err := h.pool.GetWithCredential(
		ctx,
		userID,
		serverID,
		credential,
		sshDomain.WithKeyboardInteractive(newTerminalKeyboardInteractiveChallenge(wsConn, safeWriteJSON)),
		sshDomain.WithHostKeyCallback(h.hostKeyCallback(wsConn, safeWriteJSON)),
	)
	if err != nil {
		code, message := classifySFTPAuthWebSocketError(err)
		writeError(code, errors.New(message))
		return
	}
	client.Release()

	payload, _ := json.Marshal(map[string]string{"status": "authenticated"})
	if err := safeWriteJSON(Message{Type: "authenticated", Data: payload}); err != nil {
		log.Printf("[SFTPAuthWS] failed to send authenticated: %v", err)
	}
}

func classifySFTPAuthWebSocketError(err error) (string, string) {
	if err == nil {
		return "sftp_auth_failed", ""
	}

	raw := err.Error()
	message := strings.ToLower(raw)
	var hostKeyErr *sshhostkey.HostKeyVerificationError
	switch {
	case errors.As(err, &hostKeyErr):
		return "sftp_host_key_changed", raw
	case errors.Is(err, sshhostkey.ErrHostKeyRevoked):
		return "host_key_revoked", raw
	case strings.Contains(message, "host key verification failed"):
		return "sftp_host_key_changed", raw
	case strings.Contains(message, "host key trust has been revoked"):
		return "host_key_revoked", raw
	case strings.Contains(message, "auth_cancelled") ||
		strings.Contains(message, "authentication cancelled"):
		return "auth_cancelled", "Authentication cancelled"
	case strings.Contains(message, "private_key_passphrase_required"):
		return "sftp_private_key_passphrase_required", raw
	case strings.Contains(message, "private_key_passphrase_invalid"):
		return "sftp_private_key_passphrase_invalid", raw
	case strings.Contains(message, "keyboard_interactive_required"):
		return "keyboard_interactive_required", raw
	case isTerminalSSHAuthError(err):
		return "sftp_credential_required", raw
	default:
		return "sftp_auth_failed", raw
	}
}

func (h *SFTPAuthHandler) hostKeyCallback(conn *websocket.Conn, writeJSON func(interface{}) error) ssh.HostKeyCallback {
	if h.hostKeyService == nil {
		return nil
	}

	return h.hostKeyService.GetTrustOnChangeHostKeyCallback(
		func(details *sshhostkey.HostKeyVerificationError) (bool, error) {
			return newTerminalHostKeyPrompt(conn, writeJSON, details)
		},
	)
}

func (h *SFTPAuthHandler) readInitialAuthRequest(conn *websocket.Conn, writeJSON func(interface{}) error) (sftpAuthRequest, error) {
	defer func() {
		_ = conn.SetReadDeadline(time.Time{})
	}()

	for {
		if err := conn.SetReadDeadline(time.Now().Add(terminalSSHAuthChallengeTimeout)); err != nil {
			return sftpAuthRequest{}, fmt.Errorf("failed to set authentication request timeout: %w", err)
		}

		messageType, message, err := conn.ReadMessage()
		if err != nil {
			return sftpAuthRequest{}, fmt.Errorf("failed to read authentication request: %w", err)
		}
		if messageType != websocket.TextMessage {
			continue
		}

		var msg Message
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("[SFTPAuthWS] failed to parse message: %v", err)
			continue
		}
		if msg.Type == "ping" {
			writeTerminalPong(writeJSON, msg.Data)
			continue
		}
		if msg.Type != "auth_start" {
			continue
		}

		var req sftpAuthRequest
		if len(msg.Data) > 0 {
			if err := json.Unmarshal(msg.Data, &req); err != nil {
				return sftpAuthRequest{}, fmt.Errorf("failed to parse authentication request: %w", err)
			}
		}
		return req, nil
	}
}
