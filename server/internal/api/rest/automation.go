package rest

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/domain/automation"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type AutomationHandler struct {
	service  *automation.Service
	mcp      http.Handler
	security security.Service
	devPort  int
}

func NewAutomationHandler(service *automation.Service, securityService security.Service, devPort int) *AutomationHandler {
	server := mcp.NewServer(&mcp.Implementation{Name: "EasySSH", Version: "1.0.0"}, nil)
	for _, spec := range service.Tools() {
		name := spec.Name
		server.AddTool(&mcp.Tool{Name: name, Description: spec.Description, InputSchema: spec.Parameters}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			value, err := service.Call(ctx, name, req.Params.Arguments)
			if err != nil {
				return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}, nil
			}
			data, err := json.Marshal(value)
			if err != nil {
				return nil, err
			}
			var status struct {
				IsError   bool `json:"is_error"`
				Unknown   bool `json:"unknown"`
				Cancelled bool `json:"cancelled"`
			}
			_ = json.Unmarshal(data, &status)
			return &mcp.CallToolResult{IsError: status.IsError || status.Unknown || status.Cancelled, Content: []mcp.Content{&mcp.TextContent{Text: string(data)}}}, nil
		})
	}
	return &AutomationHandler{service: service, mcp: mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true}), security: securityService, devPort: devPort}
}
func (h *AutomationHandler) MCP(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if !strings.HasPrefix(c.GetHeader("Authorization"), "Bearer ess_api_") {
		c.AbortWithStatusJSON(401, gin.H{"error": "automation_token_required"})
		return
	}
	if c.GetHeader("Origin") != "" && !middleware.IsAllowedOrigin(c.Request, h.security, h.devPort) {
		c.AbortWithStatus(403)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	h.mcp.ServeHTTP(c.Writer, c.Request)
}
func (h *AutomationHandler) Call(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	var args json.RawMessage
	if err := c.ShouldBindJSON(&args); err != nil {
		RespondError(c, 400, "invalid_arguments", "Invalid JSON arguments")
		return
	}
	value, err := h.service.Call(c.Request.Context(), c.Param("name"), args)
	if err != nil {
		if errors.Is(err, automation.ErrInvalidArguments) {
			RespondError(c, http.StatusBadRequest, "invalid_arguments", err.Error())
			return
		}
		if errors.Is(err, automation.ErrUnknownTool) {
			RespondError(c, http.StatusNotFound, "unknown_tool", "Unknown automation tool")
			return
		}
		accessError(c, err)
		return
	}
	c.JSON(200, value)
}

func (h *AutomationHandler) Catalog(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	items := make([]gin.H, 0)
	for _, tool := range h.service.Tools() {
		items = append(items, gin.H{"name": tool.Name, "description": tool.Description, "input_schema": tool.Parameters})
	}
	c.JSON(200, items)
}
