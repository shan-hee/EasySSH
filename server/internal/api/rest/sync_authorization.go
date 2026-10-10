package rest

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/easyssh/server/internal/domain/datasync"
	"github.com/easyssh/shared/syncdata"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func syncSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
func (h *SyncHandler) StartAuthorization(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		Name      string `json:"name"`
		TokenHash string `json:"token_hash"`
	}
	if c.ShouldBindJSON(&input) != nil || strings.TrimSpace(input.Name) == "" || utf8.RuneCountInString(input.Name) > 100 {
		RespondError(c, 400, "invalid_device_name", "Device name is required (max 100 characters)")
		return
	}
	if b, err := hex.DecodeString(input.TokenHash); err != nil || len(b) != 32 {
		RespondError(c, 400, "invalid_token_hash", "Invalid device credential hash")
		return
	}
	deviceCode, err := syncSecret()
	if err != nil {
		RespondError(c, 500, "authorization_failed", err.Error())
		return
	}
	userCode, err := syncSecret()
	if err != nil {
		RespondError(c, 500, "authorization_failed", err.Error())
		return
	}
	row := datasync.Authorization{ID: uuid.New(), DeviceCodeHash: syncTokenHash(deviceCode), UserCodeHash: syncTokenHash(userCode), TokenHash: input.TokenHash, Name: strings.TrimSpace(input.Name), Status: "pending", ExpiresAt: time.Now().Add(5 * time.Minute)}
	db := h.service.DB.WithContext(c.Request.Context())
	if err := db.Where("expires_at < ?", time.Now()).Delete(&datasync.Authorization{}).Error; err != nil {
		RespondError(c, 500, "authorization_failed", err.Error())
		return
	}
	if err := db.Create(&row).Error; err != nil {
		RespondError(c, 500, "authorization_failed", err.Error())
		return
	}
	c.JSON(200, gin.H{"device_code": deviceCode, "user_code": userCode, "expires_at": row.ExpiresAt})
}
func (h *SyncHandler) PollAuthorization(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		DeviceCode string `json:"device_code"`
	}
	if c.ShouldBindJSON(&input) != nil || len(input.DeviceCode) != 64 {
		RespondError(c, 400, "invalid_authorization", "Invalid authorization request")
		return
	}
	var row datasync.Authorization
	if err := h.service.DB.Where("device_code_hash = ? AND expires_at > ?", syncTokenHash(input.DeviceCode), time.Now()).First(&row).Error; err != nil {
		RespondError(c, 400, "authorization_expired", "Authorization expired; start again")
		return
	}
	c.JSON(200, gin.H{"status": row.Status})
}
func readSyncUserCode(c *gin.Context) (string, bool) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		UserCode string `json:"user_code"`
	}
	if c.ShouldBindJSON(&input) != nil || len(input.UserCode) != 64 {
		RespondError(c, 400, "invalid_authorization", "Invalid authorization request")
		return "", false
	}
	return input.UserCode, true
}
func (h *SyncHandler) AuthorizationInfo(c *gin.Context) {
	code, ok := readSyncUserCode(c)
	if !ok {
		return
	}
	var row datasync.Authorization
	if err := h.service.DB.Where("user_code_hash = ? AND expires_at > ?", syncTokenHash(code), time.Now()).First(&row).Error; err != nil {
		RespondError(c, 400, "authorization_expired", "Authorization expired; start again")
		return
	}
	c.JSON(200, gin.H{"name": row.Name, "status": row.Status})
}
func (h *SyncHandler) ApproveAuthorization(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		UserCode string              `json:"user_code"`
		Scopes   syncdata.SyncScopes `json:"scopes"`
	}
	if c.ShouldBindJSON(&input) != nil || len(input.UserCode) != 64 {
		RespondError(c, 400, "invalid_authorization", "Invalid authorization")
		return
	}
	code := input.UserCode

	err := h.service.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		// Claim once before creating the device; concurrent approvals cannot rebind it.
		result := tx.Model(&datasync.Authorization{}).Where("user_code_hash = ? AND status = ? AND expires_at > ?", syncTokenHash(code), "pending", time.Now()).Update("status", "approved")
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("authorization expired or already approved")
		}
		var row datasync.Authorization
		if err := tx.Where("user_code_hash = ?", syncTokenHash(code)).First(&row).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&datasync.Device{}).Where("user_id = ? AND expires_at > ?", owner, time.Now()).Count(&count).Error; err != nil {
			return err
		}
		if count >= 20 {
			return errors.New("revoke an existing device first (maximum 20)")
		}
		return tx.Create(&datasync.Device{ID: row.ID, UserID: owner, Scopes: input.Scopes, Name: row.Name, TokenHash: row.TokenHash, ExpiresAt: time.Now().Add(90 * 24 * time.Hour)}).Error
	})
	if err != nil {
		RespondError(c, 409, "authorization_failed", err.Error())
		return
	}
	c.Status(204)
}

func (h *SyncHandler) cancelAuthorization(c *gin.Context, column, hash string) {
	err := h.service.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&datasync.Authorization{}).Where(column+" = ? AND expires_at > ?", hash, time.Now()).Update("status", "denied")
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("authorization expired")
		}
		var row datasync.Authorization
		if err := tx.Where(column+" = ?", hash).First(&row).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", row.ID).Delete(&datasync.Device{}).Error
	})
	if err != nil {
		RespondError(c, 400, "authorization_failed", err.Error())
		return
	}
	c.JSON(200, gin.H{"status": "denied"})
}
func (h *SyncHandler) CancelAuthorization(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var input struct {
		DeviceCode string `json:"device_code"`
	}
	if c.ShouldBindJSON(&input) != nil || len(input.DeviceCode) != 64 {
		RespondError(c, 400, "invalid_authorization", "Invalid authorization request")
		return
	}
	h.cancelAuthorization(c, "device_code_hash", syncTokenHash(input.DeviceCode))
}
func (h *SyncHandler) DenyAuthorization(c *gin.Context) {
	code, ok := readSyncUserCode(c)
	if !ok {
		return
	}
	h.cancelAuthorization(c, "user_code_hash", syncTokenHash(code))
}
