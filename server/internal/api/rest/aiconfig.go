package rest

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/easyssh/server/internal/domain/aiconfig"
	"github.com/easyssh/shared/aiprovider"
	"github.com/gin-gonic/gin"
)

// AIConfigHandler AI配置处理器
type AIConfigHandler struct {
	service aiconfig.Service
}

// NewAIConfigHandler 创建AI配置处理器
func NewAIConfigHandler(service aiconfig.Service) *AIConfigHandler {
	return &AIConfigHandler{service: service}
}

// AIConfigDTO AI系统配置DTO
type AIConfigDTO struct {
	SystemEnabled     bool   `json:"system_enabled"`
	SystemProvider    string `json:"system_provider"`
	SystemAPIKey      string `json:"system_api_key,omitempty"` // 保存时传入，读取时不返回
	SystemAPIEndpoint string `json:"system_api_endpoint"`
	SystemModels      string `json:"system_models"`         // 可用模型列表（逗号分隔）
	HasAPIKey         bool   `json:"has_api_key,omitempty"` // 仅读取时返回，表示是否已配置
}

type AIModelsProbeRequestDTO struct {
	SystemProvider    string `json:"system_provider"`
	SystemAPIKey      string `json:"system_api_key,omitempty"`
	SystemAPIEndpoint string `json:"system_api_endpoint,omitempty"`
}

type AIModelsProbeResponseDTO struct {
	Available bool     `json:"available"`
	Models    []string `json:"models"`
	Message   string   `json:"message,omitempty"`
}

func probeAIModels(ctx context.Context, provider, apiKey, endpoint string) (AIModelsProbeResponseDTO, error) {
	requestContext, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	models, err := aiprovider.NewFactory().ListModels(requestContext, aiprovider.Config{
		Provider: provider,
		APIKey:   apiKey,
		Endpoint: endpoint,
	})
	if errors.Is(err, aiprovider.ErrModelListingUnsupported) {
		return AIModelsProbeResponseDTO{
			Available: false,
			Models:    []string{},
			Message:   "Anthropic model auto-fetch is not supported yet, please input models manually",
		}, nil
	}
	if err != nil {
		return AIModelsProbeResponseDTO{}, err
	}

	return AIModelsProbeResponseDTO{
		Available: true,
		Models:    models,
		Message:   "Model list fetched successfully",
	}, nil
}

// GetSystemAIConfig 获取系统级AI配置
// @Summary 获取系统级AI配置
// @Tags AI设置
// @Accept json
// @Produce json
// @Success 200 {object} AIConfigDTO
// @Router /api/v1/settings/ai/system [get]
func (h *AIConfigHandler) GetSystemAIConfig(c *gin.Context) {
	config, err := h.service.GetSystemConfig(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	dto := &AIConfigDTO{
		SystemEnabled:     config.SystemEnabled,
		SystemProvider:    config.SystemProvider,
		SystemAPIEndpoint: config.SystemAPIEndpoint,
		SystemModels:      config.SystemModels,
		HasAPIKey:         config.SystemAPIKey != "",
	}

	c.JSON(http.StatusOK, dto)
}

// SaveSystemAIConfig 保存系统级AI配置
// @Summary 保存系统级AI配置
// @Tags AI设置
// @Accept json
// @Produce json
// @Param request body AIConfigDTO true "AI配置"
// @Success 200 {object} map[string]string
// @Router /api/v1/settings/ai/system [post]
func (h *AIConfigHandler) SaveSystemAIConfig(c *gin.Context) {
	var dto AIConfigDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	config := &aiconfig.AIConfig{
		SystemEnabled:     dto.SystemEnabled,
		SystemProvider:    dto.SystemProvider,
		SystemAPIKey:      dto.SystemAPIKey,
		SystemAPIEndpoint: dto.SystemAPIEndpoint,
		SystemModels:      dto.SystemModels,
	}

	if err := h.service.SaveSystemConfig(c.Request.Context(), config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "System AI configuration saved successfully"})
}

// ProbeSystemAIModels 探测上游可用性并拉取模型列表
// @Summary 探测上游可用性并拉取模型列表
// @Tags AI设置
// @Accept json
// @Produce json
// @Param request body AIModelsProbeRequestDTO true "探测请求"
// @Success 200 {object} AIModelsProbeResponseDTO
// @Router /api/v1/settings/ai/system/models [post]
func (h *AIConfigHandler) ProbeSystemAIModels(c *gin.Context) {
	var req AIModelsProbeRequestDTO
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	provider := strings.ToLower(strings.TrimSpace(req.SystemProvider))
	apiKey := strings.TrimSpace(req.SystemAPIKey)
	endpoint := strings.TrimSpace(req.SystemAPIEndpoint)

	if provider == "" || apiKey == "" || endpoint == "" {
		existing, err := h.service.GetSystemConfig(c.Request.Context())
		if err == nil && existing != nil {
			if provider == "" {
				provider = strings.ToLower(strings.TrimSpace(existing.SystemProvider))
			}
			if apiKey == "" {
				apiKey = strings.TrimSpace(existing.SystemAPIKey)
			}
			if endpoint == "" {
				endpoint = strings.TrimSpace(existing.SystemAPIEndpoint)
			}
		}
	}

	if provider == "" {
		provider = "openai"
	}

	response, err := probeAIModels(c.Request.Context(), provider, apiKey, endpoint)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"available": false,
			"models":    []string{},
			"error":     err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, response)
}
