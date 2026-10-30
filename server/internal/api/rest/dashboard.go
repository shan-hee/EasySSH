package rest

import (
	"errors"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"net/http"

	"github.com/easyssh/server/internal/domain/dashboard"
	"github.com/gin-gonic/gin"
)

// DashboardHandler 仪表盘处理器
type DashboardHandler struct{ dashboardService dashboard.Service }

func NewDashboardHandler(service dashboard.Service) *DashboardHandler {
	return &DashboardHandler{dashboardService: service}
}

// GetOverview 获取仪表盘聚合概览
// GET /api/v1/dashboard/overview
func (h *DashboardHandler) GetOverview(c *gin.Context) {
	overview, err := h.dashboardService.GetOverview(c.Request.Context(), c.DefaultQuery("timezone", "UTC"))
	if errors.Is(err, operationrecord.ErrInvalidWindow) {
		RespondError(c, http.StatusBadRequest, "invalid_activity_window", "Use a valid IANA timezone")
		return
	}
	if err != nil {
		accessError(c, err)
		return
	}
	RespondSuccess(c, protocol.DashboardOverview{
		Activity: activityOverviewResponse(overview.Activity), Stats: overview.Stats, Distribution: overview.Distribution,
	})
}
