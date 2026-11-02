package rest

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"strconv"
	"strings"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/grant"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const accessCookieName = "easyssh_access"

// AccessHandler serves only visitor authentication. It never reads owner
// cookies, owner tokens, or client-provided owner IDs.
type AccessHandler struct {
	service  *grant.Service
	security security.Service
}

func NewAccessHandler(service *grant.Service, securityService security.Service) *AccessHandler {
	return &AccessHandler{service: service, security: securityService}
}

func accessError(c *gin.Context, err error) {
	status, code, message := http.StatusInternalServerError, "internal_error", "Operation could not be completed"
	switch {
	case errors.Is(err, grant.ErrInvalidRequest):
		status, code, message = http.StatusBadRequest, "invalid_request", err.Error()
	case errors.Is(err, grant.ErrProtocol):
		status, code, message = http.StatusConflict, "protocol_mismatch", "The instance access protocol version is not supported"
	case errors.Is(err, grant.ErrConflict):
		status, code, message = http.StatusConflict, "state_changed", "Access state has changed; reload before continuing"
	case errors.Is(err, access.ErrUnauthenticated), errors.Is(err, grant.ErrInvalidLink):
		status, code, message = http.StatusUnauthorized, "invalid_access", "Access is invalid or unavailable"
	case errors.Is(err, access.ErrExpired), errors.Is(err, access.ErrRevoked):
		status, code, message = http.StatusUnauthorized, "access_ended", "Access has ended"
	case errors.Is(err, access.ErrForbidden):
		status, code, message = http.StatusForbidden, "forbidden", "This operation is not permitted"
	case errors.Is(err, access.ErrResourceChanged):
		status, code, message = http.StatusConflict, "resource_paused", "The resource requires owner confirmation"
	case errors.Is(err, access.ErrCapacity):
		status, code, message = http.StatusConflict, "capacity_reached", "The access concurrency limit has been reached"
	case errors.Is(err, grant.ErrQuota):
		status, code, message = http.StatusTooManyRequests, "quota_exhausted", "The grant quota has been exhausted"
	case errors.Is(err, grant.ErrPreparation):
		status, code, message = http.StatusConflict, "preparation_required", "Complete the resource preparation before sharing"
	case errors.Is(err, gorm.ErrRecordNotFound):
		status, code, message = http.StatusNotFound, "not_found", "The requested resource was not found"
	}
	c.AbortWithStatusJSON(status, gin.H{"error": code, "message": message})
}

func accessBody(c *gin.Context, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
	if err := c.ShouldBindJSON(target); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_request", "message": "Invalid request body"})
		return false
	}
	return true
}

func noStoreAccess(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
}

func (h *AccessHandler) browserOrigin(c *gin.Context) (string, bool) {
	expected, err := middleware.RequestOrigin(c, h.security)
	if err != nil {
		accessError(c, access.ErrForbidden)
		return "", false
	}
	if c.GetHeader("Origin") != expected || c.GetHeader("Sec-Fetch-Site") == "cross-site" {
		accessError(c, access.ErrForbidden)
		return "", false
	}
	return expected, true
}

func nativeAccessToken(c *gin.Context) (string, error) {
	value := c.GetHeader("Authorization")
	if value == "" {
		return "", nil
	}
	parts := strings.Fields(value)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Access") || len(parts[1]) > 128 {
		return "", access.ErrUnauthenticated
	}
	return parts[1], nil
}

func (h *AccessHandler) Exchange(c *gin.Context) {
	noStoreAccess(c)
	var req grant.ExchangeRequest
	if !accessBody(c, &req) {
		return
	}
	origin := ""
	if req.ClientKind == "browser" {
		var ok bool
		origin, ok = h.browserOrigin(c)
		if !ok {
			return
		}
		req.ContainerToken, _ = c.Cookie(accessCookieName)
		// Origin validation also protects the first exchange, when there is no
		// access container or CSRF token yet. A share secret is not a cookie.
	} else if req.ClientKind == "desktop" {
		if c.GetHeader("Origin") != "" {
			accessError(c, access.ErrForbidden)
			return
		}
		var err error
		req.SessionToken, err = nativeAccessToken(c)
		if err != nil {
			accessError(c, err)
			return
		}
	} else {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_client"})
		return
	}
	if req.ProtocolMin < 1 || req.ProtocolMin > grant.ProtocolVersion || req.ProtocolMax < grant.ProtocolVersion || req.ProtocolMax < req.ProtocolMin {
		c.AbortWithStatusJSON(http.StatusConflict, gin.H{"error": "protocol_mismatch", "protocol_version": grant.ProtocolVersion})
		return
	}
	result, err := h.service.Exchange(c.Request.Context(), req)
	if err != nil {
		accessError(c, err)
		return
	}
	if req.ClientKind == "browser" {
		http.SetCookie(c.Writer, &http.Cookie{Name: accessCookieName, Value: result.ContainerToken, Path: "/",
			HttpOnly: true, Secure: strings.HasPrefix(origin, "https://"), SameSite: http.SameSiteStrictMode})
		c.JSON(http.StatusOK, protocol.BrowserAccessExchange{Context: result.Context, CSRFToken: result.CSRFToken})
	} else {
		c.JSON(http.StatusOK, protocol.DesktopAccessExchange{Context: result.Context, SessionToken: result.SessionToken})
	}
}

