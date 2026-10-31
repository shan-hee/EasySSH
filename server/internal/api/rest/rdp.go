package rest

import (
	"github.com/easyssh/server/internal/domain/rdp"
	"github.com/gin-gonic/gin"
)

type RDPHandler struct {
	service    *rdp.Service
	configured bool
}

func NewRDPHandler(service *rdp.Service, configured bool) *RDPHandler {
	return &RDPHandler{service: service, configured: configured}
}
func (h *RDPHandler) Status(c *gin.Context) { c.JSON(200, gin.H{"configured": h.configured}) }
func (h *RDPHandler) Get(c *gin.Context) {
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
func (h *RDPHandler) Save(c *gin.Context) {
	id, ok := accessID(c, "server_id")
	if !ok {
		return
	}
	var cfg rdp.Config
	if !accessBody(c, &cfg) {
		return
	}
	if cfg.Port < 1 || cfg.Port > 65535 || cfg.Security != "nla" && cfg.Security != "tls" {
		RespondError(c, 400, "invalid_rdp_config", "Invalid RDP port or security mode")
		return
	}
	if err := h.service.Save(c.Request.Context(), id, cfg); err != nil {
		accessError(c, err)
		return
	}
	c.Status(204)
}
