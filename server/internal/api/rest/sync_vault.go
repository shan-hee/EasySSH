package rest

import (
	"context"
	"net/http"
	"time"

	"github.com/easyssh/server/internal/domain/datasync"
	"github.com/easyssh/shared/syncdata"
	"github.com/gin-gonic/gin"
)

func (h *SyncHandler) VaultList(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	rows, err := h.service.VaultList(c.Request.Context(), owner)
	if err != nil {
		RespondError(c, 500, "sync_failed", err.Error())
		return
	}
	c.Header("Cache-Control", "no-store")
	filtered := []datasync.VaultEntry{}
	scopes, _ := c.MustGet("sync_scopes").(syncdata.SyncScopes)
	for _, row := range rows {
		if scopes.Allows(row.Kind) {
			filtered = append(filtered, row)
		}
	}
	c.JSON(200, filtered)
}
func (h *SyncHandler) VaultPut(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
	var input struct {
		Kind       string `json:"kind"`
		ResourceID string `json:"resource_id"`
		Value      string `json:"value"`
	}
	if c.ShouldBindJSON(&input) != nil {
		RespondError(c, 400, "invalid_object", "Invalid object")
		return
	}
	if !vaultScope(c, input.Kind) {
		return
	}
	if err := h.service.PutVaultObject(c.Request.Context(), owner, input.Kind, c.Param("id"), input.ResourceID, input.Value); err != nil {
		RespondError(c, 400, "invalid_object", err.Error())
		return
	}
	c.JSON(200, gin.H{"saved": true})
}
func (h *SyncHandler) VaultGet(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	var object datasync.VaultObject
	if err := h.service.DB.Select("kind").First(&object, "user_id=? AND id=?", owner, c.Param("id")).Error; err != nil {
		RespondError(c, 404, "object_unavailable", "Object unavailable")
		return
	}
	if !vaultScope(c, object.Kind) {
		return
	}
	value, err := h.service.GetVaultObject(c.Request.Context(), owner, c.Param("id"))
	if err != nil {
		RespondError(c, 404, "object_unavailable", "Object unavailable")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"value": value})
}
func (h *SyncHandler) VaultExchange(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 12<<20)
	var input struct {
		Peer       datasync.Peer        `json:"peer"`
		Resolution *datasync.Resolution `json:"resolution"`
	}
	if c.ShouldBindJSON(&input) != nil {
		RespondError(c, 400, "invalid_sync", "Invalid sync request")
		return
	}
	if !vaultScope(c, c.Param("kind")) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	result, err := h.service.VaultExchange(ctx, owner, c.Param("kind"), c.Param("id"), input.Peer, input.Resolution)
	if err != nil {
		RespondError(c, 409, "sync_failed", err.Error())
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, result)
}

func vaultScope(c *gin.Context, kind string) bool {
	scopes, _ := c.MustGet("sync_scopes").(syncdata.SyncScopes)
	if kind == "attachment" {
		kind = "ai_session"
	}
	if !scopes.Allows(kind) {
		RespondError(c, 403, "sync_scope_denied", "Reauthorize this device to enable this sync scope")
		return false
	}
	return true
}

func (h *SyncHandler) ForkVaultSession(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		ID  string `json:"id"`
		Ref string `json:"ref"`
	}
	if c.ShouldBindJSON(&input) != nil {
		RespondError(c, 400, "invalid_fork", "Invalid conversation version")
		return
	}
	id, err := h.service.ForkVaultSession(c.Request.Context(), owner, input.ID, input.Ref)
	if err != nil {
		RespondError(c, 409, "fork_failed", err.Error())
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"id": id})
}
