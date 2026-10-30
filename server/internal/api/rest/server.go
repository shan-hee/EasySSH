package rest

import (
	"errors"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/sshkey"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/servertag"
	"net/http"

	"github.com/easyssh/server/internal/domain/server"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ServerHandler 服务器处理器
type ServerHandler struct {
	serverService server.Service
}

// NewServerHandler 创建服务器处理器
func NewServerHandler(serverService server.Service) *ServerHandler {
	return &ServerHandler{
		serverService: serverService,
	}
}

// Create 创建服务器
// POST /api/v1/servers
func (h *ServerHandler) Create(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var req protocol.ServerCreate
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	// 创建服务器
	srv, err := h.serverService.Create(c.Request.Context(), access.Current(c.Request.Context()), &req)
	if err != nil {
		serverError(c, err)
		return
	}

	RespondCreated(c, srv.ToPublic())
}

// List 获取服务器列表
// GET /api/v1/servers
func (h *ServerHandler) List(c *gin.Context) {
	var req protocol.ServerListRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_query", err.Error())
		return
	}
	if req.Page < 0 || req.Page > 1000000 || req.Limit < 0 || req.Limit > 100 {
		RespondError(c, http.StatusBadRequest, "invalid_server_query", "Invalid page or limit")
		return
	}
	if req.Page == 0 {
		req.Page = 1
	}
	if req.Limit == 0 {
		req.Limit = 20
	}
	limit, offset := req.Limit, (req.Page-1)*req.Limit
	query, group, tag := req.Search, req.GroupID, req.Tag
	if tag != "" {
		if _, err := servertag.Normalize([]string{tag}); err != nil {
			RespondError(c, http.StatusBadRequest, "invalid_tags", err.Error())
			return
		}
	}
	if group != "" {
		id, err := uuid.Parse(group)
		if err != nil || id == uuid.Nil || id.String() != group {
			groupError(c, server.ErrInvalidGroup)
			return
		}
	}

	var servers []*server.Server
	var total int64
	var err error

	if query != "" || tag != "" {
		// 搜索模式
		servers, total, err = h.serverService.Search(c.Request.Context(), access.Current(c.Request.Context()), query, group, tag, limit, offset)
	} else if group != "" {
		// 按分组筛选
		servers, total, err = h.serverService.FindByGroup(c.Request.Context(), access.Current(c.Request.Context()), group, limit, offset)
	} else {
		// 正常列表
		servers, total, err = h.serverService.List(c.Request.Context(), access.Current(c.Request.Context()), limit, offset)
	}

	if err != nil {
		serverError(c, err)
		return
	}

	// 转换为公开信息
	publicServers := make([]protocol.Server, len(servers))
	for i, srv := range servers {
		publicServers[i] = srv.ToPublic()
	}

	// 计算分页信息
	page := (offset / limit) + 1
	RespondSuccess(c, protocol.ServerList{Data: publicServers, Total: total, Page: page, Limit: limit, TotalPages: int((total + int64(limit) - 1) / int64(limit))})
}

// GetByID 获取服务器详情
// GET /api/v1/servers/:id
func (h *ServerHandler) GetByID(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID format")
		return
	}

	// 获取服务器
	srv, err := h.serverService.GetByID(c.Request.Context(), access.Current(c.Request.Context()), serverID)
	if err != nil {
		serverError(c, err)
		return
	}

	RespondSuccess(c, srv.ToPublic())
}

// Update 更新服务器
// PUT /api/v1/servers/:id
func (h *ServerHandler) Update(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID format")
		return
	}

	// 解析请求
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	var req protocol.ServerUpdate
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	// 更新服务器
	srv, err := h.serverService.Update(c.Request.Context(), access.Current(c.Request.Context()), serverID, &req)
	if err != nil {
		serverError(c, err)
		return
	}

	RespondSuccess(c, srv.ToPublic())
}

// Delete 删除服务器
// DELETE /api/v1/servers/:id
func (h *ServerHandler) Delete(c *gin.Context) {
	// 解析服务器 ID
	serverID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		RespondError(c, http.StatusBadRequest, "invalid_server_id", "Invalid server ID format")
		return
	}

	// 删除服务器
	if err := h.serverService.Delete(c.Request.Context(), access.Current(c.Request.Context()), serverID); err != nil {
		serverError(c, err)
		return
	}

	RespondNoContent(c)
}

// GetStatistics 获取服务器统计
// GET /api/v1/servers/statistics
func (h *ServerHandler) GetStatistics(c *gin.Context) {
	// 获取统计
	stats, err := h.serverService.GetStatistics(c.Request.Context(), access.Current(c.Request.Context()))
	if err != nil {
		serverError(c, err)
		return
	}

	RespondSuccess(c, stats)
}

// Reorder 批量更新服务器排序顺序
// PATCH /api/v1/servers/reorder
func (h *ServerHandler) Reorder(c *gin.Context) {
	// 解析请求：期望一个服务器 ID 数组
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	var req protocol.ServerReorderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		RespondError(c, http.StatusBadRequest, "validation_error", err.Error())
		return
	}

	// 调用服务层更新排序
	if err := h.serverService.ReorderServers(c.Request.Context(), access.Current(c.Request.Context()), req.ServerIDs); err != nil {
		serverError(c, err)
		return
	}

	RespondSuccess(c, protocol.MessageResponse{Message: "Servers reordered successfully"})
}

// getOwnerIDFromContext 从上下文获取所有者 ID
func getOwnerIDFromContext(c *gin.Context) (uuid.UUID, error) {
	ownerIDValue, exists := middleware.OwnerIdentity(c)
	if !exists {
		return uuid.Nil, errors.New("owner not authenticated")
	}

	ownerIDString, ok := ownerIDValue.(string)
	if !ok {
		return uuid.Nil, errors.New("invalid owner ID format")
	}

	return uuid.Parse(ownerIDString)
}

func serverError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, server.ErrInvalidServer):
		RespondError(c, http.StatusBadRequest, "invalid_server", err.Error())
	case errors.Is(err, server.ErrServerNotFound):
		RespondError(c, http.StatusNotFound, "server_not_found", "Server not found")
	case errors.Is(err, servertag.ErrInvalid):
		RespondError(c, http.StatusBadRequest, "invalid_tags", err.Error())
	case errors.Is(err, server.ErrInvalidGroup), errors.Is(err, server.ErrGroupNotFound):
		groupError(c, err)
	case errors.Is(err, sshkey.ErrInvalidImport):
		RespondError(c, http.StatusBadRequest, "invalid_ssh_key", err.Error())
	default:
		accessError(c, err)
	}
}
