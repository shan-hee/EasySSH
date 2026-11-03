package rest

import (
	"context"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/grant"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/gin-gonic/gin"
)

// tokenContext attaches the caller's address to the configuration records these
// handlers write; token routes have no request audit middleware to do it.
func tokenContext(c *gin.Context) context.Context {
	return operationrecord.WithRequestMetadata(c.Request.Context(), operationrecord.RequestMetadata{
		Username: c.GetString("username"), IP: middleware.LogClientIP(c), UserAgent: c.Request.UserAgent(),
	})
}

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
	item, token, err := h.service.CreateToken(tokenContext(c), access.Current(c.Request.Context()), input)
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
	if err := h.service.RevokeToken(tokenContext(c), access.Current(c.Request.Context()), id); err != nil {
		accessError(c, err)
		return
	}
	c.Status(204)
}

func (h *AccessHandler) RevealToken(c *gin.Context) {
	noStoreAccess(c)
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	token, err := h.service.RevealToken(tokenContext(c), access.Current(c.Request.Context()), id)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(200, gin.H{"token": token})
}

func (h *AccessHandler) RotateToken(c *gin.Context) {
	noStoreAccess(c)
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	token, err := h.service.RotateToken(tokenContext(c), access.Current(c.Request.Context()), id)
	if err != nil {
		accessError(c, err)
		return
	}
	c.JSON(200, gin.H{"token": token})
}
