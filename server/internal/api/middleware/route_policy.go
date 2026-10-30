package middleware

import (
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"path"
	"strings"

	"github.com/easyssh/server/internal/access"
	"github.com/gin-gonic/gin"
)

// RoutePolicy is required at registration. ResourceParam names a server path
// parameter. Work IDs must additionally be resolved and authorized by services.
type RoutePolicy struct {
	Public        bool
	OwnerOnly     bool
	Action        protocol.Action
	ResourceParam string
}

func PublicRoute() RoutePolicy { return RoutePolicy{Public: true} }
func OwnerRoute(action protocol.Action, serverParam string) RoutePolicy {
	return RoutePolicy{OwnerOnly: true, Action: action, ResourceParam: serverParam}
}
func AccessRoute(action protocol.Action, serverParam string) RoutePolicy {
	return RoutePolicy{Action: action, ResourceParam: serverParam}
}

// PolicyRoutes wraps registration, not authentication. Authentication handlers
// run before the policy check; all business handlers run after it.
type PolicyRoutes struct {
	group        *gin.RouterGroup
	declarations map[string]RoutePolicy
}

func NewPolicyRoutes(group *gin.RouterGroup) *PolicyRoutes {
	return &PolicyRoutes{group: group, declarations: make(map[string]RoutePolicy)}
}
func (r *PolicyRoutes) Group(relative string, handlers ...gin.HandlerFunc) *PolicyRoutes {
	return &PolicyRoutes{group: r.group.Group(relative, handlers...), declarations: r.declarations}
}
func (r *PolicyRoutes) Use(handlers ...gin.HandlerFunc) { r.group.Use(handlers...) }
func (r *PolicyRoutes) register(method, relative string, policy RoutePolicy, handlers ...gin.HandlerFunc) {
	fullPath := path.Join(r.group.BasePath(), relative)
	if strings.HasSuffix(relative, "/") && !strings.HasSuffix(fullPath, "/") {
		fullPath += "/"
	}
	key := method + " " + fullPath
	if _, exists := r.declarations[key]; exists {
		panic("duplicate route policy: " + key)
	}
	if len(handlers) == 0 {
		panic("missing route handler: " + key)
	}
	if policy.Public {
		if policy.OwnerOnly || policy.Action != "" || policy.ResourceParam != "" {
			panic("ambiguous public route policy: " + key)
		}
	} else {
		if !policy.Action.Valid() {
			panic("missing route action: " + key)
		}
		if policy.Action.Shareable() && policy.ResourceParam == "" {
			panic("missing server resource source: " + key)
		}
		if policy.ResourceParam != "" && !strings.Contains(fullPath, "/:"+policy.ResourceParam) {
			panic("invalid server resource source: " + key)
		}
	}
	r.declarations[key] = policy
	chain := append([]gin.HandlerFunc{}, handlers[:len(handlers)-1]...)
	chain = append(chain, enforceRoutePolicy(policy), handlers[len(handlers)-1])
	r.group.Handle(method, relative, chain...)
}
func enforceRoutePolicy(policy RoutePolicy) gin.HandlerFunc {
	return func(c *gin.Context) {
		if policy.Public {
			c.Next()
			return
		}
		scope, err := access.FromContext(c.Request.Context())
		if err == nil && policy.OwnerOnly && !scope.IsOwner() {
			err = access.ErrForbidden
		}
		if err == nil {
			err = scope.Check(c.Request.Context(), access.Requirement{Action: policy.Action, ServerID: c.Param(policy.ResourceParam)})
		}
		if err != nil {
			status := http.StatusForbidden
			if errors.Is(err, access.ErrUnauthenticated) || errors.Is(err, access.ErrExpired) || errors.Is(err, access.ErrRevoked) {
				status = http.StatusUnauthorized
			}
			if errors.Is(err, access.ErrResourceChanged) {
				status = http.StatusConflict
			}
			c.AbortWithStatusJSON(status, gin.H{"error": "access_denied"})
			return
		}
		c.Request = c.Request.WithContext(access.WithOperation(c.Request.Context(), access.Requirement{Action: policy.Action, ServerID: c.Param(policy.ResourceParam)}))
		c.Next()
	}
}

// Audit rejects API routes registered outside this policy registrar. Static
// assets are outside the API boundary and cannot dispatch application actions.
func (r *PolicyRoutes) Audit(routes gin.RoutesInfo) error {
	for _, route := range routes {
		if !strings.HasPrefix(route.Path, "/api/") {
			continue
		}
		if _, ok := r.declarations[route.Method+" "+route.Path]; !ok {
			return fmt.Errorf("API route has no declared access policy: %s %s", route.Method, route.Path)
		}
	}
	return nil
}
func (r *PolicyRoutes) GET(p string, policy RoutePolicy, h ...gin.HandlerFunc) {
	r.register(http.MethodGet, p, policy, h...)
}
func (r *PolicyRoutes) HEAD(p string, policy RoutePolicy, h ...gin.HandlerFunc) {
	r.register(http.MethodHead, p, policy, h...)
}
func (r *PolicyRoutes) POST(p string, policy RoutePolicy, h ...gin.HandlerFunc) {
	r.register(http.MethodPost, p, policy, h...)
}
func (r *PolicyRoutes) PUT(p string, policy RoutePolicy, h ...gin.HandlerFunc) {
	r.register(http.MethodPut, p, policy, h...)
}
func (r *PolicyRoutes) PATCH(p string, policy RoutePolicy, h ...gin.HandlerFunc) {
	r.register(http.MethodPatch, p, policy, h...)
}
func (r *PolicyRoutes) DELETE(p string, policy RoutePolicy, h ...gin.HandlerFunc) {
	r.register(http.MethodDelete, p, policy, h...)
}
