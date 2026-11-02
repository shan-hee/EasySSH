package rest

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/server/internal/infra/config"
	"github.com/gin-gonic/gin"
)

func TestVisitorOriginFollowsRequestAddress(t *testing.T) {
	for _, test := range []struct {
		name, target, origin, peer, forwardedHost, forwardedProto, fetchSite string
		wantStatus                                                           int
	}{
		{"first domain", "https://first.example/access", "https://first.example", "203.0.113.10:5000", "", "", "same-origin", http.StatusNoContent},
		{"second domain", "https://second.example/access", "https://second.example", "203.0.113.10:5000", "", "", "same-origin", http.StatusNoContent},
		{"local dev", "http://localhost:3000/access", "http://localhost:3000", "127.0.0.1:5000", "", "", "same-origin", http.StatusNoContent},
		{"trusted TLS proxy", "http://first.example/access", "https://first.example", "127.0.0.1:5000", "", "https", "same-origin", http.StatusNoContent},
		{"trusted rewritten host", "http://backend:8520/access", "https://first.example:8443", "127.0.0.1:5000", "first.example:8443", "https", "same-origin", http.StatusNoContent},
		{"default port", "https://first.example:443/access", "https://first.example", "203.0.113.10:5000", "", "", "same-origin", http.StatusNoContent},
		{"IPv6", "http://[::1]:8520/access", "http://[::1]:8520", "[::1]:5000", "", "", "same-origin", http.StatusNoContent},
		{"wrong domain", "https://first.example/access", "https://other.example", "203.0.113.10:5000", "", "", "same-origin", http.StatusForbidden},
		{"wrong port", "https://first.example:8443/access", "https://first.example", "203.0.113.10:5000", "", "", "same-origin", http.StatusForbidden},
		{"wrong scheme", "http://first.example/access", "https://first.example", "203.0.113.10:5000", "", "", "same-origin", http.StatusForbidden},
		{"untrusted forwarded scheme", "http://first.example/access", "https://first.example", "203.0.113.10:5000", "", "https", "same-origin", http.StatusForbidden},
		{"untrusted forwarded host", "http://backend:8520/access", "https://other.example", "203.0.113.10:5000", "other.example", "https", "same-origin", http.StatusForbidden},
		{"missing origin", "https://first.example/access", "", "203.0.113.10:5000", "", "", "same-origin", http.StatusForbidden},
		{"null origin", "https://first.example/access", "null", "203.0.113.10:5000", "", "", "same-origin", http.StatusForbidden},
		{"cross site", "https://first.example/access", "https://first.example", "203.0.113.10:5000", "", "", "cross-site", http.StatusForbidden},
		{"invalid forwarded host", "http://backend:8520/access", "https://first.example", "127.0.0.1:5000", "first.example/path", "https", "same-origin", http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set("security_config", &security.SecurityConfig{TrustedProxies: "127.0.0.1\n::1"})
				c.Next()
			})
			router.Use(middleware.CORS(&config.Config{Server: config.ServerConfig{WebDevPort: 3000}}, nil))
			handler := NewAccessHandler(nil, nil)
			router.POST("/access", func(c *gin.Context) {
				if _, ok := handler.browserOrigin(c); ok {
					c.Status(http.StatusNoContent)
				}
			})
			request := httptest.NewRequest(http.MethodPost, test.target, nil)
			request.RemoteAddr = test.peer
			request.Header.Set("Origin", test.origin)
			request.Header.Set("X-Forwarded-Host", test.forwardedHost)
			request.Header.Set("X-Forwarded-Proto", test.forwardedProto)
			request.Header.Set("Sec-Fetch-Site", test.fetchSite)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d: %s", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
}
