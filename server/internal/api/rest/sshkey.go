package rest

import (
	"errors"
	"github.com/easyssh/shared/protocol"
	"net/http"

	"github.com/easyssh/server/internal/domain/sshkey"
	"github.com/gin-gonic/gin"
)

type SSHKeyHandler struct{ service sshkey.Service }

func NewSSHKeyHandler(service sshkey.Service) *SSHKeyHandler { return &SSHKeyHandler{service: service} }
func keyError(c *gin.Context, err error) {
	var inUse *sshkey.InUseError
	if errors.As(err, &inUse) {
		c.AbortWithStatusJSON(http.StatusConflict, protocol.SSHKeyInUse{Error: "key_in_use", References: inUse.References})
		return
	}
	if errors.Is(err, sshkey.ErrInvalidImport) {
		RespondError(c, 400, "invalid_key", err.Error())
		return
	}
	accessError(c, err)
}
func (h *SSHKeyHandler) GetSSHKeys(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	keys, err := h.service.ListKeys(c.Request.Context(), scope)
	if err != nil {
		keyError(c, err)
		return
	}
	items := make([]protocol.SSHKey, 0, len(keys))
	for _, key := range keys {
		items = append(items, key.Public())
	}
	noStoreAccess(c)
	c.JSON(http.StatusOK, items)
}
func (h *SSHKeyHandler) GenerateSSHKey(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	var req protocol.SSHKeyGenerateInput
	if !accessBody(c, &req) {
		return
	}
	key, err := h.service.GenerateKeyPair(c.Request.Context(), scope, &req)
	if err != nil {
		keyError(c, err)
		return
	}
	noStoreAccess(c)
	c.JSON(http.StatusCreated, key)
}
func (h *SSHKeyHandler) ImportSSHKey(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	var req protocol.SSHKeyImportInput
	if !accessBody(c, &req) {
		return
	}
	key, err := h.service.ImportKeyPair(c.Request.Context(), scope, &req)
	if err != nil {
		keyError(c, err)
		return
	}
	noStoreAccess(c)
	c.JSON(http.StatusCreated, key)
}
func (h *SSHKeyHandler) DeleteSSHKey(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	if err := h.service.DeleteKey(c.Request.Context(), scope, id); err != nil {
		keyError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *SSHKeyHandler) GetReferences(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	result, err := h.service.KeyReferences(c.Request.Context(), scope, id)
	if err != nil {
		keyError(c, err)
		return
	}
	noStoreAccess(c)
	c.JSON(http.StatusOK, result)
}
func (h *SSHKeyHandler) SetPassphrase(c *gin.Context) {
	scope, ok := currentAccess(c)
	if !ok {
		return
	}
	id, ok := accessID(c, "id")
	if !ok {
		return
	}
	var req protocol.SSHKeyPassphraseInput
	if !accessBody(c, &req) {
		return
	}
	if err := h.service.SetPassphrase(c.Request.Context(), scope, id, req.Passphrase, req.Save); err != nil {
		keyError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
