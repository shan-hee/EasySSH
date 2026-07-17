package rest

import (
	"context"
	"net/http"

	"github.com/easyssh/server/internal/domain/dashboard"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// DashboardHandler 仪表盘处理器
type DashboardHandler struct {
	dashboardService dashboard.Service
	permission       interface {
		Authorize(ctx context.Context, userID uuid.UUID, roleKey, permissionCode, resource string) (bool, error)
	}
}

// NewDashboardHandler 创建仪表盘处理器
func NewDashboardHandler(dashboardService dashboard.Service, permissionService interface {
	Authorize(ctx context.Context, userID uuid.UUID, roleKey, permissionCode, resource string) (bool, error)
}) *DashboardHandler {
	return &DashboardHandler{
		dashboardService: dashboardService,
		permission:       permissionService,
	}
}

// GetOverview 获取仪表盘聚合概览
// GET /api/v1/dashboard/overview
func (h *DashboardHandler) GetOverview(c *gin.Context) {
	// 获取当前用户
	userID, err := getUserIDFromContext(c)
	if err != nil {
		RespondError(c, http.StatusUnauthorized, "unauthorized", err.Error())
		return
	}

	var userIDPtr *uuid.UUID
	role, _ := c.Get("role")
	roleKey, _ := role.(string)
	viewAll := false
	if h.permission != nil {
		viewAll, _ = h.permission.Authorize(c.Request.Context(), userID, roleKey, "dashboard:view-all", "dashboard/*")
	}
	if !viewAll {
		userIDPtr = &userID
	}

	overview, err := h.dashboardService.GetOverview(c.Request.Context(), userIDPtr)
	if err != nil {
		RespondError(c, http.StatusInternalServerError, "overview_failed", err.Error())
		return
	}

	RespondSuccess(c, overview)
}
