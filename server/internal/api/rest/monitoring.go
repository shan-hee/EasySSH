package rest

import (
	"log"
	"net/http"

	"github.com/easyssh/shared/protocol"

	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/monitoring"
	"github.com/gin-gonic/gin"
)

// MonitoringHandler 监控处理器
type MonitoringHandler struct {
	monitoringService monitoring.Service
	authService       *auth.Service
}

// NewMonitoringHandler 创建监控处理器
func NewMonitoringHandler(monitoringService monitoring.Service, authService *auth.Service) *MonitoringHandler {
	return &MonitoringHandler{
		monitoringService: monitoringService,
		authService:       authService,
	}
}

// GetAllResources 获取所有服务器的资源概览
// GET /api/v1/monitoring/resources
func (h *MonitoringHandler) GetAllResources(c *gin.Context) {
	ownerID, err := getOwnerIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	ctx := c.Request.Context()

	// 获取所有者信息（包含数据源配置）
	owner, err := h.authService.GetOwnerByID(ctx, ownerID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "owner_error", err.Error())
		return
	}

	// 使用所有者配置的数据源获取资源
	resources, err := h.monitoringService.GetAllServersResourcesWithOwner(ctx, owner)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "monitoring_error", err.Error())
		return
	}

	RespondSuccess(c, resources)
}

// TestDataSourceConnection 测试数据源连接
// POST /api/v1/monitoring/datasource/test
func (h *MonitoringHandler) TestDataSourceConnection(c *gin.Context) {
	ownerID, err := getOwnerIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	var req protocol.MonitoringDataSourceTest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)

	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	ctx := c.Request.Context()

	// 获取所有者信息（EasySSH 数据源需要所有者 ID）
	owner, err := h.authService.GetOwnerByID(ctx, ownerID)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "owner_error", err.Error())
		return
	}

	// 构建数据源配置
	config := &monitoring.DataSourceConfig{
		Type:     req.Type,
		Endpoint: req.Endpoint,
		Token:    req.Token,
	}

	// 测试连接
	if err := h.monitoringService.TestDataSourceConnection(ctx, config, owner); err != nil {
		log.Printf("[Monitoring] TestDataSourceConnection failed: type=%s, endpoint=%s, error=%v", config.Type, config.Endpoint, err)
		RespondError(c, http.StatusBadRequest, "connection_failed", err.Error())
		return
	}

	RespondSuccess(c, protocol.MessageResponse{Message: "Connection successful"})
}
