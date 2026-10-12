package rest

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/easyssh/server/internal/domain/datasync"
	"github.com/easyssh/shared/synccrypto"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type EncryptedSyncHandler struct{ store *datasync.EncryptedStore }

func NewEncryptedSyncHandler(database *gorm.DB) *EncryptedSyncHandler {
	return &EncryptedSyncHandler{store: &datasync.EncryptedStore{DB: database}}
}
func encryptedError(c *gin.Context, err error) {
	status := http.StatusConflict
	if errors.Is(err, gorm.ErrRecordNotFound) {
		status = http.StatusNotFound
	}
	RespondError(c, status, "encrypted_sync_failed", err.Error())
}
func (h *EncryptedSyncHandler) ManifestChain(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	after, err := strconv.ParseUint(c.DefaultQuery("after", "0"), 10, 32)
	if err != nil {
		RespondError(c, 400, "invalid_revision", "Invalid manifest revision")
		return
	}
	chain, err := h.store.Chain(c.Request.Context(), owner, uint32(after))
	if err != nil {
		encryptedError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, chain)
}
func (h *EncryptedSyncHandler) PublishManifest(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<20)
	var manifest synccrypto.Manifest
	if c.ShouldBindJSON(&manifest) != nil {
		RespondError(c, 400, "invalid_manifest", "Invalid encrypted workspace manifest")
		return
	}
	if err := h.store.PublishManifest(c.Request.Context(), owner, manifest); err != nil {
		encryptedError(c, err)
		return
	}
	c.JSON(200, gin.H{"hash": manifest.Hash()})
}
func (h *EncryptedSyncHandler) Heads(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	heads, err := h.store.Heads(c.Request.Context(), owner)
	if err != nil {
		encryptedError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, heads)
}
func (h *EncryptedSyncHandler) GetObject(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	object, err := h.store.Object(c.Request.Context(), owner, c.Param("id"))
	if err != nil {
		encryptedError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, object)
}
func (h *EncryptedSyncHandler) PutObject(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 12<<20)
	var object synccrypto.Object
	if c.ShouldBindJSON(&object) != nil {
		RespondError(c, 400, "invalid_object", "Invalid encrypted object")
		return
	}
	if err := h.store.PutObject(c.Request.Context(), owner, object); err != nil {
		encryptedError(c, err)
		return
	}
	c.JSON(200, gin.H{"id": object.ID})
}
func (h *EncryptedSyncHandler) SaveRoute(c *gin.Context) {
	owner, ok := requireCurrentUserID(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	var route datasync.RelayRoute
	if c.ShouldBindJSON(&route) != nil {
		RespondError(c, 400, "invalid_route", "Invalid relay route")
		return
	}
	if err := h.store.SaveRoute(c.Request.Context(), owner, route); err != nil {
		encryptedError(c, err)
		return
	}
	c.Status(204)
}
