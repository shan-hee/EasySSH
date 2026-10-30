package rest

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"net/http"

	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/shared/servergroup"
	"github.com/gin-gonic/gin"
)

type ServerGroupHandler struct{ service *server.GroupService }

func NewServerGroupHandler(service *server.GroupService) *ServerGroupHandler {
	return &ServerGroupHandler{service: service}
}
func groupError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, server.ErrGroupNotFound):
		RespondError(c, 404, "server_group_not_found", err.Error())
	case errors.Is(err, servergroup.ErrInvalid):
		RespondError(c, 400, "invalid_server_group", err.Error())
	default:
		accessError(c, err)
	}
}
func (h *ServerGroupHandler) List(c *gin.Context) {
	limit, offset := GetPaginationParams(c)
	rows, err := h.service.List(c.Request.Context(), offset/limit+1, limit)
	if err != nil {
		groupError(c, err)
		return
	}
	RespondSuccess(c, rows)
}
func (h *ServerGroupHandler) Create(c *gin.Context) {
	var input protocol.ServerGroupInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	if err := c.ShouldBindJSON(&input); err != nil {
		groupError(c, servergroup.ErrInvalid)
		return
	}
	row, err := h.service.Create(c.Request.Context(), input)
	if err != nil {
		groupError(c, err)
		return
	}
	RespondCreated(c, row)
}
func (h *ServerGroupHandler) Update(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	var input protocol.ServerGroupInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	if err := c.ShouldBindJSON(&input); err != nil {
		groupError(c, servergroup.ErrInvalid)
		return
	}
	row, err := h.service.Update(c.Request.Context(), id, input)
	if err != nil {
		groupError(c, err)
		return
	}
	RespondSuccess(c, row)
}
func (h *ServerGroupHandler) Delete(c *gin.Context) {
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.service.Delete(c.Request.Context(), id); err != nil {
		groupError(c, err)
		return
	}
	RespondSuccess(c, protocol.ServerGroupDeleted{ID: id, Deleted: true})
}
