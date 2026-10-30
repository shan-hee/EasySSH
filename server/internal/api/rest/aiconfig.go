package rest

import (
	"context"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/aiconfig"
	sharedconfig "github.com/easyssh/shared/aiconfig"
	"github.com/easyssh/shared/aiprovider"
	"github.com/easyssh/shared/protocol"
	"github.com/gin-gonic/gin"
)

const aiModelProbeTimeout = 20 * time.Second

type AIConfigHandler struct{ service aiconfig.Service }

func NewAIConfigHandler(service aiconfig.Service) *AIConfigHandler {
	return &AIConfigHandler{service: service}
}
func aiConfigError(c *gin.Context, err error) {
	if errors.Is(err, sharedconfig.ErrInvalid) {
		RespondError(c, http.StatusBadRequest, "invalid_ai_config", err.Error())
		return
	}
	log.Printf("[AIConfig] storage: %v", err)
	RespondError(c, http.StatusInternalServerError, "ai_config_unavailable", "AI configuration storage is unavailable")
}
func (h *AIConfigHandler) Get(c *gin.Context) {
	config, err := h.service.Get(c.Request.Context())
	if err != nil {
		aiConfigError(c, err)
		return
	}
	RespondSuccess(c, sharedconfig.Public(config.Input()))
}
func (h *AIConfigHandler) Save(c *gin.Context) {
	var input protocol.AIConfigInput
	if !accessBody(c, &input) {
		return
	}
	result, err := h.service.Save(c.Request.Context(), input)
	if err != nil {
		aiConfigError(c, err)
		return
	}
	RespondSuccess(c, result)
}
func (h *AIConfigHandler) Reset(c *gin.Context) {
	if err := h.service.Reset(c.Request.Context()); err != nil {
		aiConfigError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *AIConfigHandler) ProbeModels(c *gin.Context) {
	var input protocol.AIModelsProbeInput
	if !accessBody(c, &input) {
		return
	}
	current, err := h.service.Get(c.Request.Context())
	if err != nil {
		aiConfigError(c, err)
		return
	}
	input, err = sharedconfig.ResolveProbe(input, current.Input())
	if err != nil {
		aiConfigError(c, err)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), aiModelProbeTimeout)
	defer cancel()
	models, err := aiprovider.NewFactory().ListModels(ctx, aiprovider.Config{Provider: input.Provider, Endpoint: input.Endpoint, APIKey: *input.APIKey})
	if err != nil {
		log.Printf("[AIConfig] model probe failed: provider=%s endpoint=%s", input.Provider, endpointForLog(input.Endpoint))
		RespondError(c, http.StatusBadRequest, "ai_probe_failed", "Unable to retrieve models from the AI provider")
		return
	}
	if models == nil {
		models = []string{}
	}
	RespondSuccess(c, protocol.AIModelsProbeResult{Available: true, Models: models})
}
func endpointForLog(endpoint string) string {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil {
		return "<invalid endpoint>"
	}
	parsed.User, parsed.RawQuery, parsed.Fragment = nil, "", ""
	return parsed.String()
}
