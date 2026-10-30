package rest

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
)

type SecurityHandler struct {
	service security.Service
}

func NewSecurityHandler(service security.Service) *SecurityHandler {
	return &SecurityHandler{service: service}
}

func (h *SecurityHandler) GetWorkspaceConfig(c *gin.Context) {
	config, ok := h.get(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, protocol.WorkspaceConfigResponse{Config: protocol.WorkspaceConfig{
		MaxTabs: config.MaxTabs, InactiveMinutes: config.InactiveMinutes, Hibernate: config.Hibernate,
	}})
}

func (h *SecurityHandler) SaveWorkspaceConfig(c *gin.Context) {
	var request protocol.WorkspaceConfigUpdate
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	if request.MaxTabs != nil {
		config.MaxTabs = *request.MaxTabs
	}
	if request.InactiveMinutes != nil {
		config.InactiveMinutes = *request.InactiveMinutes
	}
	if request.Hibernate != nil {
		config.Hibernate = *request.Hibernate
	}
	h.save(c, config, h.service.SaveWorkspace, "Workspace configuration saved successfully")
}

func (h *SecurityHandler) GetLoginSessionConfig(c *gin.Context) {
	config, ok := h.get(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, protocol.LoginSessionConfigResponse{Config: protocol.LoginSessionConfig{
		SessionTimeout: config.SessionTimeout, RememberLogin: config.RememberLogin,
	}})
}

func (h *SecurityHandler) SaveLoginSessionConfig(c *gin.Context) {
	var request protocol.LoginSessionConfigUpdate
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	if request.SessionTimeout != nil {
		config.SessionTimeout = *request.SessionTimeout
	}
	if request.RememberLogin != nil {
		config.RememberLogin = *request.RememberLogin
	}
	h.save(c, config, h.service.SaveLoginSession, "Login session configuration saved successfully")
}

func (h *SecurityHandler) GetLoginSecurityConfig(c *gin.Context) {
	config, ok := h.get(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, protocol.LoginSecurityConfigResponse{Config: protocol.LoginSecurityConfig{
		LoginLimit: config.LoginLimit, APILimit: config.APILimit, TwoFALimit: config.TwoFALimit,
	}})
}

func (h *SecurityHandler) SaveLoginSecurityConfig(c *gin.Context) {
	var request protocol.LoginSecurityConfigUpdate
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	if request.LoginLimit != nil {
		config.LoginLimit = *request.LoginLimit
	}
	if request.APILimit != nil {
		config.APILimit = *request.APILimit
	}
	if request.TwoFALimit != nil {
		config.TwoFALimit = *request.TwoFALimit
	}
	if !h.save(c, config, h.service.SaveLoginSecurity, "Login security configuration saved successfully") {
		return
	}
}

func (h *SecurityHandler) GetWebSecurityConfig(c *gin.Context) {
	config, ok := h.get(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, protocol.WebSecurityConfigResponse{Config: protocol.WebSecurityConfig{
		TrustedProxies: config.TrustedProxies, CookieSecureMode: config.CookieSecureMode,
		CookieDomain: config.CookieDomain, CookieSameSite: config.CookieSameSite,
		CSRFTrustedOrigins: config.CSRFTrustedOrigins, ContentSecurityPolicy: config.ContentSecurityPolicy,
	}})
}

func (h *SecurityHandler) SaveWebSecurityConfig(c *gin.Context) {
	var request protocol.WebSecurityConfigUpdate
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	if request.TrustedProxies != nil {
		config.TrustedProxies = *request.TrustedProxies
	}
	if request.CookieSecureMode != nil {
		config.CookieSecureMode = *request.CookieSecureMode
	}
	if request.CookieDomain != nil {
		config.CookieDomain = *request.CookieDomain
	}
	if request.CookieSameSite != nil {
		config.CookieSameSite = *request.CookieSameSite
	}
	if request.CSRFTrustedOrigins != nil {
		config.CSRFTrustedOrigins = *request.CSRFTrustedOrigins
	}
	if request.ContentSecurityPolicy != nil {
		config.ContentSecurityPolicy = *request.ContentSecurityPolicy
	}
	h.save(c, config, h.service.SaveWebSecurity, "Web security configuration saved successfully")
}

func (h *SecurityHandler) GetCORSConfig(c *gin.Context) {
	config, err := h.service.GetCORSConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, protocol.CORSConfigResponse{Config: *config})
}

func (h *SecurityHandler) SaveCORSConfig(c *gin.Context) {
	var request protocol.CORSConfigUpdate
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	if request.AllowedOrigins != nil {
		data, err := json.Marshal(protocol.CORSConfig{AllowedOrigins: *request.AllowedOrigins})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		config.CORSConfig = string(data)
	}
	h.save(c, config, h.service.SaveCORS, "CORS configuration saved successfully")
}

func (h *SecurityHandler) GetAccessControlConfig(c *gin.Context) {
	config, ok := h.get(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, protocol.AccessControlConfigResponse{Config: protocol.AccessControlConfig{
		AllowlistIPs: config.AllowlistIPs, BlocklistIPs: config.BlocklistIPs,
	}})
}

func (h *SecurityHandler) SaveAccessControlConfig(c *gin.Context) {
	var request protocol.AccessControlConfigUpdate
	if !bindJSON(c, &request) {
		return
	}
	config, ok := h.get(c)
	if !ok {
		return
	}
	if request.AllowlistIPs != nil {
		config.AllowlistIPs = *request.AllowlistIPs
	}
	if request.BlocklistIPs != nil {
		config.BlocklistIPs = *request.BlocklistIPs
	}
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
	c.JSON(http.StatusOK, protocol.MessageResponse{Message: message})
	return true
}

func bindJSON(c *gin.Context, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	if err := c.ShouldBindJSON(target); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return false
	}
	return true
}
