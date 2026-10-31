package rest

import (
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/grant"
	"github.com/gin-gonic/gin"
)

func (h *AccessHandler) ListTokens(c *gin.Context) {
	noStoreAccess(c)
	items, err := h.service.ListTokens(c.Request.Context(), access.Current(c.Request.Context()))
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(200, items)
}
func (h *AccessHandler) CreateToken(c *gin.Context) {
	noStoreAccess(c)
	var input grant.CreateTokenInput
	if !accessBody(c, &input) {
		return
	}
	item, token, err := h.service.CreateToken(c.Request.Context(), access.Current(c.Request.Context()), input)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(201, gin.H{"token": token, "metadata": item})
}

func (h *AccessHandler) RevokeToken(c *gin.Context) {
	noStoreAccess(c)
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.service.RevokeToken(c.Request.Context(), access.Current(c.Request.Context()), id); err != nil {
		accessError(c, err)
		return
	}
	c.Status(204)
}
