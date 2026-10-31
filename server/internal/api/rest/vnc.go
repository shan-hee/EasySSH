package rest

import (
	"github.com/easyssh/server/internal/domain/vnc"
	"github.com/gin-gonic/gin"
)

type VNCHandler struct{ service *vnc.Service }

func NewVNCHandler(service *vnc.Service) *VNCHandler { return &VNCHandler{service: service} }
func (h *VNCHandler) Get(c *gin.Context) {
	id, ok := accessID(c, "server_id")
	if !ok {
		return
	}
	value, err := h.service.Get(c.Request.Context(), id)
	if err != nil {
		accessError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, value)
}
func (h *VNCHandler) Save(c *gin.Context) {
	id, ok := accessID(c, "server_id")
	if !ok {
		return
	}
	var cfg vnc.Config
	if !accessBody(c, &cfg) {
		return
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		RespondError(c, 400, "invalid_port", "Invalid VNC port")
		return
	}
	if err := h.service.Save(c.Request.Context(), id, cfg); err != nil {
		accessError(c, err)
		return
	}
	c.Status(204)
}
