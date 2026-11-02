package middleware

import (
	"mime"
	"net"
	"net/http"
	"net/netip"
	"strings"

	"github.com/easyssh/server/internal/domain/security"
	"github.com/gin-gonic/gin"
)

const CSRFTokenHeader = "X-CSRF-Token"

func requestSecurityConfig(c *gin.Context, service security.Service) *security.SecurityConfig {
	if cached, ok := GetSecurityConfigFromContext(c); ok {
		return cached
	}
	if service == nil {
		return nil
	}
	value, _ := service.Get(c.Request.Context())
	return value
}

// Forwarded scheme is accepted only from an explicitly trusted network peer.
func RequestUsesHTTPS(c *gin.Context, service security.Service) bool {
	if c.Request.TLS != nil {
		return true
	}
	if !requestFromTrustedProxy(c, service) {
		return false
	}
	proto := strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-Proto"), ",")[0])
	return strings.EqualFold(proto, "https")
}

func requestFromTrustedProxy(c *gin.Context, service security.Service) bool {
	peer, _, err := net.SplitHostPort(c.Request.RemoteAddr)
	if err != nil {
		return false
	}
	ip, err := netip.ParseAddr(peer)
	if err != nil {
		return false
	}
	cfg := requestSecurityConfig(c, service)
	if cfg == nil {
		return false
	}
	for _, raw := range cfg.TrustedProxyList() {
		if prefix, err := netip.ParsePrefix(raw); err == nil && prefix.Contains(ip) {
			return true
		}
		if other, err := netip.ParseAddr(raw); err == nil && other == ip {
			return true
		}
	}
	return false
}

// RequireJSONBody prevents unauthenticated browser writes from using a simple
// cross-origin form request. Cross-origin JSON requests must pass CORS preflight.
func RequireJSONBody() gin.HandlerFunc {
	return func(c *gin.Context) {
		mediaType, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || mediaType != "application/json" {
			c.AbortWithStatusJSON(http.StatusUnsupportedMediaType, gin.H{"error": "unsupported_media_type", "message": "Content-Type must be application/json"})
			return
		}
		c.Next()
	}
}
