package rest

import (
	"net/http"
	"strings"

	"github.com/easyssh/server/internal/domain/useraiconfig"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// UserAIConfigHandler 用户AI配置处理器
type UserAIConfigHandler struct {
	service useraiconfig.Service
}

// NewUserAIConfigHandler 创建用户AI配置处理器
func NewUserAIConfigHandler(service useraiconfig.Service) *UserAIConfigHandler {
	return &UserAIConfigHandler{
		service: service,
	}
}

// SaveUserAIConfigRequest 保存用户AI配置请求
type SaveUserAIConfigRequest struct {
	UseSystemConfig bool   `json:"use_system_config"`
	CustomEnabled   bool   `json:"custom_enabled"`
	CustomProvider  string `json:"custom_provider"`
	CustomAPIKey    string `json:"custom_api_key"`
	CustomEndpoint  string `json:"custom_endpoint"`
	CustomModels    string `json:"custom_models"`
}

type ProbeUserAIModelsRequest struct {
	CustomProvider string `json:"custom_provider"`
	CustomAPIKey   string `json:"custom_api_key,omitempty"`
	CustomEndpoint string `json:"custom_endpoint,omitempty"`
}

// GetUserAIConfig 获取当前用户的AI配置
// GET /api/v1/user/ai-config
func (h *UserAIConfigHandler) GetUserAIConfig(c *gin.Context) {
	// 从上下文获取当前用户ID
	userID, exists := c.Get("user_id")
	if !exists {
		RespondError(c, http.StatusUnauthorized, "UNAUTHORIZED", "User not authenticated")
		return
	}

	// 类型断言为string
	uidStr, ok := userID.(string)
	if !ok {
		RespondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Invalid user ID format")
		return
	}

	// 解析UUID
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	config, err := h.service.GetUserConfig(c.Request.Context(), uid)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	// 不返回敏感信息（API密钥）给前端，只返回是否已设置
	response := gin.H{
		"use_system_config": config.UseSystemConfig,
		"custom_enabled":    config.CustomEnabled,
		"custom_provider":   config.CustomProvider,
		"custom_endpoint":   config.CustomEndpoint,
		"custom_models":     config.CustomModels,
		"has_api_key":       config.CustomAPIKey != "",
	}

	c.JSON(http.StatusOK, response)
}

// SaveUserAIConfig 保存当前用户的AI配置
// PUT /api/v1/user/ai-config
func (h *UserAIConfigHandler) SaveUserAIConfig(c *gin.Context) {
	// 从上下文获取当前用户ID
	userID, exists := c.Get("user_id")
	if !exists {
		RespondError(c, http.StatusUnauthorized, "UNAUTHORIZED", "User not authenticated")
		return
	}

	// 类型断言为string
	uidStr, ok := userID.(string)
	if !ok {
		RespondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Invalid user ID format")
		return
	}

	// 解析UUID
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	var req SaveUserAIConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	// 构建配置对象
	config := &useraiconfig.UserAIConfig{
		UserID:          uid,
		UseSystemConfig: req.UseSystemConfig,
		CustomEnabled:   req.CustomEnabled,
		CustomProvider:  req.CustomProvider,
		CustomAPIKey:    req.CustomAPIKey,
		CustomEndpoint:  req.CustomEndpoint,
		CustomModels:    req.CustomModels,
	}

	// 保存配置
	if err := h.service.SaveUserConfig(c.Request.Context(), config); err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_CONFIG", err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "AI configuration saved successfully",
	})
}

// ProbeUserAIModels 使用当前用户的自定义配置拉取上游模型列表。
func (h *UserAIConfigHandler) ProbeUserAIModels(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		RespondError(c, http.StatusUnauthorized, "UNAUTHORIZED", "User not authenticated")
		return
	}

	uidStr, ok := userID.(string)
	if !ok {
		RespondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Invalid user ID format")
		return
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	var req ProbeUserAIModelsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	provider := strings.TrimSpace(req.CustomProvider)
	apiKey := strings.TrimSpace(req.CustomAPIKey)
	endpoint := strings.TrimSpace(req.CustomEndpoint)
	if provider == "" || apiKey == "" || endpoint == "" {
		existing, loadErr := h.service.GetUserConfig(c.Request.Context(), uid)
		if loadErr == nil && existing != nil {
			if provider == "" {
				provider = existing.CustomProvider
			}
			if apiKey == "" {
				apiKey = existing.CustomAPIKey
			}
			if endpoint == "" {
				endpoint = existing.CustomEndpoint
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

// DeleteUserAIConfig 删除当前用户的AI配置（恢复使用系统配置）
// DELETE /api/v1/user/ai-config
func (h *UserAIConfigHandler) DeleteUserAIConfig(c *gin.Context) {
	// 从上下文获取当前用户ID
	userID, exists := c.Get("user_id")
	if !exists {
		RespondError(c, http.StatusUnauthorized, "UNAUTHORIZED", "User not authenticated")
		return
	}

	// 类型断言为string
	uidStr, ok := userID.(string)
	if !ok {
		RespondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", "Invalid user ID format")
		return
	}

	// 解析UUID
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		RespondError(c, http.StatusBadRequest, "INVALID_USER_ID", "Invalid user ID")
		return
	}

	if err := h.service.DeleteUserConfig(c.Request.Context(), uid); err != nil {
		RespondError(c, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "AI configuration deleted successfully",
	})
}
