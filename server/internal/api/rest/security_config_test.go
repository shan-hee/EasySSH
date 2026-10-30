package rest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/security"
	"github.com/gin-gonic/gin"
)

type securityPatchRepository struct {
	security.Repository
	config security.SecurityConfig
	writes int
}

func (r *securityPatchRepository) Get(context.Context) (*security.SecurityConfig, error) {
	copy := r.config
	return &copy, nil
}

func (r *securityPatchRepository) SaveWorkspace(_ context.Context, config *security.SecurityConfig) error {
	r.config = *config
	r.writes++
	return nil
}

func (r *securityPatchRepository) SaveWebSecurity(ctx context.Context, config *security.SecurityConfig) error {
	return r.SaveWorkspace(ctx, config)
}

func (r *securityPatchRepository) SaveCORS(ctx context.Context, config *security.SecurityConfig) error {
	return r.SaveWorkspace(ctx, config)
}

func TestSecuritySettingsPartialUpdatesPreservePolicy(t *testing.T) {
	repo := &securityPatchRepository{config: security.SecurityConfig{
		MaxTabs: 30, InactiveMinutes: 60, Hibernate: true,
		CookieDomain: "example.test", CookieSecureMode: "always", CookieSameSite: "strict",
		CORSConfig: `{"allowed_origins":["https://workspace.example.test"]}`,
	}}
	handler := NewSecurityHandler(security.NewService(repo))
	router := gin.New()
	router.POST("/workspace", handler.SaveWorkspaceConfig)
	router.POST("/web-security", handler.SaveWebSecurityConfig)
	router.POST("/cors", handler.SaveCORSConfig)
	save := func(path, body string, status int) {
		t.Helper()
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != status {
			t.Fatalf("%s: %d %s", path, recorder.Code, recorder.Body.String())
		}
	}
	save("/workspace", `{"hibernate":false}`, http.StatusOK)
	if repo.config.Hibernate || repo.config.MaxTabs != 30 || repo.config.InactiveMinutes != 60 {
		t.Fatal("explicit false or omitted workspace values lost")
	}
	save("/web-security", `{"cookie_domain":""}`, http.StatusOK)
	if repo.config.CookieDomain != "" || repo.config.CookieSecureMode != "always" || repo.config.CookieSameSite != "strict" {
		t.Fatal("clearing cookie domain reset security policy")
	}
	before := repo.config.CORSConfig
	save("/cors", `{}`, http.StatusOK)
	if repo.config.CORSConfig != before {
		t.Fatal("omitted origins replaced the CORS policy")
	}
	save("/cors", `{"allowed_origins":[]}`, http.StatusOK)
	var cors security.CORSConfig
	if err := json.Unmarshal([]byte(repo.config.CORSConfig), &cors); err != nil || cors.AllowedOrigins == nil || len(cors.AllowedOrigins) != 0 {
		t.Fatal("explicit empty origins did not clear policy", err)
	}
	writes := repo.writes
	save("/workspace", `{"max_tabs":0}`, http.StatusBadRequest)
	save("/cors", `{"allowed_origins":["*"]}`, http.StatusBadRequest)
	if repo.writes != writes || repo.config.MaxTabs != 30 {
		t.Fatal("invalid policy reached storage")
	}
}
