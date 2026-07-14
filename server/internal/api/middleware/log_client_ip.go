package middleware

import (
	"net/netip"
	"strings"

	"github.com/gin-gonic/gin"
)

const maxForwardedIPEntries = 32

// LogClientIP 返回用于请求日志和审计记录展示的客户端 IP。
//
// 该函数会优先采用反向代理传入的合法 IP，因此代理头仍可能被伪造。
// 访问控制、IP 白名单和限流必须继续使用 Gin 的 c.ClientIP()。
func LogClientIP(c *gin.Context) string {
	if c == nil || c.Request == nil {
		return ""
	}

	// 单层 Nginx 通常会用 $remote_addr 覆盖 X-Real-IP，优先采用该值。
	if ip := normalizeLogIPAddress(c.GetHeader("X-Real-IP")); ip != "" {
		return ip
	}

	// 兼容常见代理的处理方式，选择转发链中第一个合法 IP。
	if ip := firstValidForwardedIP(c.GetHeader("X-Forwarded-For")); ip != "" {
		return ip
	}

	clientIP := strings.TrimSpace(c.ClientIP())
	if ip := normalizeLogIPAddress(clientIP); ip != "" {
		return ip
	}

	return clientIP
}

func firstValidForwardedIP(value string) string {
	remaining := value
	for index := 0; index < maxForwardedIPEntries && remaining != ""; index++ {
		current, rest, found := strings.Cut(remaining, ",")
		if ip := normalizeLogIPAddress(current); ip != "" {
			return ip
		}
		if !found {
			break
		}
		remaining = rest
	}

	return ""
}

func normalizeLogIPAddress(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	if address, err := netip.ParseAddr(value); err == nil {
		return address.Unmap().String()
	}
	if addressPort, err := netip.ParseAddrPort(value); err == nil {
		return addressPort.Addr().Unmap().String()
	}

	return ""
}