// Authenticate is used for explicitly declared visitor routes. Route policy
// and service methods then check the action and target against the issued scope.
func (h *AccessHandler) Authenticate() gin.HandlerFunc {
	return func(c *gin.Context) {
		noStoreAccess(c)
		if strings.HasPrefix(c.GetHeader("Authorization"), "Bearer ") {
			if c.GetHeader("X-EasySSH-Access-Session") != "" {
				accessError(c, access.ErrForbidden)
				return
			}
			scope, err := h.service.AuthenticateToken(c.Request.Context(), strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "))
			if err != nil {
				accessError(c, err)
				return
			}
			c.Request = c.Request.WithContext(access.WithScope(c.Request.Context(), scope))
			c.Next()
			return
		}
		token, err := nativeAccessToken(c)
		if err != nil {
			accessError(c, err)
			return
		}
		cookie, _ := c.Cookie(accessCookieName)
		mutation := c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead && c.Request.Method != http.MethodOptions
		if cookie != "" && mutation {
			if _, ok := h.browserOrigin(c); !ok {
				return
			}
		}
		scope, err := h.service.Authenticate(c.Request.Context(), c.GetHeader("X-EasySSH-Access-Session"), token, cookie, c.GetHeader("X-CSRF-Token"), mutation)
		if err != nil {
			accessError(c, err)
			return
		}
		c.Request = c.Request.WithContext(access.WithScope(c.Request.Context(), scope))
		c.Next()
	}
}

func currentAccess(c *gin.Context) (access.Scope, bool) {
	scope, err := access.FromContext(c.Request.Context())
	if err != nil {
		accessError(c, err)
		return access.Scope{}, false
	}
	return scope, true
}

func accessID(c *gin.Context, key string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(key))
	if err != nil || id == uuid.Nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return uuid.Nil, false
	}
	return id, true
}

func (h *AccessHandler) Context(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	result, err := h.service.Context(c.Request.Context(), scope)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *AccessHandler) EndSession(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.service.EndSession(c.Request.Context(), scope, id); err != nil {
		accessError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AccessHandler) CreateHandoff(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	result, err := h.service.CreateHandoff(c.Request.Context(), scope)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *AccessHandler) HandoffStatus(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	result, err := h.service.HandoffStatus(c.Request.Context(), scope, id)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *AccessHandler) BindHandoff(c *gin.Context) {
	noStoreAccess(c)
	if c.GetHeader("Origin") != "" {
		accessError(c, access.ErrForbidden)
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	var req protocol.BindAccessHandoffInput
	if !accessBody(c, &req) {
		return
	}
	result, err := h.service.BindHandoff(c.Request.Context(), id, req.Challenge, req.Name)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *AccessHandler) ApproveHandoff(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	var req protocol.ApproveAccessHandoffInput
	if !accessBody(c, &req) {
		return
	}
	if err := h.service.ApproveHandoff(c.Request.Context(), scope, id, req.Confirmation); err != nil {
		accessError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *AccessHandler) ClaimHandoff(c *gin.Context) {
	noStoreAccess(c)
	if c.GetHeader("Origin") != "" {
		accessError(c, access.ErrForbidden)
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	var req protocol.ClaimAccessHandoffInput
	if !accessBody(c, &req) {
		return
	}
	result, err := h.service.ClaimHandoff(c.Request.Context(), id, req.Verifier, req.ProtocolMin, req.ProtocolMax)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.DesktopAccessExchange{Context: result.Context, SessionToken: result.SessionToken})
}

func accessPagination(c *gin.Context) (int, int, bool) {
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if err != nil || limit < 1 || limit > 100 {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_pagination"})
		return 0, 0, false
	}
	offset, err := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if err != nil || offset < 0 {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid_pagination"})
		return 0, 0, false
	}
	return limit, offset, true
}
