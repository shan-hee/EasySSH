package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/easyssh/server/internal/domain/security"
	"github.com/gin-gonic/gin"
)

// RequestOrigin resolves the external origin without trusting the Origin header.
// A trusted reverse proxy must overwrite forwarded headers from its clients.
func RequestOrigin(c *gin.Context, securityService security.Service) (string, error) {
	scheme := "http"
	if RequestUsesHTTPS(c, securityService) {
		scheme = "https"
	}
	host := c.Request.Host
	if requestFromTrustedProxy(c, securityService) {
		if forwarded := c.GetHeader("X-Forwarded-Host"); forwarded != "" {
			host = strings.TrimSpace(strings.Split(forwarded, ",")[0])
		}
	}
	u, err := url.Parse(scheme + "://" + host)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.ContainsAny(host, "/?#\\") {
		return "", fmt.Errorf("invalid request host")
	}
	u.Host = strings.ToLower(u.Host)
	if scheme == "https" && u.Port() == "443" || scheme == "http" && u.Port() == "80" {
		u.Host = strings.TrimSuffix(u.Host, ":"+u.Port())
	}
	return u.String(), nil
}

func IsAllowedOrigin(r *http.Request, securityService security.Service, webDevPort int) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}

	if isConfiguredOriginAllowed(origin, securityService, webDevPort) {
		return true
	}

	originURL, err := url.Parse(origin)
	if err != nil || originURL.Hostname() == "" {
		return false
	}

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return originURL.User == nil && originURL.RawQuery == "" && originURL.Fragment == "" && originURL.Path == "" && originURL.Scheme == scheme && strings.EqualFold(originURL.Host, r.Host)
}

func IsConfiguredOriginAllowed(origin string, securityService security.Service, webDevPort int) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return false
	}
	return isConfiguredOriginAllowed(origin, securityService, webDevPort)
}

func isConfiguredOriginAllowed(origin string, securityService security.Service, webDevPort int) bool {
	allowedOrigins := []string{
		fmt.Sprintf("http://localhost:%d", webDevPort),
	}

	if securityService != nil {
		corsConfig, err := securityService.GetCORSConfig(context.Background())
		if err == nil && corsConfig != nil {
			allowedOrigins = append(allowedOrigins, corsConfig.AllowedOrigins...)
		}
	}

	for _, allowedOrigin := range allowedOrigins {
		allowedOrigin = strings.TrimSpace(allowedOrigin)
		if allowedOrigin == "" {
			continue
		}
		if allowedOrigin == "*" {
			continue
		}
		if origin == allowedOrigin {
			return true
		}
	}
	return false
}

func requestHost(r *http.Request) string {
	if r == nil {
		return ""
	}
	host := r.Host
	if host == "" {
		return ""
	}
	if parsedHost, _, found := strings.Cut(host, ":"); found {
		return parsedHost
	}
	return host
}
