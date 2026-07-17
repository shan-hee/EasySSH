package rest

import (
	"errors"
	"net/http"

	api "github.com/easyssh/server/internal/api/openapi"
	"github.com/easyssh/server/internal/domain/permission"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type PermissionHandler struct {
	service permission.Service
}

func NewPermissionHandler(service permission.Service) *PermissionHandler {
	return &PermissionHandler{service: service}
}

func (h *PermissionHandler) ListPermissions(c *gin.Context) {
	permissions := h.service.ListPermissions(c.Query("module"), c.Query("q"))
	c.JSON(http.StatusOK, gin.H{"data": permissions, "total": len(permissions)})
}

func (h *PermissionHandler) ListRoles(c *gin.Context) {
	roles, err := h.service.ListRoles(c.Request.Context())
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "ROLE_LIST_FAILED", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": roles, "total": len(roles)})
}

func (h *PermissionHandler) GetRole(c *gin.Context) {
	id, ok := parseRoleID(c)
	if !ok {
		return
	}
	role, err := h.service.GetRole(c.Request.Context(), id)
	if err != nil {
		h.respondRoleError(c, err)
		return
	}
	RespondSuccess(c, role)
}

func (h *PermissionHandler) CreateRole(c *gin.Context) {
	var req api.RoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if req.Key == nil || *req.Key == "" || req.Name == "" {
		RespondError(c, http.StatusBadRequest, "INVALID_ROLE", "Role key is required")
		return
	}
	role, err := h.service.CreateRole(c.Request.Context(), *req.Key, req.Name, req.Description, req.ParentKey, req.PermissionCodes)
	if err != nil {
		h.respondRoleError(c, err)
		return
	}
	c.JSON(http.StatusCreated, role)
}

func (h *PermissionHandler) UpdateRole(c *gin.Context) {
	id, ok := parseRoleID(c)
	if !ok {
		return
	}
	var req api.RoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	role, err := h.service.UpdateRole(c.Request.Context(), id, req.Name, req.Description, req.ParentKey, req.PermissionCodes)
	if err != nil {
		h.respondRoleError(c, err)
		return
	}
	c.JSON(http.StatusOK, role)
}

func (h *PermissionHandler) DeleteRole(c *gin.Context) {
	id, ok := parseRoleID(c)
	if !ok {
		return
	}
	if err := h.service.DeleteRole(c.Request.Context(), id); err != nil {
		h.respondRoleError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Role deleted successfully"})
}

func (h *PermissionHandler) ListResourceGrants(c *gin.Context) {
	grants, err := h.service.ListResourceGrants(c.Request.Context(), c.Query("subject_type"), c.Query("subject_id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_RESOURCE_GRANT", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": grants, "total": len(grants)})
}

func (h *PermissionHandler) GrantResource(c *gin.Context) {
	grant, ok := bindResourceGrant(c)
	if !ok {
		return
	}
	created, err := h.service.GrantResource(c.Request.Context(), grant)
	if err != nil {
		h.respondGrantError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

func (h *PermissionHandler) RevokeResource(c *gin.Context) {
	grant, ok := bindResourceGrant(c)
	if !ok {
		return
	}
	if err := h.service.RevokeResource(c.Request.Context(), grant); err != nil {
		h.respondGrantError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Resource permission revoked successfully"})
}

func bindResourceGrant(c *gin.Context) (permission.ResourceGrant, bool) {
	var req api.ResourceGrantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return permission.ResourceGrant{}, false
	}
	return permission.ResourceGrant{
		SubjectType: string(req.SubjectType), SubjectID: req.SubjectId, PermissionCode: req.PermissionCode,
		ResourceType: req.ResourceType, ResourceID: req.ResourceId,
	}, true
}

func parseRoleID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_ROLE_ID", "Invalid role ID")
		return uuid.Nil, false
	}
	return id, true
}

func (h *PermissionHandler) respondRoleError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, permission.ErrRoleNotFound):
		RespondError(c, http.StatusNotFound, "ROLE_NOT_FOUND", err.Error())
	case errors.Is(err, permission.ErrRoleKeyExists):
		RespondError(c, http.StatusConflict, "ROLE_KEY_EXISTS", err.Error())
	case errors.Is(err, permission.ErrRoleInUse), errors.Is(err, permission.ErrSystemRole):
		RespondError(c, http.StatusConflict, "ROLE_IN_USE", err.Error())
	case errors.Is(err, permission.ErrInvalidRole), errors.Is(err, permission.ErrInvalidPermission):
		RespondError(c, http.StatusBadRequest, "INVALID_ROLE", err.Error())
	default:
		RespondError(c, http.StatusInternalServerError, "ROLE_OPERATION_FAILED", err.Error())
	}
}

func (h *PermissionHandler) respondGrantError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, permission.ErrResourceGrantExists):
		RespondError(c, http.StatusConflict, "RESOURCE_GRANT_EXISTS", err.Error())
	case errors.Is(err, permission.ErrResourceGrantNotFound):
		RespondError(c, http.StatusNotFound, "RESOURCE_GRANT_NOT_FOUND", err.Error())
	case errors.Is(err, permission.ErrInvalidResourceGrant), errors.Is(err, permission.ErrInvalidPermission):
		RespondError(c, http.StatusBadRequest, "INVALID_RESOURCE_GRANT", err.Error())
	default:
		RespondError(c, http.StatusInternalServerError, "RESOURCE_GRANT_FAILED", err.Error())
	}
}
