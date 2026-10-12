package ws

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"sync"
	"time"

	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"gorm.io/gorm"
)

const relayChunkSize = 32 << 10

// SSHRelayHandler only reads routing metadata. It deliberately has no encryptor,
// credential store, SSH client, terminal parser, or file-system API.
type SSHRelayHandler struct {
	db       *gorm.DB
	security security.Service
	webPort  int
	networks []netip.Prefix
	ports    map[int]bool
	mu       sync.Mutex
	active   map[string]int
	total    int
}

func NewSSHRelayHandler(db *gorm.DB, securityService security.Service, webPort int, networks []netip.Prefix, ports []int) *SSHRelayHandler {
	h := &SSHRelayHandler{db: db, security: securityService, webPort: webPort, networks: networks, ports: make(map[int]bool), active: make(map[string]int)}
	for _, port := range ports {
		h.ports[port] = true
	}
	return h
}

func (h *SSHRelayHandler) acquire(owner string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.total >= 128 || h.active[owner] >= 8 {
		return false
	}
	h.total++
	h.active[owner]++
	return true
}

func (h *SSHRelayHandler) release(owner string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.total--
	h.active[owner]--
	if h.active[owner] == 0 {
		delete(h.active, owner)
	}
}

func (h *SSHRelayHandler) allowed(address netip.Addr) bool {
	address = address.Unmap()
	if address.IsUnspecified() || address.IsMulticast() || address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() {
		return false
	}
	for _, network := range h.networks {
		if network.Contains(address) {
			return true
		}
	}
	return false
}

// dial resolves once, checks each numeric address, then dials that exact address.
// A second DNS lookup must not bypass the deployment's network policy.
func (h *SSHRelayHandler) dial(ctx context.Context, host string, port int) (net.Conn, error) {
	if !h.ports[port] || len(h.networks) == 0 {
		return nil, errors.New("relay target is not permitted")
	}
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	for _, address := range addresses {
		if !h.allowed(address) {
			continue
		}
		dialer := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
		conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(address.Unmap().String(), strconv.Itoa(port)))
		if err == nil {
			return conn, nil
		}
	}
	return nil, errors.New("no permitted relay address is reachable")
}

func (h *SSHRelayHandler) Handle(c *gin.Context) {
	if !websocket.IsWebSocketUpgrade(c.Request) {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "websocket_required"})
		return
	}
	// This transport is intentionally ticket-only, even though the shared auth
	// middleware also supports bearer tokens on ordinary HTTP routes.
	if _, ok := c.Get("auth_ticket"); !ok {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "relay_ticket_required"})
		return
	}
	if !middleware.IsAllowedOrigin(c.Request, h.security, h.webPort) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "relay_origin_denied"})
		return
	}
	owner := c.GetString("user_id")
	id, err := uuid.Parse(c.Param("server_id"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_server_id"})
		return
	}
	// Never load password/private_key columns or SSHKey associations.
	var target struct {
		Host string
		Port int
	}
	if err := h.db.WithContext(c.Request.Context()).Table("relay_routes").Select("host", "port").Where("id = ? AND user_id = ?", id, owner).Take(&target).Error; err != nil {
		c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "relay_target_unavailable"})
		return
	}
	if !h.acquire(owner) {
		c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "relay_connection_limit"})
		return
	}
	defer h.release(owner)
	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()
	dialCtx, dialCancel := context.WithTimeout(ctx, 15*time.Second)
	stream, err := h.dial(dialCtx, target.Host, target.Port)
	dialCancel()
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadGateway, gin.H{"error": "relay_target_unavailable"})
		return
	}
	defer stream.Close()
	upgrader := websocket.Upgrader{ReadBufferSize: relayChunkSize, WriteBufferSize: relayChunkSize, CheckOrigin: func(r *http.Request) bool {
		return middleware.IsAllowedOrigin(r, h.security, h.webPort)
	}}
	socket, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer socket.Close()
	socket.SetReadLimit(256 << 10)
	stop := context.AfterFunc(ctx, func() { stream.Close(); socket.Close() })
	defer stop()
	finished := make(chan struct{}, 2)
	// The two pumps apply bounded buffers and per-direction bandwidth limits.
	go func() {
		defer func() { finished <- struct{}{} }()
		var nextWrite time.Time
		buffer := make([]byte, relayChunkSize)
		for {
			_ = stream.SetReadDeadline(time.Now().Add(2 * time.Minute))
			n, readErr := stream.Read(buffer)
			if n > 0 {
				if relayThrottle(ctx, &nextWrite, n) != nil {
					return
				}
				_ = socket.SetWriteDeadline(time.Now().Add(30 * time.Second))
				if socket.WriteMessage(websocket.BinaryMessage, buffer[:n]) != nil {
					return
				}
			}
			if readErr != nil {
				return
			}
		}
	}()
	go func() {
		defer func() { finished <- struct{}{} }()
		var nextWrite time.Time
		buffer := make([]byte, relayChunkSize)
		for {
			_ = socket.SetReadDeadline(time.Now().Add(2 * time.Minute))
			kind, reader, err := socket.NextReader()
			if err != nil || kind != websocket.BinaryMessage {
				return
			}
			for {
				n, readErr := reader.Read(buffer)
				if n > 0 {
					if relayThrottle(ctx, &nextWrite, n) != nil {
						return
					}
					_ = stream.SetWriteDeadline(time.Now().Add(30 * time.Second))
					if _, err := io.Copy(stream, bytes.NewReader(buffer[:n])); err != nil {
						return
					}
				}
				if readErr == io.EOF {
					break
				}
				if readErr != nil {
					return
				}
			}
		}
	}()
	<-finished
	cancel()
	stream.Close()
	socket.Close()
	<-finished
}

// Each pump has its own clock; at most one 32 KiB chunk is sent per budget slot.
func relayThrottle(ctx context.Context, next *time.Time, size int) error {
	if delay := time.Until(*next); delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	*next = time.Now().Add(time.Duration(size) * time.Second / (8 << 20))
	return ctx.Err()
}
