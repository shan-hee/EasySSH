package rest

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/server/internal/pkg/password"
	"github.com/gin-gonic/gin"
)

type SecurityHandler struct {
	service security.Service
}

func NewSecurityHandler(service security.Service) *SecurityHandler {
	return &SecurityHandler{service: service}
}

type WorkspaceConfigDTO struct {
	MaxTabs         int  `json:"max_tabs"`
	InactiveMinutes int  `json:"inactive_minutes"`
	Hibernate       bool `json:"hibernate"`
}

func (h *SecurityHandler) GetWorkspaceConfig(c *gin.Context) {
	config, ok := h.get(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": WorkspaceConfigDTO{
		MaxTabs: config.MaxTabs, InactiveMinutes: config.InactiveMinutes, Hibernate: config.Hibernate,
	}})
}

func (h *SecurityHandler) SaveWorkspaceConfig(c *gin.Context) {
	var request WorkspaceConfigDTO
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	config.MaxTabs = request.MaxTabs
	config.InactiveMinutes = request.InactiveMinutes
	config.Hibernate = request.Hibernate
	h.save(c, config, h.service.SaveWorkspace, "Workspace configuration saved successfully")
}

type LoginSessionConfigDTO struct {
	SessionTimeout int  `json:"session_timeout"`
	RememberLogin  bool `json:"remember_login"`
}

func (h *SecurityHandler) GetLoginSessionConfig(c *gin.Context) {
	config, ok := h.get(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": LoginSessionConfigDTO{
		SessionTimeout: config.SessionTimeout, RememberLogin: config.RememberLogin,
	}})
}

func (h *SecurityHandler) SaveLoginSessionConfig(c *gin.Context) {
	var request LoginSessionConfigDTO
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	config.SessionTimeout = request.SessionTimeout
	config.RememberLogin = request.RememberLogin
	h.save(c, config, h.service.SaveLoginSession, "Login session configuration saved successfully")
}

type LoginSecurityConfigDTO struct {
	LoginLimit                int  `json:"login_limit"`
	APILimit                  int  `json:"api_limit"`
	TwoFALimit                int  `json:"two_fa_limit"`
	PasswordPwnedCheckEnabled bool `json:"password_pwned_check_enabled"`
}

func (h *SecurityHandler) GetLoginSecurityConfig(c *gin.Context) {
	config, ok := h.get(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": LoginSecurityConfigDTO{
		LoginLimit: config.LoginLimit, APILimit: config.APILimit, TwoFALimit: config.TwoFALimit,
		PasswordPwnedCheckEnabled: config.PasswordPwnedCheckEnabled,
	}})
}

func (h *SecurityHandler) SaveLoginSecurityConfig(c *gin.Context) {
	var request LoginSecurityConfigDTO
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	config.LoginLimit = request.LoginLimit
	config.APILimit = request.APILimit
	config.TwoFALimit = request.TwoFALimit
	config.PasswordPwnedCheckEnabled = request.PasswordPwnedCheckEnabled
	if !h.save(c, config, h.service.SaveLoginSecurity, "Login security configuration saved successfully") {
		return
	}
	password.SetPwnedCheckEnabled(config.PasswordPwnedCheckEnabled)
}

type WebSecurityConfigDTO struct {
	TrustedProxies        string `json:"trusted_proxies"`
	CookieSecureMode      string `json:"cookie_secure_mode"`
	CookieDomain          string `json:"cookie_domain"`
	CookieSameSite        string `json:"cookie_same_site"`
	CSRFTrustedOrigins    string `json:"csrf_trusted_origins"`
	ContentSecurityPolicy string `json:"content_security_policy"`
}

func (h *SecurityHandler) GetWebSecurityConfig(c *gin.Context) {
	config, ok := h.get(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": WebSecurityConfigDTO{
		TrustedProxies: config.TrustedProxies, CookieSecureMode: config.CookieSecureMode,
		CookieDomain: config.CookieDomain, CookieSameSite: config.CookieSameSite,
		CSRFTrustedOrigins: config.CSRFTrustedOrigins, ContentSecurityPolicy: config.ContentSecurityPolicy,
	}})
}

func (h *SecurityHandler) SaveWebSecurityConfig(c *gin.Context) {
	var request WebSecurityConfigDTO
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	config.TrustedProxies = request.TrustedProxies
	config.CookieSecureMode = request.CookieSecureMode
	config.CookieDomain = request.CookieDomain
	config.CookieSameSite = request.CookieSameSite
	config.CSRFTrustedOrigins = request.CSRFTrustedOrigins
	config.ContentSecurityPolicy = request.ContentSecurityPolicy
	h.save(c, config, h.service.SaveWebSecurity, "Web security configuration saved successfully")
}

func (h *SecurityHandler) GetCORSConfig(c *gin.Context) {
	config, err := h.service.GetCORSConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": config})
}

func (h *SecurityHandler) SaveCORSConfig(c *gin.Context) {
	var request security.CORSConfig
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	data, err := json.Marshal(&request)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	config.CORSConfig = string(data)
	h.save(c, config, h.service.SaveCORS, "CORS configuration saved successfully")
}

type AccessControlConfigDTO struct {
	AllowlistIPs string `json:"allowlist_ips"`
	BlocklistIPs string `json:"blocklist_ips"`
}

func (h *SecurityHandler) GetAccessControlConfig(c *gin.Context) {
	config, ok := h.get(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": AccessControlConfigDTO{
		AllowlistIPs: config.AllowlistIPs, BlocklistIPs: config.BlocklistIPs,
	}})
}

func (h *SecurityHandler) SaveAccessControlConfig(c *gin.Context) {
	var request AccessControlConfigDTO
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	config.AllowlistIPs = request.AllowlistIPs
	config.BlocklistIPs = request.BlocklistIPs
	h.save(c, config, h.service.SaveAccessControl, "Access control configuration saved successfully")
}

func (h *SecurityHandler) get(c *gin.Context) (*security.SecurityConfig, bool) {
	config, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, false
	}
	return config, true
}

type saveSecurityConfigFunc func(context.Context, *security.SecurityConfig) error

func (h *SecurityHandler) save(c *gin.Context, config *security.SecurityConfig, save saveSecurityConfigFunc, message string) bool {
	if err := save(c.Request.Context(), config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return false
	}
	c.JSON(http.StatusOK, gin.H{"message": message})
	return true
}

func bindJSON(c *gin.Context, target any) bool {
	if err := c.ShouldBindJSON(target); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return false
	}
	return true
}
