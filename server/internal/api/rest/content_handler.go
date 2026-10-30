package rest

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
)

type ContentHandler struct{ service *content.Service }

func NewContentHandler(service *content.Service) *ContentHandler {
	return &ContentHandler{service: service}
}
func (h *ContentHandler) Reference(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	ref, err := h.service.Reference(c.Request.Context(), id)
	if err != nil {
		contentError(c, err)
		return
	}
	RespondSuccess(c, ref)
}
func (h *ContentHandler) Read(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	input := protocol.ContentReadInput{Sha256: c.Query("sha256")}
	if value, ok := c.GetQuery("offset"); ok {
		v, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			contentError(c, contentstore.ErrQuery)
			return
		}
		input.Offset = v
	}
	if value, ok := c.GetQuery("limit"); ok {
		v, err := strconv.Atoi(value)
		if err != nil {
			contentError(c, contentstore.ErrQuery)
			return
		}
		input.Limit = v
	}
	input, err := contentstore.Normalize(input)
	if err != nil {
		contentError(c, err)
		return
	}
	chunk, err := h.service.Read(c.Request.Context(), id, input)
	if err != nil {
		contentError(c, err)
		return
	}
	RespondSuccess(c, chunk)
}
func contentError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, contentstore.ErrQuery):
		RespondError(c, http.StatusBadRequest, "invalid_content_range", "Invalid content range")
	case errors.Is(err, contentstore.ErrChanged):
		RespondError(c, http.StatusConflict, "content_changed", "Reload the content reference")
	case errors.Is(err, content.ErrNotReady):
		RespondError(c, http.StatusConflict, "content_not_ready", "Content has not been sealed")
	case errors.Is(err, content.ErrNotFound):
		RespondError(c, http.StatusNotFound, "content_not_found", "Content not found")
	default:
		accessError(c, err)
	}
}
