package rest

import (
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type OwnerHandler struct {
	service  *auth.Service
	security security.Service
}

func NewOwnerHandler(service *auth.Service, securityService security.Service) *OwnerHandler {
	return &OwnerHandler{service: service, security: securityService}
}
func ownerError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, auth.ErrInvalidInput):
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "message": err.Error()})
	case errors.Is(err, auth.ErrTwoFactorRequired):
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "two_factor_required"})
	case errors.Is(err, auth.ErrInvalidCredentials), errors.Is(err, auth.ErrInvalidTwoFactorCode):
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid_credentials"})
	case errors.Is(err, auth.ErrAccountLocked), errors.Is(err, auth.ErrIPLocked):
		c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "login_temporarily_locked"})
	case errors.Is(err, auth.ErrInitialized):
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{"error": "already_initialized"})
	case errors.Is(err, auth.ErrOwnerNotFound):
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{"error": "initialization_required"})
	default:
		accessError(c, err)
	}
}
func (h *OwnerHandler) setSession(c *gin.Context, result *auth.LoginResult) {
	middleware.SetOwnerSessionCookie(c, result.Token, result.Session, h.security)
	noStoreAccess(c)
	c.JSON(http.StatusOK, protocol.OwnerLoginResult{Owner: result.Owner.ToPublic(), SessionID: result.Session.ID, ExpiresAt: result.Session.ExpiresAt, CSRFToken: result.CSRFToken})
}
func (h *OwnerHandler) Status(c *gin.Context) {
	ctx, release := h.service.RequestContext(c.Request.Context())
	defer release()
	c.Request = c.Request.WithContext(ctx)
	noStoreAccess(c)
	initialized, err := h.service.Initialized(c.Request.Context())
	if err != nil {
		ownerError(c, err)
		return
	}
	result := protocol.OwnerStatus{Initialized: initialized}
	if token, err := c.Cookie(middleware.OwnerCookieName); err == nil {
		if scope, session, err := h.service.Authenticate(c.Request.Context(), token, "", false); err == nil {
			ctx := access.WithScope(c.Request.Context(), scope)
			id, _ := uuid.Parse(scope.Actor().ID)
			if owner, err := h.service.GetOwnerByID(ctx, id); err == nil {
				middleware.SetOwnerSessionCookie(c, token, session, h.security)
				result.Authenticated = true
				publicOwner := owner.ToPublic()
				result.Owner = &publicOwner
				sessionID, _ := uuid.Parse(scope.Actor().SessionID)
				result.SessionID = &sessionID
				expiresAt := scope.ExpiresAt()
				result.ExpiresAt = &expiresAt
			}
		}
	}
	c.JSON(http.StatusOK, result)
}
func (h *OwnerHandler) Initialize(c *gin.Context) {
	var req protocol.OwnerInitializeInput
	if !accessBody(c, &req) {
		return
	}
	if _, err := h.service.Initialize(c.Request.Context(), req.Username, req.Email, req.Password); err != nil {
		ownerError(c, err)
		return
	}
	result, err := h.service.Login(c.Request.Context(), protocol.OwnerLoginInput{Email: req.Email, Password: req.Password}, auth.SessionInfo{IPAddress: c.ClientIP(), UserAgent: c.Request.UserAgent(), DeviceName: c.Request.UserAgent(), DeviceType: "browser"})
	if err != nil {
		ownerError(c, err)
		return
	}
	h.setSession(c, result)
}
func (h *OwnerHandler) Login(c *gin.Context) {
	var req protocol.OwnerLoginInput
	if !accessBody(c, &req) {
		return
	}
	result, err := h.service.Login(c.Request.Context(), req, auth.SessionInfo{IPAddress: c.ClientIP(), UserAgent: c.Request.UserAgent(), DeviceName: c.Request.UserAgent(), DeviceType: "browser"})
	if err != nil {
		ownerError(c, err)
		return
	}
	h.setSession(c, result)
}
func (h *OwnerHandler) CSRF(c *gin.Context) {
	noStoreAccess(c)
	token, err := c.Cookie(middleware.OwnerCookieName)
	if err != nil {
		ownerError(c, access.ErrUnauthenticated)
		return
	}
	csrf, session, err := h.service.CSRFToken(c.Request.Context(), token)
	if err != nil {
		ownerError(c, err)
		return
	}
	middleware.SetOwnerSessionCookie(c, token, session, h.security)
	c.JSON(http.StatusOK, protocol.CSRFToken{CSRFToken: csrf})
}
func ownerIdentity(c *gin.Context) (uuid.UUID, uuid.UUID, bool) {
	scope, ok := currentAccess(c)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	if err := scope.RequireOwner(c.Request.Context(), protocol.OwnerManage); err != nil {
		ownerError(c, err)
		return uuid.Nil, uuid.Nil, false
	}
	ownerID, err := uuid.Parse(scope.Actor().ID)
	if err != nil {
		ownerError(c, access.ErrUnauthenticated)
		return uuid.Nil, uuid.Nil, false
	}
	sessionID, err := uuid.Parse(scope.Actor().SessionID)
	if err != nil {
		ownerError(c, access.ErrUnauthenticated)
		return uuid.Nil, uuid.Nil, false
	}
	return ownerID, sessionID, true
}
func (h *OwnerHandler) Logout(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	if err := h.service.Logout(c.Request.Context(), id); err != nil {
		ownerError(c, err)
		return
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: middleware.OwnerCookieName, Value: "", Path: "/", HttpOnly: true, Secure: middleware.RequestUsesHTTPS(c, h.security), SameSite: http.SameSiteStrictMode, MaxAge: -1})
	c.Status(http.StatusNoContent)
}
func (h *OwnerHandler) Profile(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	owner, err := h.service.GetOwnerByID(c.Request.Context(), id)
	if err != nil {
		ownerError(c, err)
		return
	}
	c.JSON(http.StatusOK, owner.ToPublic())
}
func (h *OwnerHandler) UpdateProfile(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	var req protocol.OwnerProfileInput
	if !accessBody(c, &req) {
		return
	}
	if err := h.service.UpdateProfile(c.Request.Context(), id, req.Username, req.Email, req.Avatar, req.Language, req.Timezone); err != nil {
		ownerError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *OwnerHandler) ChangePassword(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	var req protocol.OwnerPasswordInput
	if !accessBody(c, &req) {
		return
	}
	if err := h.service.ChangePassword(c.Request.Context(), id, req.OldPassword, req.NewPassword); err != nil {
		ownerError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *OwnerHandler) Generate2FA(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	var req protocol.OwnerTwoFactorSetupInput
	if !accessBody(c, &req) {
		return
	}
	secret, uri, err := h.service.Generate2FASecret(c.Request.Context(), id, req.Password)
	if err != nil {
		ownerError(c, err)
		return
	}
	noStoreAccess(c)
	c.JSON(http.StatusOK, protocol.OwnerTwoFactorSetup{Secret: secret, OtpauthURI: uri, ExpiresIn: 600})
}
func (h *OwnerHandler) Enable2FA(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	var req protocol.OwnerTwoFactorCodeInput
	if !accessBody(c, &req) {
		return
	}
	codes, err := h.service.Enable2FA(c.Request.Context(), id, req.Code)
	if err != nil {
		ownerError(c, err)
		return
	}
	noStoreAccess(c)
	c.JSON(http.StatusOK, protocol.OwnerRecoveryCodes{RecoveryCodes: codes})
}
func (h *OwnerHandler) Disable2FA(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	var req protocol.OwnerTwoFactorCodeInput
	if !accessBody(c, &req) {
		return
	}
	if err := h.service.Disable2FA(c.Request.Context(), id, req.Code); err != nil {
		ownerError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *OwnerHandler) ListSessions(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	rows, err := h.service.ListSessions(c.Request.Context(), id)
	if err != nil {
		ownerError(c, err)
		return
	}
	items := make([]protocol.OwnerSession, 0, len(rows))
	for _, row := range rows {
		items = append(items, row.Public())
	}
	c.JSON(http.StatusOK, protocol.OwnerSessionList{Items: items})
}
func (h *OwnerHandler) RevokeSession(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	session, ok := accessID(c, "session_id")
	if !ok {
		return
	}
	if err := h.service.RevokeSession(c.Request.Context(), id, session); err != nil {
		ownerError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *OwnerHandler) RevokeOtherSessions(c *gin.Context) {
	id, session, ok := ownerIdentity(c)
	if !ok {
		return
	}
	if err := h.service.RevokeAllOtherSessions(c.Request.Context(), id, session); err != nil {
		ownerError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *OwnerHandler) UpdateNotifications(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	var req protocol.OwnerNotificationsInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	values := map[string]bool{}
	if req.NotifyBrowser != nil {
		values["notify_browser"] = *req.NotifyBrowser
	}
	if req.NotifyEmailAlert != nil {
		values["notify_email_alert"] = *req.NotifyEmailAlert
	}
	if req.NotifyEmailLogin != nil {
		values["notify_email_login"] = *req.NotifyEmailLogin
	}
	if req.NotifyNewDevice != nil {
		values["notify_new_device"] = *req.NotifyNewDevice
	}
	if req.NotifyNewLocation != nil {
		values["notify_new_location"] = *req.NotifyNewLocation
	}
	if req.NotifySuspicious != nil {
		values["notify_suspicious"] = *req.NotifySuspicious
	}
	if req.NotifyTaskExternal != nil {
		values["notify_task_external"] = *req.NotifyTaskExternal
	}
	if req.NotifyTaskFailure != nil {
		values["notify_task_failure"] = *req.NotifyTaskFailure
	}
	if req.NotifyTaskInApp != nil {
		values["notify_task_in_app"] = *req.NotifyTaskInApp
	}
	if req.NotifyTaskPartial != nil {
		values["notify_task_partial"] = *req.NotifyTaskPartial
	}
	if req.NotifyTaskSuccess != nil {
		values["notify_task_success"] = *req.NotifyTaskSuccess
	}
	if err := h.service.UpdateNotificationSettings(c.Request.Context(), id, values); err != nil {
		ownerError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *OwnerHandler) UpdateMonitorDataSource(c *gin.Context) {
	id, _, ok := ownerIdentity(c)
	if !ok {
		return
	}
	var req protocol.OwnerMonitorInput
	if !accessBody(c, &req) {
		return
	}
	if err := h.service.UpdateMonitorDataSource(c.Request.Context(), id, req); err != nil {
		ownerError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
