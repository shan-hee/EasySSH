package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/api/rest"
	"github.com/easyssh/server/internal/api/staticfiles"
	"github.com/easyssh/server/internal/api/ws"
	"github.com/easyssh/server/internal/domain/auditlog"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/datasync"
	"github.com/easyssh/server/internal/domain/inboxnotification"
	"github.com/easyssh/server/internal/domain/notification"
	"github.com/easyssh/server/internal/domain/notificationconfig"
	"github.com/easyssh/server/internal/domain/oauthprovider"
	"github.com/easyssh/server/internal/domain/permission"
	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/server/internal/domain/user"
	"github.com/easyssh/server/internal/domain/verification"
	"github.com/easyssh/server/internal/infra/config"
	"github.com/easyssh/server/internal/infra/db"
	"github.com/easyssh/server/internal/pkg/geoip"
	"github.com/easyssh/server/internal/pkg/password"
	"github.com/easyssh/server/internal/platform"
	"github.com/easyssh/shared/dbmigration"
	"github.com/easyssh/shared/instanceactivation"
	"github.com/easyssh/shared/instancebackup"
	crypto "github.com/easyssh/shared/secretcrypto"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "maintenance" {
		if err := runMaintenance(os.Args[2:]); err != nil {
			log.Print(err)
			os.Exit(1)
		}
		return
	}

	// 加载根目录的 .env 文件
	if err := godotenv.Load("../.env"); err != nil {
		log.Printf("⚠️ Warning: .env file not found, using environment variables")
	}

	// 加载配置
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("❌ Failed to load config: %v", err)
	}
	if handled, err := runInstanceLauncher(cfg); handled {
		if err != nil {
			log.Fatal(err)
		}
		return
	}
	launcher := instanceactivation.FromEnvironment()
	configureLogging(cfg.Server.Env)
	instanceLock, err := instancebackup.Lock(maintenanceDataDir(cfg))
	if err != nil {
		log.Fatal(err)
	}
	defer instanceLock.Close()

	// 设置 Gin 模式
	if cfg.Server.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	runtimeInfo := platform.NewRuntimeInfo(platform.RuntimeOptions{
		Profile: platform.ProfileFromEnvironment(),
		DataDir: maintenanceDataDir(cfg),
		Version: readAppVersion(),
	})

	// Reserve one connection for the instance advisory lock.
	if cfg.Database.Driver != "sqlite" && cfg.Database.MaxOpenConns < 2 {
		cfg.Database.MaxOpenConns = 2
	}
	// 初始化数据库
	database, err := db.NewDB(&cfg.Database)
	if err != nil {
		log.Fatalf("❌ Failed to connect to database: %v", err)
	}
	defer db.Close(database)

	sqlDB, err := database.DB()
	if err != nil {
		log.Fatal(err)
	}
	releaseDatabase, err := instancebackup.DatabaseLock(context.Background(), sqlDB, cfg.Database.Driver)
	if err != nil {
		log.Fatal(err)
	}
	defer releaseDatabase()
	if err := dbmigration.Start(context.Background(), sqlDB, "server", cfg.Database.Driver); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	// 统一加密器（用于所有需要再次使用的敏感凭据）
	encryptor, err := crypto.NewEncryptor(cfg.Server.EncryptionKey)
	if err != nil {
		log.Fatalf("❌ Failed to create encryptor: %v", err)
	}
	if launcher != nil {
		if err := rest.VerifyStoredCredentials(context.Background(), database, encryptor); err != nil {
			log.Fatal(err)
		}
	}
	oauthGlobalSecret, err := crypto.DeriveKey(cfg.Server.EncryptionKey, "oauth-global-secret", 32)
	if err != nil {
		log.Fatalf("❌ Failed to derive OAuth key: %v", err)
	}
	csrfSecret, err := crypto.DeriveKey(cfg.Server.EncryptionKey, "csrf-cookie", 32)
	if err != nil {
		log.Fatalf("❌ Failed to derive CSRF key: %v", err)
	}

	// 数据库中的系统设置承载业务与运行参数；根密钥和数据库连接仍由部署配置提供。
	systemConfigRepo := systemconfig.NewRepository(database)
	systemConfigService := systemconfig.NewService(systemConfigRepo, encryptor, cfg.Server.Env == "production")
	systemCfg, err := systemConfigService.Get(context.Background())
	if err != nil {
		log.Fatalf("❌ Failed to load system config: %v", err)
	}
	securityRepo := security.NewRepository(database)
	securityService := security.NewService(securityRepo)
	securityCfg, err := securityService.Get(context.Background())
	if err != nil {
		log.Fatalf("❌ Failed to load security config: %v", err)
	}
	password.SetPwnedCheckEnabled(securityCfg.PasswordPwnedCheckEnabled)

	geoipClient := geoip.NewClient()
	log.Println("🌍 GeoIP provider: ipwho.is")

	oauthTokenSettings := systemCfg.OAuthTokenConfig()
	externalOAuthConfigErr := oauthTokenSettings.ValidateExternalProvider(cfg.Server.Env == "production")
	externalOAuthProviderGate, err := oauthprovider.NewExternalProviderGate(
		externalOAuthConfigErr == nil,
		oauthTokenSettings.ExternalOAuthProviderEnabled,
	)
	if err != nil {
		log.Fatalf("❌ Failed to configure external OAuth/OIDC Provider: %v (%v)", err, externalOAuthConfigErr)
	}

	// 初始化服务层
	accessTokenDuration := time.Duration(oauthTokenSettings.AccessTokenMinutes) * time.Minute
	refreshTokenDuration := time.Duration(oauthTokenSettings.RefreshTokenDays) * 24 * time.Hour

	oauthProvider, err := oauthprovider.New(database, encryptor, oauthprovider.Config{
		Issuer:                oauthTokenSettings.Issuer,
		ExternalProviderGate:  externalOAuthProviderGate,
		GlobalSecret:          oauthGlobalSecret,
		AccessTokenLifespan:   accessTokenDuration,
		RefreshTokenLifespan:  refreshTokenDuration,
		AuthorizeCodeLifespan: 5 * time.Minute,
		WebRedirectURIs:       oauthTokenSettings.RedirectURIList(),
	})
	if err != nil {
		log.Fatalf("❌ Failed to initialize OAuth/OIDC provider: %v", err)
	}

	// 一次性 Ticket：进程内短期存储（用于 WebSocket 握手 / 原生下载等无法附带 Authorization Header 的场景）
	ticketService := auth.NewTicketService(database, auth.TicketConfig{
		TTL: 30 * time.Second,
	})

	authRepo := auth.NewRepository(database)
	authService := auth.NewService(authRepo, oauthProvider, encryptor)

	// 通知配置服务
	notificationConfigRepo := notificationconfig.NewRepository(database)
	notificationConfigService := notificationconfig.NewService(notificationConfigRepo, encryptor)

	log.Println("✅ New configuration services initialized")

	// 邮件服务(支持动态配置)
	// 从新的通知配置服务加载 SMTP 配置
	var emailService notification.EmailService
	smtpConfig, err := notificationConfigService.GetSMTPConfig(context.Background())
	if err == nil && smtpConfig != nil && smtpConfig.Enabled {
		// 获取系统配置用于邮件模板
		sysConfig, _ := systemConfigService.Get(context.Background())
		systemName := "EasySSH"
		if sysConfig != nil && sysConfig.SystemName != "" {
			systemName = sysConfig.SystemName
		}

		// 从数据库加载成功且启用了邮件服务
		emailService, err = notification.NewEmailService(&notification.EmailConfig{
			SMTPHost:     smtpConfig.Host,
			SMTPPort:     smtpConfig.Port,
			SMTPUsername: smtpConfig.Username,
			SMTPPassword: smtpConfig.Password,
			FromEmail:    smtpConfig.FromEmail,
			FromName:     smtpConfig.FromName,
			UseTLS:       smtpConfig.UseTLS,
			SystemName:   systemName,
			CurrentYear:  time.Now().Year(),
		})
		if err != nil {
			log.Printf("⚠️ Warning: Failed to initialize email service: %v", err)
		} else {
			log.Println("✅ Email service initialized from database configuration")
		}
	} else {
		log.Println("ℹ️  Email service is disabled (configure via Web UI: Settings > Notifications > SMTP)")
	}

	// 注入邮件服务到认证服务
	if emailService != nil {
		type emailServiceSetter interface {
			SetEmailService(auth.EmailService)
		}
		if setter, ok := authService.(emailServiceSetter); ok {
			setter.SetEmailService(emailService)
		}
	}

	// 账户锁定服务（进程内短期计数 + 数据库账户锁定状态）
	lockConfig := auth.DefaultAccountLockConfig
	if securityConfig, err := securityService.GetAccountLockConfig(context.Background()); err == nil {
		lockConfig = auth.AccountLockConfig{
			Enabled:                securityConfig.Enabled,
			MaxIPFailAttempts:      securityConfig.MaxIPFailAttempts,
			IPLockDuration:         time.Duration(securityConfig.IPLockDurationMinutes) * time.Minute,
			MaxAccountFailAttempts: securityConfig.MaxAccountFailAttempts,
			AccountLockDuration:    time.Duration(securityConfig.AccountLockDurationMinutes) * time.Minute,
			FailCountWindow:        15 * time.Minute, // 默认 15 分钟窗口
		}
	}
	loginAttemptRepo := auth.NewLoginAttemptRepository(database)
	accountLockService := auth.NewAccountLockService(
		loginAttemptRepo,
		authRepo,
		lockConfig,
	)
	log.Println("✅ Account lock service initialized")

	type accountLockServiceSetter interface {
		SetAccountLockService(auth.AccountLockService)
	}
	if setter, ok := authService.(accountLockServiceSetter); ok {
		setter.SetAccountLockService(accountLockService)
	}

	// 登录检测服务（需要数据库）
	var loginDetectionService auth.LoginDetectionService
	trustedDeviceRepo := auth.NewTrustedDeviceRepository(database)
	loginAlertRepo := auth.NewLoginAlertRepository(database)
	loginDetectionService = auth.NewLoginDetectionService(trustedDeviceRepo, loginAlertRepo, authRepo, geoipClient, emailService)
	log.Println("✅ Login detection service initialized")

	// 注入登录检测服务到认证服务
	type loginDetectionServiceSetter interface {
		SetLoginDetectionService(auth.LoginDetectionService)
	}
	if setter, ok := authService.(loginDetectionServiceSetter); ok {
		setter.SetLoginDetectionService(loginDetectionService)
	}

	// 验证码服务（进程内短期存储）
	verificationService := verification.NewService()
	log.Println("✅ Verification service initialized")

	auditLogRepo := auditlog.NewRepository(database)
	auditLogService := auditlog.NewService(auditLogRepo)
	realtimeHub := realtime.NewHub()
	inboxNotificationRepo := inboxnotification.NewRepository(database)
	inboxNotificationService := inboxnotification.NewService(inboxNotificationRepo, realtimeHub)

	// Casbin RBAC 服务（角色、继承、全局权限和资源级授权）
	permissionService, err := permission.NewService(database)
	if err != nil {
		log.Fatalf("❌ Failed to initialize Casbin RBAC: %v", err)
	}
	if err := permissionService.EnsureDefaults(context.Background()); err != nil {
		log.Fatalf("❌ Failed to ensure default RBAC roles: %v", err)
	} else {
		log.Println("✅ Casbin RBAC policies loaded")
	}

	// 用户管理服务
	userRepo := user.NewRepository(database)
	userService := user.NewService(userRepo, permissionService)

	// 令牌有效期（秒），用于 Cookie 和 API 响应
	accessTokenTTLSeconds := int(accessTokenDuration.Seconds())
	refreshTokenTTLSeconds := int(refreshTokenDuration.Seconds())

	// 初始化处理器
	authHandler := rest.NewAuthHandler(
		authService,
		oauthProvider,
		securityService,
		accessTokenTTLSeconds,
		refreshTokenTTLSeconds,
		systemConfigService,
		verificationService,
		emailService,
		permissionService,
	)
	oauthHandler := rest.NewOAuthHandler(
		authService,
		oauthProvider,
		systemConfigService,
		securityService,
		accessTokenTTLSeconds,
		refreshTokenTTLSeconds,
	)
	oauthProviderHandler := rest.NewOAuthProviderHandler(oauthProvider, oauthTokenSettings.LoginURL)
	sshRelayHandler := ws.NewSSHRelayHandler(database, securityService, cfg.Server.WebDevPort, cfg.Server.RelayNetworks, cfg.Server.RelayPorts)
	encryptedSyncHandler := rest.NewEncryptedSyncHandler(database)
	auditLogHandler := rest.NewAuditLogHandler(auditLogService)
	ticketHandler := rest.NewTicketHandler(ticketService)
	inboxNotificationHandler := rest.NewInboxNotificationHandler(inboxNotificationService)
	realtimeHandler := rest.NewRealtimeHandler(realtimeHub)
	userHandler := rest.NewUserHandler(userService, accountLockService)
	permissionHandler := rest.NewPermissionHandler(permissionService)
	// 新的配置处理器
	securityHandler := rest.NewSecurityHandler(securityService)
	systemConfigHandler := rest.NewSystemConfigHandler(systemConfigService, permissionService, externalOAuthProviderGate)
	notificationConfigHandler := rest.NewNotificationConfigHandler(notificationConfigService)
	// 其他处理器
	avatarHandler := rest.NewAvatarHandler()
	instanceHistory, err := newInstanceHistory(cfg, database, func(capture func() error) error { return capture() })
	if err != nil {
		log.Fatalf("Failed to initialize backup history: %v", err)
	}
	defer instanceHistory.Close()
	instanceBackupHandler := rest.NewInstanceBackupHandler(instanceHistory, cfg.Database.Driver == "sqlite" || os.Getenv("EASYSSH_RESTORE_DSN") != "")
	instanceBackupHandler.SetActivation(launcher)

	syncHandler := rest.NewSyncHandler(&datasync.Service{DB: database}, permissionService)
	runtimeHandler := rest.NewRuntimeHandler(runtimeInfo)
	updateCheckHandler := rest.NewUpdateCheckHandler(runtimeInfo)

	// 创建 Gin 路由
	r := gin.New()
	if err := r.SetTrustedProxies(securityCfg.TrustedProxyList()); err != nil {
		log.Fatalf("❌ Failed to configure trusted proxies: %v", err)
	}

	// 从系统配置加载最大上传大小
	systemConfig, err := systemConfigService.Get(context.Background())
	if err == nil {
		// 设置 Gin 的最大上传内存（转换为字节：MB -> Bytes）
		r.MaxMultipartMemory = int64(systemConfig.MaxFileUploadSize) << 20
		log.Printf("✅ Max file upload size set to %d MB", systemConfig.MaxFileUploadSize)
	} else {
		log.Printf("⚠️  Failed to load max file upload size, using default (32 MB): %v", err)
	}

	// 全局中间件
	r.Use(middleware.Recovery())                                       // 错误恢复
	r.Use(middleware.Logger())                                         // 日志记录
	r.Use(middleware.RequestID())                                      // 请求 ID
	r.Use(middleware.SecurityConfigCache(securityService))             // 请求级安全配置快照
	r.Use(middleware.SecurityHeaders(cfg.Server.Env != "production"))  // 安全响应头
	r.Use(middleware.CORS(cfg, securityService))                       // 跨域（支持动态配置）
	r.Use(middleware.CSRFMiddleware(cfg, securityService, csrfSecret)) // Cookie 凭证端点 CSRF 防护
	r.Use(middleware.OptionalIPWhitelistMiddleware(securityService))   // IP 访问控制验证（可选）

	// API v1 路由组
	openAPIValidation := middleware.OpenAPIRequestValidation()
	v1 := r.Group("/api/v1")
	{
		v1.GET("/runtime", runtimeHandler.GetRuntime)
		v1.GET("/updates/check", updateCheckHandler.Check)
		v1.GET("/backup/activation/status/:operationId", instanceBackupHandler.ActivationStatus)

		// 健康检查
		v1.GET("/health", func(c *gin.Context) {
			// 检查数据库连接
			dbStatus := "ok"
			dbCtx, cancel := context.WithTimeout(c.Request.Context(), 500*time.Millisecond)
			defer cancel()
			if err := db.HealthCheckContext(dbCtx, database); err != nil {
				dbStatus = "error: " + err.Error()
			}

			c.JSON(http.StatusOK, gin.H{
				"status":  "ok",
				"service": "easyssh-api",
				"version": runtimeInfo.Version,
				"dependencies": gin.H{
					"database": dbStatus,
				},
			})
		})

		// Ping 端点（用于延迟测量）
		v1.HEAD("/ping", func(c *gin.Context) {
			c.Status(http.StatusOK)
		})
		v1.GET("/ping", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"pong": time.Now().UnixMilli()})
		})

		// 认证路由（公开）
		authRoutes := v1.Group("/auth")
		authRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			authRoutes.POST("/send-verification-code", authHandler.SendVerificationCode)
			authRoutes.POST("/send-password-reset-code", authHandler.SendPasswordResetCode)
			authRoutes.POST("/reset-password", authHandler.ResetPassword)
			authRoutes.POST("/register", authHandler.Register)
			// 使用可选认证中间件，支持未登录和已登录状态
			authRoutes.GET("/status", middleware.OptionalAuth(oauthProvider, ticketService, authRepo), authHandler.CheckStatus) // 检查系统和认证状态
			authRoutes.GET("/csrf", authHandler.CSRFToken)                                                                      // 获取 CSRF token
			// 一次性 Ticket（需认证，用于 WS/下载握手）
			authRoutes.POST("/ticket", middleware.AuthMiddleware(oauthProvider, ticketService, authRepo), ticketHandler.CreateTicket)
			// 初始化管理员接口应用速率限制（支持动态配置）
			authRoutes.POST("/initialize-admin", middleware.LoginRateLimitMiddleware(securityService), authHandler.InitializeAdmin)
			authRoutes.POST("/2fa/verify", middleware.TwoFARateLimitMiddleware(securityService), authHandler.Verify2FACode) // 验证 2FA 代码（登录时）
		}

		// OAuth 路由（内置登录端点始终可用；对外 Provider 端点由系统设置动态控制）
		externalOAuthProviderOnly := func(c *gin.Context) {
			if !externalOAuthProviderGate.Enabled() {
				c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "Not found"})
				return
			}
			c.Next()
		}
		v1.GET("/.well-known/openid-configuration", externalOAuthProviderOnly, oauthProviderHandler.Discovery)
		oauthRoutes := v1.Group("/oauth")
		oauthRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			oauthRoutes.GET("/authorize", externalOAuthProviderOnly, oauthProviderHandler.Authorize) // 标准浏览器授权入口
			oauthRoutes.GET("/userinfo", externalOAuthProviderOnly, oauthProviderHandler.UserInfo)
			oauthRoutes.POST("/userinfo", externalOAuthProviderOnly, oauthProviderHandler.UserInfo)
			oauthRoutes.POST("/revoke", externalOAuthProviderOnly, oauthProviderHandler.Revoke)
			oauthRoutes.POST("/introspect", externalOAuthProviderOnly, oauthProviderHandler.Introspect)
			oauthRoutes.GET("/jwks", externalOAuthProviderOnly, oauthProviderHandler.JWKS)
			oauthRoutes.POST("/authorize", middleware.LoginRateLimitMiddleware(securityService), authHandler.OAuthAuthorize) // 登录交互提交
			oauthRoutes.POST("/token", authHandler.OAuthToken)                                                               // 交换/刷新 access_token
			oauthRoutes.POST("/logout", authHandler.Logout)                                                                  // 推荐登出端点（可携带 refresh_token Cookie）
			oauthRoutes.POST("/google/verify", oauthHandler.GoogleVerify)                                                    // 验证 Google ID Token
		}

		// 用户路由（需要认证）
		userRoutes := v1.Group("/users")
		userRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		userRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			userRoutes.GET("/me", authHandler.GetCurrentUser)
			userRoutes.PUT("/me", authHandler.UpdateProfile)
			userRoutes.PUT("/me/password", authHandler.ChangePassword)
			userRoutes.POST("/me/oauth/google/link", oauthHandler.GoogleLink)
			userRoutes.DELETE("/me/oauth/google/link", oauthHandler.GoogleUnlink)

			// 2FA 相关路由
			userRoutes.GET("/me/2fa/generate", authHandler.Generate2FASecret) // 生成 2FA secret
			userRoutes.POST("/me/2fa/enable", authHandler.Enable2FA)          // 启用 2FA
			userRoutes.POST("/me/2fa/disable", authHandler.Disable2FA)        // 禁用 2FA

			// 会话管理路由
			userRoutes.GET("/me/sessions", authHandler.ListSessions)                          // 获取活跃会话列表
			userRoutes.DELETE("/me/sessions/:session_id", authHandler.RevokeSession)          // 撤销指定会话
			userRoutes.POST("/me/sessions/revoke-others", authHandler.RevokeAllOtherSessions) // 撤销所有其他会话

			// 通知设置路由
			userRoutes.PUT("/me/notifications", authHandler.UpdateNotificationSettings) // 更新通知设置

			// 监控数据源设置路由

			// 用户AI配置路由
		}

		// 用户管理路由（需要认证）
		userManagementRoutes := v1.Group("/users")
		userManagementRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		userManagementRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		userManagementRoutes.Use(middleware.RequirePermission(permissionService, "user:manage"))
		{
			userManagementRoutes.GET("", userHandler.ListUsers)                    // 获取用户列表
			userManagementRoutes.GET("/statistics", userHandler.GetStatistics)     // 获取统计信息
			userManagementRoutes.GET("/:id", userHandler.GetUser)                  // 获取用户详情
			userManagementRoutes.POST("", userHandler.CreateUser)                  // 创建用户
			userManagementRoutes.PUT("/:id", userHandler.UpdateUser)               // 更新用户
			userManagementRoutes.DELETE("/:id", userHandler.DeleteUser)            // 删除用户
			userManagementRoutes.POST("/:id/password", userHandler.ChangePassword) // 修改密码
			userManagementRoutes.POST("/:id/lock", userHandler.LockUser)           // 锁定账户
			userManagementRoutes.POST("/:id/unlock", userHandler.UnlockUser)       // 解锁账户
		}

		// 权限目录（只读）
		permissionRoutes := v1.Group("/permissions")
		permissionRoutes.Use(openAPIValidation)
		permissionRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		permissionRoutes.Use(middleware.RequirePermission(permissionService, "user:manage"))
		{
			permissionRoutes.GET("", permissionHandler.ListPermissions)
		}

		// 自定义角色管理
		roleRoutes := v1.Group("/roles")
		roleRoutes.Use(openAPIValidation)
		roleRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		roleRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			roleRoutes.GET("", permissionHandler.ListRoles)
			roleRoutes.GET("/:id", permissionHandler.GetRole)
			roleRoutes.POST("", middleware.RequirePermission(permissionService, "user:manage"), permissionHandler.CreateRole)
			roleRoutes.PUT("/:id", middleware.RequirePermission(permissionService, "user:manage"), permissionHandler.UpdateRole)
			roleRoutes.DELETE("/:id", middleware.RequirePermission(permissionService, "user:manage"), permissionHandler.DeleteRole)
		}

		// 指定用户或角色的资源级授权
		resourceGrantRoutes := v1.Group("/resource-grants")
		resourceGrantRoutes.Use(openAPIValidation)
		resourceGrantRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		resourceGrantRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		resourceGrantRoutes.Use(middleware.RequirePermission(permissionService, "user:manage"))
		{
			resourceGrantRoutes.GET("", permissionHandler.ListResourceGrants)
			resourceGrantRoutes.POST("", permissionHandler.GrantResource)
			resourceGrantRoutes.POST("/revoke", permissionHandler.RevokeResource)
		}

		// 服务器路由（需要认证）

		// SSH 路由（需要认证）
		sshRoutes := v1.Group("/ssh")
		sshRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			// SSH is terminated in the browser. This endpoint only relays bytes.
			sshRoutes.GET("/relay/:server_id",
				middleware.RequireResourcePermission(permissionService, "server:connect", "server", middleware.PathResourceID("server_id")),
				middleware.RequireResourcePermission(permissionService, "terminal:execute", "server", middleware.PathResourceID("server_id")),
				middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")),
				sshRelayHandler.Handle,
			)
		}

		// Docker 路由（需要认证）

		// 监控 WebSocket 路由（需要认证）

		// SFTP 路由（需要认证）

		// SFTP 连接池统计路由（需要认证）

		// SFTP 上传进度 WebSocket 路由（需要认证）

		// SFTP 上传任务路由（需要认证）

		// SFTP 跨服务器传输路由（需要认证）

		// SFTP 跨服务器传输进度 WebSocket 路由（需要认证）

		// 监控路由（需要认证）

		// 仪表盘聚合路由（需要认证）

		// 全部日志路由（团队治理，需要管理员审计权限）
		logRoutes := v1.Group("/logs")
		logRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		logRoutes.Use(middleware.RequirePermission(permissionService, "audit:view"))
		{
			logRoutes.GET("", auditLogHandler.ListAll)
			logRoutes.GET("/statistics", auditLogHandler.GetAllStatistics)
			logRoutes.DELETE("/cleanup", middleware.RequirePermission(permissionService, "audit:manage"), auditLogHandler.CleanupOldLogs)
			logRoutes.GET("/:id", auditLogHandler.GetAnyByID)
		}

		// 统一操作记录路由：当前用户只读查看自己的记录；管理员全局视角走 /logs

		// 后台文件传输任务路由（需要认证）

		// 用户任务与通知实时事件
		realtimeRoutes := v1.Group("/events")
		realtimeRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			realtimeRoutes.GET("/stream", realtimeHandler.Stream)
		}

		// 统一任务运行中心

		// 用户站内通知
		inboxNotificationRoutes := v1.Group("/notifications")
		inboxNotificationRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			inboxNotificationRoutes.GET("", inboxNotificationHandler.List)
			inboxNotificationRoutes.POST("/read-all", inboxNotificationHandler.MarkAllRead)
			inboxNotificationRoutes.DELETE("/read", inboxNotificationHandler.ClearRead)
			inboxNotificationRoutes.POST("/:id/read", inboxNotificationHandler.MarkRead)
			inboxNotificationRoutes.DELETE("/:id", inboxNotificationHandler.Delete)
		}

		// 脚本管理路由（需要认证）

		// 批量任务路由（需要认证）

		// 定时任务路由（需要认证）

		// 系统设置路由（需要认证）
		settingsGroup := v1.Group("/settings")
		settingsGroup.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		settingsGroup.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		settingsGroup.Use(middleware.RequirePermission(permissionService, "system:settings"))
		{
			// 系统配置
			settingsGroup.GET("/system", systemConfigHandler.GetSystemConfig)
			// 系统配置 - 分组部分更新
			settingsGroup.PATCH("/system/basic", systemConfigHandler.PatchBasicInfo)
			settingsGroup.PATCH("/system/file-transfer", systemConfigHandler.PatchFileTransferConfig)
			settingsGroup.PATCH("/system/registration", systemConfigHandler.PatchRegistrationConfig)
			settingsGroup.PATCH("/system/google-auth", systemConfigHandler.PatchGoogleAuthConfig)
			settingsGroup.PATCH("/system/oauth-provider", systemConfigHandler.PatchOAuthProviderConfig)

			settingsGroup.GET("/workspace", securityHandler.GetWorkspaceConfig)
			settingsGroup.POST("/workspace", securityHandler.SaveWorkspaceConfig)
			settingsGroup.GET("/login-session", securityHandler.GetLoginSessionConfig)
			settingsGroup.POST("/login-session", securityHandler.SaveLoginSessionConfig)
			settingsGroup.GET("/login-security", securityHandler.GetLoginSecurityConfig)
			settingsGroup.POST("/login-security", securityHandler.SaveLoginSecurityConfig)
			settingsGroup.GET("/web-security", securityHandler.GetWebSecurityConfig)
			settingsGroup.POST("/web-security", securityHandler.SaveWebSecurityConfig)
			settingsGroup.GET("/cors", securityHandler.GetCORSConfig)
			settingsGroup.POST("/cors", securityHandler.SaveCORSConfig)

			// IP访问控制配置
			settingsGroup.GET("/access-control", securityHandler.GetAccessControlConfig)
			settingsGroup.POST("/access-control", securityHandler.SaveAccessControlConfig)

			// 通知配置 - 统一接口
			settingsGroup.GET("/notifications", notificationConfigHandler.GetAllNotificationConfig)
			settingsGroup.POST("/notifications", notificationConfigHandler.SaveAllNotificationConfig)

			// 通知配置 - SMTP
			settingsGroup.GET("/smtp", notificationConfigHandler.GetSMTPConfig)
			settingsGroup.POST("/smtp", notificationConfigHandler.SaveSMTPConfig)
			settingsGroup.POST("/smtp/test", notificationConfigHandler.TestSMTPConnection)

			// 通知配置 - Webhook
			settingsGroup.GET("/webhook", notificationConfigHandler.GetWebhookConfig)
			settingsGroup.POST("/webhook", notificationConfigHandler.SaveWebhookConfig)
			settingsGroup.POST("/webhook/test", notificationConfigHandler.TestWebhookConnection)

			// 通知配置 - 钉钉
			settingsGroup.GET("/dingtalk", notificationConfigHandler.GetDingTalkConfig)
			settingsGroup.POST("/dingtalk", notificationConfigHandler.SaveDingTalkConfig)
			settingsGroup.POST("/dingtalk/test", notificationConfigHandler.TestDingTalkConnection)

			// 通知配置 - 企业微信
			settingsGroup.GET("/wecom", notificationConfigHandler.GetWeComConfig)
			settingsGroup.POST("/wecom", notificationConfigHandler.SaveWeComConfig)
			settingsGroup.POST("/wecom/test", notificationConfigHandler.TestWeComConnection)

		}

		// AI聊天路由（需要认证）

		// Personal sync authorization is independent of system backup permissions.
		v1.POST("/sync/authorization/start", middleware.LoginRateLimitMiddleware(securityService), syncHandler.StartAuthorization)
		v1.POST("/sync/authorization/cancel", middleware.APIRateLimitMiddleware(securityService), syncHandler.CancelAuthorization)
		v1.POST("/sync/authorization/poll", middleware.APIRateLimitMiddleware(securityService), syncHandler.PollAuthorization)
		syncRoutes := v1.Group("/sync")
		syncRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		syncRoutes.GET("/manifests", encryptedSyncHandler.ManifestChain)
		syncRoutes.POST("/manifests", middleware.RequirePermission(permissionService, "server:manage"), encryptedSyncHandler.PublishManifest)
		syncRoutes.GET("/heads", encryptedSyncHandler.Heads)
		syncRoutes.GET("/objects/:id", encryptedSyncHandler.GetObject)
		syncRoutes.POST("/objects", middleware.RequirePermission(permissionService, "server:manage"), encryptedSyncHandler.PutObject)
		syncRoutes.POST("/routes", middleware.RequirePermission(permissionService, "server:manage"), encryptedSyncHandler.SaveRoute)

		{
			syncRoutes.GET("/status", syncHandler.Status)
			syncRoutes.PUT("/settings", middleware.RequirePermission(permissionService, "server:manage"), syncHandler.SetEnabled)
			syncRoutes.POST("/authorization/deny", syncHandler.DenyAuthorization)
			syncRoutes.POST("/authorization/info", syncHandler.AuthorizationInfo)
			syncRoutes.POST("/authorization/approve", middleware.RequirePermission(permissionService, "server:manage"), syncHandler.ApproveAuthorization)
			syncRoutes.DELETE("/devices/:id", syncHandler.RevokeDevice)
		}
		deviceSyncRoutes := v1.Group("/sync/device")
		deviceSyncRoutes.Use(syncHandler.DeviceAuth())
		deviceSyncRoutes.GET("/manifests", encryptedSyncHandler.ManifestChain)
		deviceSyncRoutes.POST("/manifests", encryptedSyncHandler.PublishManifest)
		deviceSyncRoutes.GET("/heads", encryptedSyncHandler.Heads)
		deviceSyncRoutes.GET("/objects/:id", encryptedSyncHandler.GetObject)
		deviceSyncRoutes.POST("/objects", encryptedSyncHandler.PutObject)
		deviceSyncRoutes.POST("/routes", encryptedSyncHandler.SaveRoute)
		{
			deviceSyncRoutes.GET("", syncHandler.Identity)
			deviceSyncRoutes.POST("/disconnect", syncHandler.Disconnect)
		}
		backupRoutes := v1.Group("/backup")
		backupRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		backupRoutes.Use(middleware.RequirePermission(permissionService, "backup:manage"))
		{
			backupRoutes.GET("/instances", instanceBackupHandler.List)
			backupRoutes.POST("/instances", instanceBackupHandler.Create)
			backupRoutes.POST("/instances/upload", instanceBackupHandler.Upload)
			backupRoutes.GET("/instances/:id/download", instanceBackupHandler.Download)
			backupRoutes.DELETE("/instances/:id", instanceBackupHandler.Delete)
			backupRoutes.POST("/instances/:id/inspect", instanceBackupHandler.Inspect)
			backupRoutes.POST("/instances/:id/restore", instanceBackupHandler.Restore)
			backupRoutes.POST("/instances/:id/activate", instanceBackupHandler.Activate)
			backupRoutes.POST("/activation/rollback", instanceBackupHandler.Rollback)
		}

		// SSH密钥路由（需要认证）

		// 头像生成路由（需要认证）
		avatarRoutes := v1.Group("/avatar")
		avatarRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			avatarRoutes.POST("/generate", avatarHandler.GenerateAvatar) // 生成头像
		}
	}

	// 静态文件服务（托管前端构建产物）
	// 注意：必须在所有 API 路由之后注册
	staticDir := "./static"
	if _, err := os.Stat(staticDir); err == nil {
		log.Printf("✅ Serving static files from %s", staticDir)

		// 托管 Vite 生成的静态资源
		serveAsset := func(c *gin.Context) {
			assetPath := strings.TrimPrefix(path.Clean("/"+c.Param("filepath")), "/")
			staticfiles.Serve(c, filepath.Join(staticDir, "assets", assetPath), true)
		}
		r.GET("/assets/*filepath", serveAsset)
		r.HEAD("/assets/*filepath", serveAsset)

		// 统一处理非 API 路由：
		// 1. 先尝试返回对应的静态文件（包括 /login、/login/index.txt 等）
		// 2. 如果不存在则回退到 index.html（SPA 前端接管路由）
		r.NoRoute(func(c *gin.Context) {
			requestPath := c.Request.URL.Path

			// API 请求返回 404
			if strings.HasPrefix(requestPath, "/api") {
				c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "API endpoint not found"})
				return
			}

			// 规范化路径，防止 ../ 等越界
			cleanPath := path.Clean(requestPath)
			if cleanPath == "/" || cleanPath == "." {
				staticfiles.Serve(c, filepath.Join(staticDir, "index.html"), false)
				return
			}

			// 去掉前导 /
			cleanPath = strings.TrimPrefix(cleanPath, "/")

			// 优先尝试直接文件
			filePath := filepath.Join(staticDir, cleanPath)
			if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
				staticfiles.Serve(c, filePath, false)
				return
			}

			// 如果是目录，尝试目录下的 index.html（例如 /login -> /static/login/index.html）
			if info, err := os.Stat(filePath); err == nil && info.IsDir() {
				indexPath := filepath.Join(filePath, "index.html")
				if _, err := os.Stat(indexPath); err == nil {
					staticfiles.Serve(c, indexPath, false)
					return
				}
			}

			// 最终回退到根 index.html
			staticfiles.Serve(c, filepath.Join(staticDir, "index.html"), false)
		})
	} else {
		log.Printf("⚠️  Static directory not found: %s (frontend not built)", staticDir)
	}

	// 创建 HTTP 服务器
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	var httpReady atomic.Bool
	srv := &http.Server{
		Addr: addr,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
			if !httpReady.Load() {
				http.Error(w, "instance startup is in progress", http.StatusServiceUnavailable)
				return
			}
			r.ServeHTTP(w, request)
		}),
		ReadTimeout:  60 * time.Second,  // 读取请求超时
		WriteTimeout: 300 * time.Second, // 写入响应超时（5分钟，用于长时间操作如删除大目录）
		IdleTimeout:  120 * time.Second, // 空闲连接超时
	}

	// Bind and verify the selected instance before the launcher commits activation.
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}
	defer listener.Close()
	if err := launcher.Ready(context.Background()); err != nil {
		log.Fatal(err)
	}
	accepting := &instanceactivation.Listening{Listener: listener, Accepting: make(chan struct{})}
	// 启动服务器（在 goroutine 中）
	go func() {
		log.Printf("🚀 Server starting on http://localhost%s", addr)
		log.Printf("📝 Environment: %s", cfg.Server.Env)
		log.Printf("🔗 Health check: http://localhost%s/api/v1/health", addr)

		if err := srv.Serve(accepting); err != nil && err != http.ErrServerClosed {
			log.Fatalf("❌ Failed to start server: %v", err)
		}
	}()
	<-accepting.Accepting
	if err := launcher.Serving(context.Background()); err != nil {
		log.Fatal(err)
	}
	// Do not dispatch restored work or accept requests before the durable commit.
	httpReady.Store(true)

	// 优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(quit)
	launcherContext, cancelLauncher := context.WithCancel(context.Background())
	defer cancelLauncher()
	select {
	case <-quit:
	case <-launcher.Shutdown(launcherContext):
	}

	log.Println("🛑 Shutting down server...")
	httpReady.Store(false)
	instanceHistory.Cancel()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("❌ Server forced to shutdown:", err)
	}

	log.Println("✅ Server exited properly")
}

func configureLogging(environment string) {
	level := slog.LevelInfo
	if environment == "development" {
		level = slog.LevelDebug
	}

	options := &slog.HandlerOptions{Level: level}
	var handler slog.Handler = slog.NewTextHandler(os.Stdout, options)
	if environment == "production" {
		handler = slog.NewJSONHandler(os.Stdout, options)
	}
	slog.SetDefault(slog.New(handler))
	slog.SetLogLoggerLevel(level)
}

func readAppVersion() string {
	candidates := []string{"../VERSION", "VERSION"}
	for _, candidate := range candidates {
		content, err := os.ReadFile(candidate)
		if err == nil {
			version := strings.TrimSpace(string(content))
			if version != "" {
				return version
			}
		}
	}
	return "dev"
}
