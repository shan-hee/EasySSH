package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/infra/config"
	"github.com/gin-gonic/gin"
)

func TestOwnerJSONRequestsBehindHTTPSProxy(t *testing.T) {
	router := gin.New()
	router.Use(CORS(&config.Config{Server: config.ServerConfig{Env: "production", WebDevPort: 3000}}, nil))
	for _, path := range []string{"/api/v1/owner/login", "/api/v1/owner/initialize"} {
		router.POST(path, RequireJSONBody(), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	}
	for _, path := range []string{"/api/v1/owner/login", "/api/v1/owner/initialize"} {
		for _, contentType := range []string{"application/json", "application/json; charset=utf-8", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=test", "", "application/json; charset"} {
			t.Run(path+"/"+contentType, func(t *testing.T) {
				request := httptest.NewRequest(http.MethodPost, "http://workspace.example"+path, strings.NewReader(`{}`))
				request.RemoteAddr = "203.0.113.10:50000"
				request.Header.Set("Origin", "https://workspace.example")
				request.Header.Set("X-Forwarded-Proto", "https")
				request.Header.Set("Content-Type", contentType)
				response := httptest.NewRecorder()
				router.ServeHTTP(response, request)
				want := http.StatusUnsupportedMediaType
				if contentType == "application/json" || contentType == "application/json; charset=utf-8" {
					want = http.StatusNoContent
				}
				if response.Code != want {
					t.Fatalf("status = %d, want %d: %s", response.Code, want, response.Body.String())
				}
			})
		}
	}
	for _, method := range []string{http.MethodOptions, http.MethodPost} {
		request := httptest.NewRequest(method, "http://workspace.example/api/v1/owner/login", strings.NewReader(`{}`))
		request.Header.Set("Origin", "https://untrusted.example")
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Access-Control-Request-Method", "POST")
		request.Header.Set("Access-Control-Request-Headers", "content-type")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("untrusted %s accepted: %d", method, response.Code)
		}
	}
}
