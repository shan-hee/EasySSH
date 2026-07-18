package middleware

import (
	"github.com/easyssh/server/internal/domain/security"
	"github.com/gin-gonic/gin"
	"github.com/unrolled/secure"
)

// SecurityHeaders 安全响应头中间件
// 设置常见的安全 HTTP 响应头,防止 XSS、点击劫持等攻击
func SecurityHeaders(isDevelopment bool) gin.HandlerFunc {
	secureMiddleware := secure.New(secure.Options{
		BrowserXssFilter:          true,
		ContentTypeNosniff:        true,
		FrameDeny:                 true,
		IsDevelopment:             isDevelopment,
		STSSeconds:                31536000,
		STSIncludeSubdomains:      true,
		ReferrerPolicy:            "strict-origin-when-cross-origin",
		PermissionsPolicy:         "geolocation=(), microphone=(), camera=()",
		CrossOriginOpenerPolicy:   "unsafe-none",
		CrossOriginEmbedderPolicy: "unsafe-none",
	})

	return func(c *gin.Context) {
		if err := secureMiddleware.Process(c.Writer, c.Request); err != nil {
			c.Abort()
			return
		}

		csp := security.DefaultContentSecurityPolicy
		if config, ok := GetSecurityConfigFromContext(c); ok {
			csp = config.EffectiveContentSecurityPolicy()
		}
		c.Header("Content-Security-Policy", csp)

		c.Next()
	}
}
