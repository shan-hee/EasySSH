package rest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/datasync"
	"github.com/easyssh/shared/syncdata"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SyncHandler struct {
	service *datasync.Service
}

func NewSyncHandler(service *datasync.Service) *SyncHandler {
	return &SyncHandler{service: service}
}
func syncTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func (h *SyncHandler) DeviceAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if !strings.HasPrefix(c.GetHeader("Authorization"), "Bearer ") || !strings.HasPrefix(token, "ess_sync_") || len(token) != 73 {
			c.AbortWithStatusJSON(401, gin.H{"error": "invalid_sync_device"})
			return
		}
		var device datasync.Device
		if err := h.service.DB.WithContext(c.Request.Context()).Where("token_hash = ? AND revoked = ? AND expires_at > ?", syncTokenHash(token), false, time.Now()).First(&device).Error; err != nil {
			c.AbortWithStatusJSON(401, gin.H{"error": "device_revoked_or_expired"})
			return
		}
		var user auth.Owner
		if err := h.service.DB.WithContext(c.Request.Context()).First(&user, "id = ?", device.OwnerID).Error; err != nil || (user.LockedUntil != nil && user.LockedUntil.After(time.Now())) {
			c.AbortWithStatusJSON(403, gin.H{"error": "account_unavailable"})
			return
		}
		if !strings.HasSuffix(c.Request.URL.Path, "/disconnect") {
			enabled, err := h.service.Enabled(c.Request.Context(), user.ID)
			if err != nil {
				c.AbortWithStatusJSON(500, gin.H{"error": "sync_status_failed"})
				return
			}
			if !enabled {
				c.AbortWithStatusJSON(403, gin.H{"error": "sync_disabled", "message": "Sync is paused in account settings"})
				return
			}
		}
		scope, err := access.NewScope(protocol.Actor{Kind: protocol.Device, ID: device.OwnerID.String(), SessionID: device.ID.String()}, device.ExpiresAt, h.service)
		if err != nil {
			accessError(c, err)
			return
		}
		c.Request = c.Request.WithContext(access.WithScope(c.Request.Context(), scope))
		c.Set("sync_device_id", device.ID.String())
		c.Set("sync_scopes", device.Scopes)
		c.Next()
	}
}
func (h *SyncHandler) Identity(c *gin.Context) {
	owner, ok := requireSyncOwnerID(c)
	if !ok {
		return
	}
	instance, err := h.service.InstanceID(c.Request.Context())
	if err != nil {
		RespondError(c, 500, "sync_identity_failed", err.Error())
		return
	}
	var user auth.Owner
	if err := h.service.DB.First(&user, "id = ?", owner).Error; err != nil {
		RespondError(c, 500, "sync_identity_failed", err.Error())
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"space_id": uuid.NewSHA1(instance, []byte(owner.String())).String(), "instance_id": instance, "user_id": owner, "account_name": user.Username, "protocol": syncdata.ConfigurationProtocol, "grants": c.MustGet("sync_scopes")})
}
func (h *SyncHandler) Status(c *gin.Context) {
	owner, ok := requireSyncOwnerID(c)
	if !ok {
		return
	}
	var devices []datasync.Device
	if err := h.service.DB.WithContext(c.Request.Context()).Where("owner_id = ?", owner).Order("created_at DESC").Find(&devices).Error; err != nil {
		RespondError(c, 500, "sync_status_failed", err.Error())
		return
	}
	enabled, err := h.service.Enabled(c.Request.Context(), owner)
	if err != nil {
		RespondError(c, 500, "sync_status_failed", err.Error())
		return
	}
	var instance datasync.Instance
	if err := h.service.DB.WithContext(c.Request.Context()).Limit(1).Find(&instance, "id = ?", 1).Error; err != nil {
		RespondError(c, 500, "sync_identity_failed", err.Error())
		return
	}
	spaceID := ""
	if instance.UUID != uuid.Nil {
		spaceID = uuid.NewSHA1(instance.UUID, []byte(owner.String())).String()
	}
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	if !enabled {
		c.JSON(200, gin.H{"can_sync": true, "enabled": false, "space_id": spaceID, "devices": devices, "conflicts": []any{}})
		return
	}
	result, records, err := h.service.InspectConfiguration(ctx, owner)
	if err != nil {
		c.JSON(200, gin.H{"can_sync": true, "enabled": enabled, "space_id": spaceID, "devices": devices, "conflicts": []any{}, "error": err.Error()})
		return
	}
	vaultConflicts, err := h.service.VaultConflicts(ctx, owner)
	if err != nil {
		RespondError(c, 500, "sync_status_failed", err.Error())
		return
	}
	conflicts := []any{}
	for _, conflict := range result.Conflicts {
		conflicts = append(conflicts, conflict)
	}
	for _, conflict := range vaultConflicts {
		conflicts = append(conflicts, conflict)
	}
	c.JSON(200, gin.H{"can_sync": true, "enabled": enabled, "space_id": spaceID, "devices": devices, "conflicts": conflicts, "records": records})
}
func (h *SyncHandler) RevokeDevice(c *gin.Context) {
	owner, ok := requireSyncOwnerID(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.service.RevokeDevice(c.Request.Context(), owner, id); errors.Is(err, gorm.ErrRecordNotFound) {
		RespondError(c, http.StatusNotFound, "device_unavailable", "Device unavailable")
		return
	} else if err != nil {
		RespondError(c, 500, "device_failed", err.Error())
		return
	}
	c.Status(204)
}

func (h *SyncHandler) UpdateDeviceScopes(c *gin.Context) {
	owner, ok := requireSyncOwnerID(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input *protocol.SyncScopes
	if c.ShouldBindJSON(&input) != nil || input == nil {
		RespondError(c, http.StatusBadRequest, "invalid_sync_scopes", "Invalid sync scopes")
		return
	}
	device, err := h.service.UpdateDeviceScopes(c.Request.Context(), owner, id, syncdata.SyncScopes{Credentials: input.Credentials, AIConfig: input.AIConfig, Sessions: input.Sessions})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		RespondError(c, http.StatusNotFound, "device_unavailable", "Device unavailable, revoked or expired")
		return
	}
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "device_failed", err.Error())
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, device.Public())
}
func (h *SyncHandler) Exchange(c *gin.Context) {
	owner, ok := requireSyncOwnerID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, syncdata.MaxExchangeRequestBytes)
	var peer datasync.Peer
	if err := c.ShouldBindJSON(&peer); err != nil {
		RespondError(c, 400, "invalid_sync_payload", "Invalid or oversized sync payload")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	result, err := h.service.Exchange(ctx, owner, peer, nil)
	if err != nil {
		RespondError(c, 409, "sync_failed", err.Error())
		return
	}
	if id := c.GetString("sync_device_id"); id != "" {
		h.service.DB.Model(&datasync.Device{}).Where("id = ?", id).Update("last_used_at", time.Now())
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, result.ExchangeResult())
}
func (h *SyncHandler) Resolve(c *gin.Context) {
	owner, ok := requireSyncOwnerID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var resolution datasync.Resolution
	if c.ShouldBindJSON(&resolution) != nil {
		RespondError(c, 400, "invalid_resolution", "Invalid conflict resolution")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	var err error
	var result datasync.EngineResult
	if strings.HasPrefix(resolution.Key, "vault/") {
		parts := strings.Split(resolution.Key, "/")
		if len(parts) != 3 || resolution.Field != "ref" {
			RespondError(c, 400, "invalid_resolution", "Invalid vault resolution")
			return
		}
		resolution.Key = syncdata.ValueKey
		result, err = h.service.VaultExchange(ctx, owner, parts[1], parts[2], datasync.Peer{}, &resolution)
	} else {
		result, err = h.service.Exchange(ctx, owner, datasync.Peer{}, &resolution)
	}
	if err != nil {
		RespondError(c, 409, "resolution_failed", err.Error())
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result.ExchangeResult())
}

func (h *SyncHandler) Disconnect(c *gin.Context) {
	if err := h.service.DB.Where("id = ?", c.GetString("sync_device_id")).Delete(&datasync.Device{}).Error; err != nil {
		RespondError(c, 500, "device_failed", err.Error())
		return
	}
	c.JSON(200, protocol.SyncDeviceDisconnected{Disconnected: true})
}

func (h *SyncHandler) SetEnabled(c *gin.Context) {
	owner, ok := requireSyncOwnerID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Enabled == nil {
		RespondError(c, 400, "invalid_sync_settings", "enabled is required")
		return
	}
	if err := h.service.SetEnabled(c.Request.Context(), owner, *input.Enabled); err != nil {
		RespondError(c, 500, "sync_settings_failed", err.Error())
		return
	}
	c.Status(http.StatusNoContent)
}
