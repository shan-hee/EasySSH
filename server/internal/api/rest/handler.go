package rest

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// ErrorResponse 错误响应结构
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

// ErrorResponseWithDetails 带详细信息的错误响应结构
type ErrorResponseWithDetails struct {
	Error   string      `json:"error"`
	Message string      `json:"message,omitempty"`
	Details interface{} `json:"details,omitempty"`
}

// PaginatedResponse 分页响应结构
type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Total      int64       `json:"total"`
	Page       int         `json:"page"`
	Limit      int         `json:"limit"`
	TotalPages int         `json:"total_pages"`
}

// RespondError 返回错误响应
func RespondError(c *gin.Context, statusCode int, errCode string, message string) {
	c.JSON(statusCode, ErrorResponse{
		Error:   errCode,
		Message: message,
	})
}

// RespondErrorWithDetails 返回带详细信息的错误响应
// 用于需要返回结构化错误详情的场景（如冲突、验证错误等）
func RespondErrorWithDetails(c *gin.Context, statusCode int, errCode string, message string, details interface{}) {
	c.JSON(statusCode, ErrorResponseWithDetails{
		Error:   errCode,
		Message: message,
		Details: details,
	})
}

// RespondSuccess 返回成功响应
func RespondSuccess(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, data)
}

// RespondSuccessWithMessage 返回带消息的成功响应
func RespondSuccessWithMessage(c *gin.Context, data interface{}, message string) {
	if data == nil {
		c.JSON(http.StatusOK, gin.H{"message": message})
		return
	}
	c.JSON(http.StatusOK, data)
}

// RespondCreated 返回创建成功响应
func RespondCreated(c *gin.Context, data interface{}) {
	c.JSON(http.StatusCreated, data)
}

// RespondNoContent 返回无内容响应
func RespondNoContent(c *gin.Context) {
	c.Status(http.StatusNoContent)
}

// RespondPaginated 返回分页响应
func RespondPaginated(c *gin.Context, data interface{}, total int64, page, limit int) {
	totalPages := int(total) / limit
	if int(total)%limit > 0 {
		totalPages++
	}

	c.JSON(http.StatusOK, PaginatedResponse{
		Data:       data,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	})
}

// GetPaginationParams 获取分页参数
func GetPaginationParams(c *gin.Context) (limit, offset int) {
	page, limit := 1, 20
	if value, err := strconv.Atoi(c.Query("page")); err == nil && value > 0 && value <= 1000000 {
		page = value
	}
	if value, err := strconv.Atoi(c.Query("limit")); err == nil && value > 0 && value <= 100 {
		limit = value
	}
	return limit, (page - 1) * limit
}
