package middleware

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"

	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/server/internal/infra/config"
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
	trusted := false
	for _, raw := range cfg.TrustedProxyList() {
		if prefix, err := netip.ParsePrefix(raw); err == nil && prefix.Contains(ip) {
			trusted = true
			break
		}
		if other, err := netip.ParseAddr(raw); err == nil && other == ip {
			trusted = true
			break
		}
	}
	if !trusted {
		return false
	}
	proto := strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-Proto"), ",")[0])
	return strings.EqualFold(proto, "https")
}
func OwnerBrowserOrigin(cfg *config.Config, service security.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		method := c.Request.Method
		if method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions {
			c.Next()
			return
		}
		_, cookieErr := c.Cookie(OwnerCookieName)
		ownerEndpoint := strings.HasPrefix(c.Request.URL.Path, "/api/v1/owner/")
		visitor := c.GetHeader("X-EasySSH-Access-Session") != "" || strings.HasPrefix(c.GetHeader("Authorization"), "Access ")
		if !ownerEndpoint && (cookieErr != nil || visitor) {
			c.Next()
			return
		}
		origin := c.GetHeader("Origin")
		parsed, err := url.Parse(origin)
		if err != nil || parsed.User != nil || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "invalid_origin"})
			return
		}
		scheme := "http"
		if RequestUsesHTTPS(c, service) {
			scheme = "https"
		}
		allowed := origin == scheme+"://"+c.Request.Host
		if policy := requestSecurityConfig(c, service); policy != nil {
			for _, value := range policy.CSRFTrustedOriginList() {
				allowed = allowed || origin == strings.TrimRight(value, "/")
			}
		}
		if cfg.Server.Env != "production" {
			allowed = allowed || origin == fmt.Sprintf("http://localhost:%d", cfg.Server.WebDevPort) || origin == fmt.Sprintf("http://127.0.0.1:%d", cfg.Server.WebDevPort)
		}
		if !allowed {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "invalid_origin"})
			return
		}
		c.Next()
	}
}
