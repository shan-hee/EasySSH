package rest

import (
	"github.com/easyssh/shared/protocol"
	"net/http"

	"github.com/easyssh/server/internal/domain/grant"
	"github.com/gin-gonic/gin"
)

type GrantHandler struct{ service *grant.Service }

func NewGrantHandler(service *grant.Service) *GrantHandler { return &GrantHandler{service: service} }

func (h *GrantHandler) List(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	limit, offset, ok := accessPagination(c)
	if !ok {
		return
	}
	items, total, err := h.service.List(c.Request.Context(), scope, limit, offset)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(http.StatusOK, protocol.GrantList{Items: items, Total: total})
}

func (h *GrantHandler) Create(c *gin.Context) {
	noStoreAccess(c)
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	var req protocol.CreateGrantInput
	if !accessBody(c, &req) {
		return
	}
	result, err := h.service.Create(c.Request.Context(), scope, req)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *GrantHandler) Detail(c *gin.Context) {
	noStoreAccess(c)
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	result, err := h.service.Detail(c.Request.Context(), scope, id)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *GrantHandler) Update(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	var req protocol.UpdateGrantInput
	if !accessBody(c, &req) {
		return
	}
	if err := h.service.Update(c.Request.Context(), scope, id, req.Version, protocol.CreateGrantInput{Name: req.Name, DefaultContent: req.DefaultContent, ExpiresAt: req.ExpiresAt, LongLived: req.LongLived, MaxSessions: req.MaxSessions, MaxConnections: req.MaxConnections, UploadLimit: req.UploadLimit, DownloadLimit: req.DownloadLimit, AIRequestLimit: req.AIRequestLimit, Resources: req.Resources}); err != nil {
		accessError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *GrantHandler) Revoke(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.service.Revoke(c.Request.Context(), scope, id); err != nil {
		accessError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *GrantHandler) RotateSecret(c *gin.Context) {
	noStoreAccess(c)
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	result, err := h.service.RotateSecret(c.Request.Context(), scope, id)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *GrantHandler) ConfirmResource(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	serverID, ok := accessID(c, "server_id")
	if !ok {
		return
	}
	var req struct {
		Revision int64 `json:"connection_revision"`
	}
	if !accessBody(c, &req) {
		return
	}
	if err := h.service.ConfirmResource(c.Request.Context(), scope, id, serverID, req.Revision); err != nil {
		accessError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
