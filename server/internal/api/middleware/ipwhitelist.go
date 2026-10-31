package middleware

import (
	"net"
	"net/http"
	"strings"

	"github.com/easyssh/server/internal/domain/security"
	"github.com/gin-gonic/gin"
)

// OptionalIPWhitelistMiddleware 可选的 IP 白名单验证中间件
// 只有在配置了 IP 白名单时才进行验证
func OptionalIPWhitelistMiddleware(securityService security.Service) gin.HandlerFunc {
	return func(c *gin.Context) {

		ownerEndpoint := strings.HasPrefix(c.Request.URL.Path, "/api/v1/owner/")
		_, cookieErr := c.Cookie(OwnerCookieName)
		visitor := c.GetHeader("X-EasySSH-Access-Session") != "" || (strings.HasPrefix(c.GetHeader("Authorization"), "Access ") || strings.HasPrefix(c.GetHeader("Authorization"), "Bearer ess_api_")) || strings.HasPrefix(c.Request.URL.Path, "/api/v1/access/")
		if !ownerEndpoint && (cookieErr != nil || visitor) {
			c.Next()
			return
		}
		if !checkOwnerAddress(c, securityService) {
			return
		}
		c.Next()
	}
}

// IPWhitelistConfig IP 白名单配置
type IPWhitelistConfig struct {
	Enabled        bool     `json:"enabled"`
	AllowedIPs     []string `json:"allowed_ips"`
	BypassPaths    []string `json:"bypass_paths"`     // 跳过验证的路径
	AlwaysAllowIPs []string `json:"always_allow_ips"` // 始终允许的 IP（本地地址等）
}

// DefaultIPWhitelistConfig 默认的 IP 白名单配置
var DefaultIPWhitelistConfig = IPWhitelistConfig{
	Enabled:    false,
	AllowedIPs: []string{},
	BypassPaths: []string{
		"/api/v1/health",
		"/api/v1/ping",
	},
	AlwaysAllowIPs: []string{
		"127.0.0.1",      // IPv4 localhost
		"::1",            // IPv6 localhost
		"10.0.0.0/8",     // 私有网络 A
		"172.16.0.0/12",  // 私有网络 B
		"192.168.0.0/16", // 私有网络 C
	},
}

// IsPrivateIP 检查是否为私有 IP 地址
func IsPrivateIP(ip string) bool {
	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		return false
	}

	// IPv4 私有地址范围
	privateIPv4Ranges := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"127.0.0.0/8", // localhost
	}

	for _, cidr := range privateIPv4Ranges {
		if parsedIP.To4() != nil {
			_, network, err := net.ParseCIDR(cidr)
			if err != nil {
				continue
			}
			if network.Contains(parsedIP) {
				return true
			}
		}
	}

	// IPv6 私有地址范围
	if parsedIP.To4() == nil {
		// IPv6 localhost
		if parsedIP.IsLoopback() {
			return true
		}
		// IPv6 私有地址
		if parsedIP.IsPrivate() {
			return true
		}
	}

	return false
}

// Also used after owner ticket authentication, where no owner cookie is present.
func checkOwnerAddress(c *gin.Context, service security.Service) bool {
	ip := LogClientIP(c)
	c.Set("client_ip", ip)
	var allowed bool
	var err error
	if cfg, ok := GetSecurityConfigFromContext(c); ok {
		allowed = service.CheckIPAllowedWithConfig(cfg, ip)
	} else {
		allowed, err = service.CheckIPAllowed(c.Request.Context(), ip)
	}
	if err != nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "owner_access_policy_unavailable"})
		return false
	}
	if !allowed {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": "IP address not allowed"})
		return false
	}
	return true
}
