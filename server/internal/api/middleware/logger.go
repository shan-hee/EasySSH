package middleware

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

// Logger 日志中间件
func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 开始时间
		startTime := time.Now()

		// 处理请求
		c.Next()

		// 过滤健康检查和ping请求，避免日志污染
		reqURI := c.Request.RequestURI
		if reqURI == "/api/v1/ping" || reqURI == "/api/v1/health" {
			return
		}

		requestID, _ := c.Get("RequestID")
		slog.InfoContext(c.Request.Context(), "http request completed",
			"request_id", requestID,
			"method", c.Request.Method,
			"path", reqURI,
			"status", c.Writer.Status(),
			"latency", time.Since(startTime),
			"client_ip", LogClientIP(c),
			"response_size", c.Writer.Size(),
		)
	}
}
