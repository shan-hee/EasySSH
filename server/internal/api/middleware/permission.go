package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type PermissionService interface {
	Authorize(ctx context.Context, userID uuid.UUID, roleKey, permissionCode, resource string) (bool, error)
}

type ResourceIDExtractor func(*gin.Context) string

func RequirePermission(permissionService PermissionService, code string) gin.HandlerFunc {
	return requirePermission(permissionService, code, "", nil)
}

func RequireResourcePermission(permissionService PermissionService, code, resourceType string, extractor ResourceIDExtractor) gin.HandlerFunc {
	return requirePermission(permissionService, code, strings.TrimSpace(resourceType), extractor)
}

func PathResourceID(parameter string) ResourceIDExtractor {
	return func(c *gin.Context) string { return strings.TrimSpace(c.Param(parameter)) }
}

func RequestResourceID(name string) ResourceIDExtractor {
	return func(c *gin.Context) string {
		if value := strings.TrimSpace(c.Param(name)); value != "" {
			return value
		}
		if value := strings.TrimSpace(c.Query(name)); value != "" {
			return value
		}
		return strings.TrimSpace(c.PostForm(name))
	}
}

func requirePermission(permissionService PermissionService, code, resourceType string, extractor ResourceIDExtractor) gin.HandlerFunc {
	return func(c *gin.Context) {
		if permissionService == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "permission_service_unavailable", "message": "Permission service not available"})
			c.Abort()
			return
		}

		userIDValue, userExists := c.Get("user_id")
		roleValue, roleExists := c.Get("role")
		userIDString, userOK := userIDValue.(string)
		roleKey, roleOK := roleValue.(string)
		userID, err := uuid.Parse(userIDString)
		if !userExists || !roleExists || !userOK || !roleOK || err != nil || strings.TrimSpace(roleKey) == "" {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": "Invalid authorization identity"})
			c.Abort()
			return
		}

		resource := ""
		if extractor != nil {
			resourceID := strings.TrimSpace(extractor(c))
			if resourceType == "" || resourceID == "" || strings.Contains(resourceID, "/") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_resource", "message": "Resource identifier is required"})
				c.Abort()
				return
			}
			resource = resourceType + "/" + resourceID
		}

		allowed, err := permissionService.Authorize(c.Request.Context(), userID, roleKey, code, resource)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "permission_check_failed", "message": err.Error()})
			c.Abort()
			return
		}
		if !allowed {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden", "message": "Insufficient permissions"})
			c.Abort()
			return
		}

		c.Next()
	}
}
