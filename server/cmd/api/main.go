package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/api/rest"
	"github.com/easyssh/server/internal/api/ws"
	"github.com/easyssh/server/internal/domain/aichat"
	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/server/internal/domain/aiconfig"
	"github.com/easyssh/server/internal/domain/auditlog"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/batchtask"
	"github.com/easyssh/server/internal/domain/completion"
	"github.com/easyssh/server/internal/domain/dashboard"
	"github.com/easyssh/server/internal/domain/inboxnotification"
	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/monitor"
	"github.com/easyssh/server/internal/domain/monitoring"
	"github.com/easyssh/server/internal/domain/notification"
	"github.com/easyssh/server/internal/domain/notificationconfig"
	"github.com/easyssh/server/internal/domain/oauthprovider"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/permission"
	"github.com/easyssh/server/internal/domain/realtime"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/server/internal/domain/security"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/server/internal/domain/sshhostkey"
	"github.com/easyssh/server/internal/domain/sshkey"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/domain/taskexecutor"
	"github.com/easyssh/server/internal/domain/taskscheduler"
	"github.com/easyssh/server/internal/domain/transferjob"
	"github.com/easyssh/server/internal/domain/user"
	"github.com/easyssh/server/internal/domain/useraiconfig"
	"github.com/easyssh/server/internal/domain/verification"
	"github.com/easyssh/server/internal/infra/config"
	"github.com/easyssh/server/internal/infra/db"
	"github.com/easyssh/server/internal/pkg/crypto"
	"github.com/easyssh/server/internal/pkg/geoip"
	"github.com/easyssh/server/internal/pkg/password"
	"github.com/easyssh/server/internal/platform"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// 加载根目录的 .env 文件
	if err := godotenv.Load("../.env"); err != nil {
		log.Printf("⚠️ Warning: .env file not found, using environment variables")
	}

	// 加载配置
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("❌ Failed to load config: %v", err)
	}
	configureLogging(cfg.Server.Env)

	// 设置 Gin 模式
	if cfg.Server.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	runtimeInfo := platform.NewRuntimeInfo(platform.RuntimeOptions{
		Profile: platform.ProfileFromEnvironment(),
		DataDir: runtimeDataDir(cfg.Database.Driver, cfg.Database.DSN),
		Version: readAppVersion(),
	})

	// 初始化数据库
	database, err := db.NewDB(&cfg.Database)
	if err != nil {
		log.Fatalf("❌ Failed to connect to database: %v", err)
	}
	defer db.Close(database)

	if err := database.AutoMigrate(
		&auth.User{},
		&auth.Session{}, // 用户会话表
		&auth.TOTPReplay{},
		&server.Server{},
		&script.Script{},                   // 脚本表
		&batchtask.BatchTask{},             // 批量任务表
		&scheduledtask.ScheduledTask{},     // 定时任务表
		&operationrecord.OperationRecord{}, // 统一操作记录表
		&transferjob.TransferJob{},         // 后台文件传输任务表
		&jobqueue.Job{},                    // 数据库持久化任务队列
		&taskcenter.TaskRun{},              // 统一任务运行表
		&taskcenter.TaskEvent{},            // 任务事件表
		&inboxnotification.Notification{},  // 站内通知表
		&inboxnotification.Delivery{},      // 通知投递记录表
		// 新的配置表
		&systemconfig.SystemConfig{},             // 系统配置表
		&security.SecurityConfig{},               // 安全配置表
		&notificationconfig.NotificationConfig{}, // 通知配置表
		&aiconfig.AIConfig{},                     // AI配置表
		&useraiconfig.UserAIConfig{},             // 用户AI配置表
		// 其他表
		&sshkey.SSHKey{},         // SSH密钥表
		&sshhostkey.SSHHostKey{}, // SSH主机密钥表（TOFU安全验证）
		// 安全增强相关表
		&auth.LoginAttempt{},  // 登录尝试记录表
		&auth.TrustedDevice{}, // 可信设备表
		&auth.LoginAlert{},    // 登录告警表
		&auth.TicketRecord{},  // 一次性握手票据
		&permission.Role{},    // 自定义角色元数据
		&oauthprovider.Client{},
		&oauthprovider.ClientAssertion{},
		&oauthprovider.Grant{},
		&oauthprovider.SigningKey{},
		&oauthprovider.LoginChallenge{},
		&runtime.AISessionRecord{}, // AI 会话持久化表
	); err != nil {
		log.Fatalf("❌ Failed to migrate database: %v", err)
	}
	log.Println("✅ Database migrated successfully")

	// 统一加密器（用于所有需要再次使用的敏感凭据）
	encryptor, err := crypto.NewEncryptor(cfg.Server.EncryptionKey)
	if err != nil {
		log.Fatalf("❌ Failed to create encryptor: %v", err)
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

	geoipClient := geoip.NewClient(systemCfg.ResolvedGeoIPDatabasePath(runtimeInfo.DataDir))
	defer geoipClient.Close()
	if geoipClient.DatabaseAvailable() {
		log.Printf("✅ GeoIP database loaded: %s", geoipClient.DatabasePath())
	} else {
		log.Printf("⚠️ GeoIP database unavailable (%s): %v", geoipClient.DatabasePath(), geoipClient.OpenError())
	}

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

	// AI配置服务
	aiConfigRepo := aiconfig.NewRepository(database)
	aiConfigService := aiconfig.NewService(aiConfigRepo, encryptor)

	// 用户AI配置服务
	userAIConfigRepo := useraiconfig.NewRepository(database)
	userAIConfigService := useraiconfig.NewService(userAIConfigRepo, encryptor)

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

	// 服务器服务
	serverRepo := server.NewRepository(database)
	serverService := server.NewService(serverRepo, encryptor, geoipClient)

	// SSH 主机密钥验证服务（TOFU安全模型）
	sshHostKeyService := sshhostkey.NewService(database)

	// SSH 会话管理器
	sessionManager := ssh.NewSessionManager()

	// 监控连接池（独立于终端会话）
	monitorConnectionPool := monitor.NewConnectionPool(serverService, encryptor, sshHostKeyService.GetHostKeyCallback())
	defer monitorConnectionPool.Close() // 程序退出时关闭连接池

	// 审计日志服务
	auditLogRepo := auditlog.NewRepository(database)
	auditLogService := auditlog.NewService(auditLogRepo)

	// 仪表盘聚合服务
	dashboardRepo := dashboard.NewRepository(database)
	dashboardService := dashboard.NewService(dashboardRepo)

	// 监控服务
	monitoringService := monitoring.NewService(serverService, encryptor, sshHostKeyService.GetHostKeyCallback())

	// 脚本服务
	scriptRepo := script.NewRepository(database)
	scriptService := script.NewService(scriptRepo)

	// 补全服务
	completionService := completion.NewService(scriptRepo, 0, 0)

	// 批量任务服务
	batchTaskRepo := batchtask.NewRepository(database)
	batchTaskService := batchtask.NewService(batchTaskRepo)
	jobQueueRepo := jobqueue.NewRepository(database)
	jobQueue := jobqueue.New(jobQueueRepo, jobqueue.Options{
		Workers: 8, PollInterval: 500 * time.Millisecond, LeaseDuration: 60 * time.Second,
	})
	batchTaskService.SetQueue(jobQueue)

	// 定时任务服务
	scheduledTaskRepo := scheduledtask.NewRepository(database)
	scheduledTaskService := scheduledtask.NewService(scheduledTaskRepo)

	// 统一操作记录服务
	operationRecordRepo := operationrecord.NewRepository(database)
	operationRecordService := operationrecord.NewService(operationRecordRepo)

	// 统一任务运行中心与站内通知
	realtimeHub := realtime.NewHub()
	taskCenterRepo := taskcenter.NewRepository(database)
	taskCenterService := taskcenter.NewService(taskCenterRepo, realtimeHub)
	inboxNotificationRepo := inboxnotification.NewRepository(database)
	inboxNotificationService := inboxnotification.NewService(inboxNotificationRepo, authRepo, notificationConfigService, emailService, realtimeHub)
	inboxNotificationService.Start(context.Background())
	taskCenterService.SetNotifier(inboxNotificationService)

	// 任务执行引擎
	taskExecutor := taskexecutor.NewExecutor(
		serverService,
		scriptService,
		scheduledTaskRepo,
		encryptor,
		10, // 最大并发数
		operationRecordService,
		taskCenterService,
	)
	taskExecutor.SetHostKeyCallback(sshHostKeyService.GetHostKeyCallback())
	taskCenterService.SetCanceler(taskExecutor)
	taskCenterService.SetDefinitionStatusUpdater(taskExecutor)
	if err := taskCenterService.RecoverInterrupted(context.Background()); err != nil {
		log.Printf("⚠️ Warning: Failed to recover interrupted task runs: %v", err)
	}
	taskCenterService.StartRetention(context.Background())

	// 注入执行器到批量任务服务
	batchTaskService.SetExecutor(taskExecutor)

	// 任务调度器
	taskScheduler := taskscheduler.NewScheduler(scheduledTaskRepo, jobQueue)

	// 注入调度器到定时任务服务
	scheduledTaskService.SetScheduler(taskScheduler)

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

	// SSH密钥服务
	sshKeyRepo := sshkey.NewRepository(database)
	sshKeyService := sshkey.NewService(sshKeyRepo, encryptor)

	// SFTP 上传 WebSocket 处理器
	sftpUploadWSHandler := ws.NewSFTPUploadHandler(securityService, cfg.Server.WebDevPort)
	runtimeCredentialStore := ssh.NewRuntimeCredentialStore()

	// SFTP 跨服务器传输 WebSocket 处理器
	sftpTransferWSHandler := ws.NewSFTPTransferHandler(
		serverService,
		serverRepo,
		encryptor,
		securityService,
		cfg.Server.WebDevPort,
		sshHostKeyService.GetHostKeyCallback(),
		operationRecordService,
		runtimeCredentialStore,
	)

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
	serverHandler := rest.NewServerHandler(serverService)
	sshHandler := rest.NewSSHHandler(sessionManager)
	sftpPoolConfig := &sftp.PoolConfig{
		MaxIdleTime:            time.Duration(systemCfg.SFTPMaxIdleTimeSeconds) * time.Second,
		CleanupInterval:        time.Duration(systemCfg.SFTPCleanupIntervalSeconds) * time.Second,
		MaxLifeTime:            time.Duration(systemCfg.SFTPMaxLifeTimeMinutes) * time.Minute,
		ConnTimeout:            time.Duration(systemCfg.SFTPConnTimeoutSeconds) * time.Second,
		MaxSFTPSessionsPerConn: systemCfg.SFTPMaxSessionsPerConn,
	}
	sftpHandler := rest.NewSFTPHandler(serverService, serverRepo, encryptor, sftpUploadWSHandler, sshHostKeyService.GetHostKeyCallback(), sftpPoolConfig, runtimeCredentialStore, operationRecordService)
	sftpHandler.SetTaskCenter(taskCenterService)
	sftpTransferWSHandler.SetPool(sftpHandler.GetPool())
	sftpHandler.SetTransferHandler(sftpTransferWSHandler) // 注入跨服务器传输处理器
	sftpAuthWSHandler := ws.NewSFTPAuthHandler(sftpHandler.GetPool(), serverService, securityService, sshHostKeyService, cfg.Server.WebDevPort)

	transferJobRepo := transferjob.NewRepository(database)
	transferJobService := transferjob.NewService(
		transferJobRepo,
		sftpHandler.GetPool(),
		serverService,
		systemConfigService,
		operationRecordService,
		transferjob.ServiceOptions{DataDir: runtimeInfo.DataDir},
	)
	transferJobService.SetTaskCenter(taskCenterService)
	transferJobService.SetQueue(jobQueue)
	taskExecutor.SetTransferJobService(transferJobService)
	transferJobService.StartMaintenance(context.Background())
	jobQueue.Register(taskexecutor.QueueJobKind, taskExecutor.HandleQueueJob)
	jobQueue.Register("batch.execute", batchTaskService.HandleQueueJob)
	jobQueue.Register("transfer.execute", transferJobService.HandleQueueJob)
	if err := jobQueue.Start(context.Background()); err != nil {
		log.Fatalf("❌ Failed to start database job queue: %v", err)
	}
	log.Println("✅ Database job queue started")

	// 启动调度器。需在 transfer job service 注入后启动，避免 SFTP 定时任务触发时执行器缺少传输服务。
	if err := taskScheduler.Start(); err != nil {
		log.Printf("⚠️ Warning: Failed to start task scheduler: %v", err)
	} else {
		log.Println("✅ Task scheduler started")
	}

	terminalHandler := ws.NewTerminalHandler(serverService, serverRepo, sessionManager, encryptor, operationRecordService, sshHostKeyService, securityService, cfg.Server.WebDevPort, completionService, runtimeCredentialStore)
	monitorHandler := ws.NewMonitorHandler(monitorConnectionPool, serverRepo, securityService, cfg.Server.WebDevPort)
	auditLogHandler := rest.NewAuditLogHandler(auditLogService)
	dashboardHandler := rest.NewDashboardHandler(dashboardService, permissionService)
	monitoringHandler := rest.NewMonitoringHandler(monitoringService, authService)
	ticketHandler := rest.NewTicketHandler(ticketService)
	scriptHandler := rest.NewScriptHandler(scriptService)
	batchTaskHandler := rest.NewBatchTaskHandler(batchTaskService)
	scheduledTaskHandler := rest.NewScheduledTaskHandler(scheduledTaskService)
	scheduledTaskHandler.SetTransferJobService(transferJobService)
	transferJobHandler := rest.NewTransferJobHandler(transferJobService)
	taskCenterHandler := rest.NewTaskCenterHandler(taskCenterService, scheduledTaskService)
	inboxNotificationHandler := rest.NewInboxNotificationHandler(inboxNotificationService)
	realtimeHandler := rest.NewRealtimeHandler(realtimeHub)
	operationRecordHandler := rest.NewOperationRecordHandler(operationRecordService)
	userHandler := rest.NewUserHandler(userService, accountLockService)
	permissionHandler := rest.NewPermissionHandler(permissionService)
	// 新的配置处理器
	securityHandler := rest.NewSecurityHandler(securityService)
	systemConfigHandler := rest.NewSystemConfigHandler(systemConfigService, permissionService, externalOAuthProviderGate)
	notificationConfigHandler := rest.NewNotificationConfigHandler(notificationConfigService)
	aiConfigHandler := rest.NewAIConfigHandler(aiConfigService)
	userAIConfigHandler := rest.NewUserAIConfigHandler(userAIConfigService)
	aiRuntimeConfigHandler := rest.NewAIRuntimeConfigHandler(aichat.NewConfigResolver(aiConfigService, userAIConfigService))
	// AI 工具执行器和会话运行时
	aiToolExecutor := aichat.NewToolExecutorService(serverService, sftpHandler.GetPool(), encryptor, sshHostKeyService.GetHostKeyCallback())
	aiRuntimeManager := aichat.NewRuntimeManager(aiConfigService, userAIConfigService, aiToolExecutor)
	aiRuntimeManager.SetSessionStore(runtime.NewGormSessionStore(database))
	aiSessionHandler := rest.NewAISessionHandler(aiRuntimeManager)
	// Docker 处理器（复用监控连接池）
	dockerHandler := rest.NewDockerHandler(monitorConnectionPool)
	// 其他处理器
	sshKeyHandler := rest.NewSSHKeyHandler(sshKeyService)
	avatarHandler := rest.NewAvatarHandler()
	backupHandler := rest.NewBackupHandler(database, encryptor)
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
			userRoutes.PUT("/me/monitor-datasource", authHandler.UpdateMonitorDataSource) // 更新监控数据源设置

			// 用户AI配置路由
			userRoutes.GET("/me/ai-config", userAIConfigHandler.GetUserAIConfig)           // 获取用户AI配置
			userRoutes.PUT("/me/ai-config", userAIConfigHandler.SaveUserAIConfig)          // 保存用户AI配置
			userRoutes.POST("/me/ai-config/models", userAIConfigHandler.ProbeUserAIModels) // 获取自定义AI可用模型
			userRoutes.DELETE("/me/ai-config", userAIConfigHandler.DeleteUserAIConfig)     // 删除用户AI配置
		}

		// 用户管理路由（需要认证）
		userManagementRoutes := v1.Group("/users")
		userManagementRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		userManagementRoutes.Use(middleware.RequirePermission(permissionService, "user:manage"))
		userManagementRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
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
		resourceGrantRoutes.Use(middleware.RequirePermission(permissionService, "user:manage"))
		{
			resourceGrantRoutes.GET("", permissionHandler.ListResourceGrants)
			resourceGrantRoutes.POST("", permissionHandler.GrantResource)
			resourceGrantRoutes.POST("/revoke", permissionHandler.RevokeResource)
		}

		// 服务器路由（需要认证）
		serverRoutes := v1.Group("/servers")
		serverRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		serverRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			serverRoutes.GET("", middleware.RequirePermission(permissionService, "server:view"), serverHandler.List)                                                           // 列表
			serverRoutes.GET("/statistics", middleware.RequirePermission(permissionService, "server:view"), serverHandler.GetStatistics)                                       // 统计
			serverRoutes.GET("/:id", middleware.RequireResourcePermission(permissionService, "server:view", "server", middleware.PathResourceID("id")), serverHandler.GetByID) // 详情

			serverRoutes.POST("", middleware.RequirePermission(permissionService, "server:manage"), serverHandler.Create)                                                          // 创建
			serverRoutes.PATCH("/reorder", middleware.RequirePermission(permissionService, "server:manage"), serverHandler.Reorder)                                                // 批量更新排序
			serverRoutes.PUT("/:id", middleware.RequireResourcePermission(permissionService, "server:manage", "server", middleware.PathResourceID("id")), serverHandler.Update)    // 更新
			serverRoutes.DELETE("/:id", middleware.RequireResourcePermission(permissionService, "server:manage", "server", middleware.PathResourceID("id")), serverHandler.Delete) // 删除
		}

		// SSH 路由（需要认证）
		sshRoutes := v1.Group("/ssh")
		sshRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			// WebSocket 终端
			sshRoutes.GET(
				"/terminal/:server_id",
				middleware.RequireResourcePermission(permissionService, "server:connect", "server", middleware.PathResourceID("server_id")),
				middleware.RequireResourcePermission(permissionService, "terminal:execute", "server", middleware.PathResourceID("server_id")),
				terminalHandler.HandleSSH,
			)

			// 会话管理 REST API
			sshRoutes.GET("/sessions", middleware.RequirePermission(permissionService, "terminal:execute"), sshHandler.ListSessions)        // 会话列表
			sshRoutes.GET("/sessions/:id", middleware.RequirePermission(permissionService, "terminal:execute"), sshHandler.GetSession)      // 会话详情
			sshRoutes.DELETE("/sessions/:id", middleware.RequirePermission(permissionService, "terminal:execute"), sshHandler.CloseSession) // 关闭会话
			sshRoutes.GET("/statistics", middleware.RequirePermission(permissionService, "terminal:execute"), sshHandler.GetStatistics)     // 统计信息
		}

		// Docker 路由（需要认证）
		dockerRoutes := v1.Group("/docker/:serverId")
		dockerRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		dockerRoutes.Use(middleware.RequireResourcePermission(permissionService, "server:connect", "server", middleware.PathResourceID("serverId")))
		{
			dockerRoutes.GET("/containers", middleware.RequireResourcePermission(permissionService, "docker:view", "server", middleware.PathResourceID("serverId")), dockerHandler.ListContainers)
			dockerRoutes.GET("/containers/:id/stats", middleware.RequireResourcePermission(permissionService, "docker:view", "server", middleware.PathResourceID("serverId")), dockerHandler.GetContainerStat)
			dockerRoutes.GET("/containers/:id/logs", middleware.RequireResourcePermission(permissionService, "docker:view", "server", middleware.PathResourceID("serverId")), dockerHandler.GetContainerLogs)
			dockerRoutes.GET("/containers/:id/check-update", middleware.RequireResourcePermission(permissionService, "docker:view", "server", middleware.PathResourceID("serverId")), dockerHandler.CheckContainerImageUpdate)
			dockerRoutes.POST("/containers/:id/start", middleware.RequireResourcePermission(permissionService, "docker:manage", "server", middleware.PathResourceID("serverId")), dockerHandler.StartContainer)
			dockerRoutes.POST("/containers/:id/stop", middleware.RequireResourcePermission(permissionService, "docker:manage", "server", middleware.PathResourceID("serverId")), dockerHandler.StopContainer)
			dockerRoutes.POST("/containers/:id/restart", middleware.RequireResourcePermission(permissionService, "docker:manage", "server", middleware.PathResourceID("serverId")), dockerHandler.RestartContainer)
			dockerRoutes.POST("/containers/:id/pause", middleware.RequireResourcePermission(permissionService, "docker:manage", "server", middleware.PathResourceID("serverId")), dockerHandler.PauseContainer)
			dockerRoutes.POST("/containers/:id/unpause", middleware.RequireResourcePermission(permissionService, "docker:manage", "server", middleware.PathResourceID("serverId")), dockerHandler.UnpauseContainer)
			dockerRoutes.DELETE("/containers/:id", middleware.RequireResourcePermission(permissionService, "docker:manage", "server", middleware.PathResourceID("serverId")), dockerHandler.RemoveContainer)
			dockerRoutes.GET("/images", middleware.RequireResourcePermission(permissionService, "docker:view", "server", middleware.PathResourceID("serverId")), dockerHandler.ListImages)
			dockerRoutes.GET("/system", middleware.RequireResourcePermission(permissionService, "docker:view", "server", middleware.PathResourceID("serverId")), dockerHandler.GetSystemInfo)
			dockerRoutes.GET("/stats", middleware.RequireResourcePermission(permissionService, "docker:view", "server", middleware.PathResourceID("serverId")), dockerHandler.GetStats)
			dockerRoutes.GET("/resources", middleware.RequireResourcePermission(permissionService, "docker:view", "server", middleware.PathResourceID("serverId")), dockerHandler.GetResources)
		}

		// 监控 WebSocket 路由（需要认证）
		monitorRoutes := v1.Group("/monitor")
		monitorRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		monitorRoutes.Use(middleware.RequireResourcePermission(permissionService, "server:connect", "server", middleware.PathResourceID("server_id")))
		{
			// WebSocket 实时监控 - 使用 server_id 查找活跃会话
			monitorRoutes.GET("/server/:server_id", monitorHandler.HandleMonitor) // 实时监控 WebSocket
		}

		// SFTP 路由（需要认证）
		sftpRoutes := v1.Group("/sftp/:server_id")
		sftpRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		sftpRoutes.Use(middleware.RequireResourcePermission(permissionService, "server:connect", "server", middleware.PathResourceID("server_id")))
		{
			// 文件浏览
			sftpRoutes.GET("/list", middleware.RequireResourcePermission(permissionService, "file:view", "server", middleware.PathResourceID("server_id")), sftpHandler.ListDirectory)
			sftpRoutes.GET("/stat", middleware.RequireResourcePermission(permissionService, "file:view", "server", middleware.PathResourceID("server_id")), sftpHandler.GetFileInfo)
			sftpRoutes.GET("/disk-usage", middleware.RequireResourcePermission(permissionService, "file:view", "server", middleware.PathResourceID("server_id")), sftpHandler.GetDiskUsage)
			sftpRoutes.POST("/auth", middleware.RequireResourcePermission(permissionService, "file:view", "server", middleware.PathResourceID("server_id")), sftpHandler.Authenticate)
			sftpRoutes.GET("/auth/ws", middleware.RequireResourcePermission(permissionService, "file:view", "server", middleware.PathResourceID("server_id")), sftpAuthWSHandler.HandleAuthWebSocket)

			// 文件传输
			sftpRoutes.POST("/upload/stream", middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")), sftpHandler.UploadFileStream)
			sftpRoutes.GET("/download", middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")), sftpHandler.DownloadFile)

			// 文件操作
			sftpRoutes.POST("/mkdir", middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")), sftpHandler.CreateDirectory)
			sftpRoutes.DELETE("/delete", middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")), sftpHandler.Delete)
			sftpRoutes.POST("/delete-paths", middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")), sftpHandler.DeletePaths)
			sftpRoutes.POST("/rename", middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")), sftpHandler.Rename)
			sftpRoutes.POST("/chmod", middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")), sftpHandler.Chmod)

			// 批量操作
			sftpRoutes.POST("/batch-delete", middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")), sftpHandler.BatchDelete)
			sftpRoutes.POST("/batch-download", middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")), sftpHandler.BatchDownload)

			// 文件内容
			sftpRoutes.GET("/read", middleware.RequireResourcePermission(permissionService, "file:view", "server", middleware.PathResourceID("server_id")), sftpHandler.ReadFile)
			sftpRoutes.POST("/write", middleware.RequireResourcePermission(permissionService, "file:manage", "server", middleware.PathResourceID("server_id")), sftpHandler.WriteFile)

			// 连接管理
			sftpRoutes.POST("/close", middleware.RequireResourcePermission(permissionService, "file:view", "server", middleware.PathResourceID("server_id")), sftpHandler.CloseConnection)
		}

		// SFTP 连接池统计路由（需要认证）
		sftpPoolRoutes := v1.Group("/sftp/pool")
		sftpPoolRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		sftpPoolRoutes.Use(middleware.RequirePermission(permissionService, "server:connect"))
		sftpPoolRoutes.Use(middleware.RequirePermission(permissionService, "file:view"))
		{
			sftpPoolRoutes.GET("/stats", sftpHandler.GetPoolStats) // 连接池统计
		}

		// SFTP 上传进度 WebSocket 路由（需要认证）
		sftpWSRoutes := v1.Group("/sftp/upload/ws")
		sftpWSRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		sftpWSRoutes.Use(middleware.RequirePermission(permissionService, "server:connect"))
		sftpWSRoutes.Use(middleware.RequirePermission(permissionService, "file:manage"))
		{
			sftpWSRoutes.GET("/:task_id", sftpUploadWSHandler.HandleUploadWebSocket) // 上传进度 WebSocket
		}

		// SFTP 上传任务路由（需要认证）
		sftpUploadRoutes := v1.Group("/sftp/upload")
		sftpUploadRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		sftpUploadRoutes.Use(middleware.RequirePermission(permissionService, "server:connect"))
		sftpUploadRoutes.Use(middleware.RequirePermission(permissionService, "file:manage"))
		{
			sftpUploadRoutes.POST("/task", sftpHandler.CreateUploadTask)                  // 创建上传任务（服务端生成 task_id）
			sftpUploadRoutes.GET("/tasks", sftpHandler.ListUploadTasks)                   // 上传任务列表（内存运行态）
			sftpUploadRoutes.GET("/tasks/:task_id", sftpHandler.GetUploadTask)            // 上传任务详情（内存运行态）
			sftpUploadRoutes.POST("/tasks/:task_id/cancel", sftpHandler.CancelUploadTask) // 取消上传任务
		}

		// SFTP 跨服务器传输路由（需要认证）
		sftpTransferRoutes := v1.Group("/sftp")
		sftpTransferRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		sftpTransferRoutes.Use(middleware.RequirePermission(permissionService, "server:connect"))
		sftpTransferRoutes.Use(middleware.RequirePermission(permissionService, "file:manage"))
		{
			sftpTransferRoutes.POST("/transfer", sftpHandler.Transfer)                       // 跨服务器文件传输（流式中转）
			sftpTransferRoutes.POST("/transfer/direct", sftpHandler.DirectTransfer)          // 跨服务器直连传输（rsync/scp）
			sftpTransferRoutes.POST("/transfer/:task_id/cancel", sftpHandler.CancelTransfer) // 取消传输任务
		}

		// SFTP 跨服务器传输进度 WebSocket 路由（需要认证）
		sftpTransferWSRoutes := v1.Group("/sftp/transfer/ws")
		sftpTransferWSRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		sftpTransferWSRoutes.Use(middleware.RequirePermission(permissionService, "server:connect"))
		sftpTransferWSRoutes.Use(middleware.RequirePermission(permissionService, "file:manage"))
		{
			sftpTransferWSRoutes.GET("/:task_id", sftpTransferWSHandler.HandleTransferWebSocket) // 传输进度 WebSocket
		}

		// 监控路由（需要认证）
		monitoringRoutes := v1.Group("/monitoring")
		monitoringRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		monitoringRoutes.Use(middleware.RequirePermission(permissionService, "server:connect"))
		{
			monitoringRoutes.GET("/resources", monitoringHandler.GetAllResources)                 // 所有服务器资源概览
			monitoringRoutes.GET("/resources/stream", monitoringHandler.StreamResources)          // 流式获取服务器资源（SSE）
			monitoringRoutes.POST("/datasource/test", monitoringHandler.TestDataSourceConnection) // 测试数据源连接
		}

		// 仪表盘聚合路由（需要认证）
		dashboardRoutes := v1.Group("/dashboard")
		dashboardRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			dashboardRoutes.GET("/overview", dashboardHandler.GetOverview) // 仪表盘聚合概览
		}

		// 全部日志路由（团队治理，需要管理员审计权限）
		logRoutes := v1.Group("/logs")
		logRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		logRoutes.Use(middleware.RequirePermission(permissionService, "audit:view"))
		{
			logRoutes.GET("", auditLogHandler.ListAll)
			logRoutes.GET("/statistics", auditLogHandler.GetAllStatistics)
			logRoutes.DELETE("/cleanup", auditLogHandler.CleanupOldLogs)
			logRoutes.GET("/:id", auditLogHandler.GetAnyByID)
		}

		// 统一操作记录路由：当前用户只读查看自己的记录；管理员全局视角走 /logs
		operationRecordRoutes := v1.Group("/operation-records")
		operationRecordRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			operationRecordRoutes.GET("", operationRecordHandler.List)
			operationRecordRoutes.GET("/statistics", operationRecordHandler.GetStatistics)
			operationRecordRoutes.GET("/:id", operationRecordHandler.GetByID)
		}

		// 后台文件传输任务路由（需要认证）
		transferJobRoutes := v1.Group("/transfer-jobs")
		transferJobRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		transferJobRoutes.Use(middleware.RequirePermission(permissionService, "file:manage"))
		{
			transferJobRoutes.GET("", transferJobHandler.List)
			transferJobRoutes.GET("/statistics", transferJobHandler.GetStatistics)
			transferJobRoutes.POST("/sftp/upload", transferJobHandler.CreateUpload)
			transferJobRoutes.POST("/sftp/download", transferJobHandler.CreateDownload)
			transferJobRoutes.GET("/:id", transferJobHandler.GetByID)
			transferJobRoutes.POST("/:id/cancel", transferJobHandler.Cancel)
			transferJobRoutes.DELETE("/:id", transferJobHandler.Delete)
			transferJobRoutes.GET("/:id/artifact", transferJobHandler.DownloadArtifact)
		}

		// 用户任务与通知实时事件
		realtimeRoutes := v1.Group("/events")
		realtimeRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			realtimeRoutes.GET("/stream", realtimeHandler.Stream)
		}

		// 统一任务运行中心
		taskCenterRoutes := v1.Group("/tasks")
		taskCenterRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			taskCenterRoutes.GET("", taskCenterHandler.List)
			taskCenterRoutes.GET("/statistics", taskCenterHandler.Statistics)
			taskCenterRoutes.DELETE("/cleanup", taskCenterHandler.Cleanup)
			taskCenterRoutes.GET("/:id", taskCenterHandler.Get)
			taskCenterRoutes.POST("/:id/cancel", taskCenterHandler.Cancel)
			taskCenterRoutes.POST("/:id/retry", taskCenterHandler.Retry)
		}

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
		scriptRoutes := v1.Group("/scripts")
		scriptRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			scriptRoutes.GET("", scriptHandler.List)                 // 脚本列表
			scriptRoutes.POST("", scriptHandler.Create)              // 创建脚本
			scriptRoutes.GET("/:id", scriptHandler.GetByID)          // 脚本详情
			scriptRoutes.PUT("/:id", scriptHandler.Update)           // 更新脚本
			scriptRoutes.DELETE("/:id", scriptHandler.Delete)        // 删除脚本
			scriptRoutes.POST("/:id/execute", scriptHandler.Execute) // 执行脚本
		}

		// 批量任务路由（需要认证）
		batchTaskRoutes := v1.Group("/batch-tasks")
		batchTaskRoutes.Use(openAPIValidation)
		batchTaskRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			batchTaskRoutes.GET("", batchTaskHandler.List)                     // 任务列表
			batchTaskRoutes.POST("", batchTaskHandler.Create)                  // 创建任务
			batchTaskRoutes.GET("/statistics", batchTaskHandler.GetStatistics) // 统计信息
			batchTaskRoutes.GET("/:id", batchTaskHandler.GetByID)              // 任务详情
			batchTaskRoutes.PUT("/:id", batchTaskHandler.Update)               // 更新任务
			batchTaskRoutes.DELETE("/:id", batchTaskHandler.Delete)            // 删除任务
			batchTaskRoutes.POST("/:id/start", batchTaskHandler.Start)         // 启动任务
		}

		// 定时任务路由（需要认证）
		scheduledTaskRoutes := v1.Group("/scheduled-tasks")
		scheduledTaskRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		scheduledTaskRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			scheduledTaskRoutes.GET("", scheduledTaskHandler.List)                     // 任务列表
			scheduledTaskRoutes.POST("", scheduledTaskHandler.Create)                  // 创建任务
			scheduledTaskRoutes.GET("/statistics", scheduledTaskHandler.GetStatistics) // 统计信息
			scheduledTaskRoutes.GET("/:id", scheduledTaskHandler.GetByID)              // 任务详情
			scheduledTaskRoutes.PUT("/:id", scheduledTaskHandler.Update)               // 更新任务
			scheduledTaskRoutes.DELETE("/:id", scheduledTaskHandler.Delete)            // 删除任务
			scheduledTaskRoutes.POST("/:id/toggle", scheduledTaskHandler.Toggle)       // 启用/禁用
			scheduledTaskRoutes.POST("/:id/trigger", scheduledTaskHandler.Trigger)     // 手动触发
		}

		// 系统设置路由（需要认证）
		settingsGroup := v1.Group("/settings")
		settingsGroup.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
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
			settingsGroup.PATCH("/system/runtime", systemConfigHandler.PatchRuntimeConfig)

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

			// AI配置
			aiGroup := settingsGroup.Group("/ai")
			{
				aiGroup.GET("/system", aiConfigHandler.GetSystemAIConfig)
				aiGroup.POST("/system", aiConfigHandler.SaveSystemAIConfig)
				aiGroup.POST("/system/models", aiConfigHandler.ProbeSystemAIModels)
			}
		}

		// AI聊天路由（需要认证）
		aiChatRoutes := v1.Group("/ai")
		aiChatRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			aiChatRoutes.GET("/config", aiRuntimeConfigHandler.GetConfig)
			aiChatRoutes.GET("/sessions", aiSessionHandler.ListSessions)
			aiChatRoutes.GET("/sessions/latest", aiSessionHandler.GetLatestSession)
			aiChatRoutes.POST("/sessions", aiSessionHandler.CreateSession)
			aiChatRoutes.GET("/sessions/:session_id", aiSessionHandler.GetSession)
			aiChatRoutes.PATCH("/sessions/:session_id", aiSessionHandler.RenameSession)
			aiChatRoutes.POST("/sessions/:session_id/chat", aiSessionHandler.Chat)
			aiChatRoutes.POST("/sessions/:session_id/cancel", aiSessionHandler.CancelSession)
			aiChatRoutes.PATCH("/sessions/:session_id/messages/:message_id", aiSessionHandler.UpdateMessage)
			aiChatRoutes.DELETE("/sessions/:session_id/messages/:message_id", aiSessionHandler.DeleteMessage)
			aiChatRoutes.DELETE("/sessions/:session_id", aiSessionHandler.DeleteSession)
		}

		// 备份恢复路由（需要认证）
		backupRoutes := v1.Group("/backup")
		backupRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		backupRoutes.Use(middleware.RequirePermission(permissionService, "backup:manage"))
		{
			backupRoutes.GET("/export", backupHandler.ExportBackup)      // 导出统一备份（默认脱敏）
			backupRoutes.POST("/export", backupHandler.ExportBackupPost) // 导出统一备份（支持完整加密备份）
			backupRoutes.POST("/restore", backupHandler.RestoreBackup)   // 恢复统一备份
		}

		// SSH密钥路由（需要认证）
		sshKeyRoutes := v1.Group("/ssh-keys")
		sshKeyRoutes.Use(middleware.AuthMiddleware(oauthProvider, ticketService, authRepo))
		{
			sshKeyRoutes.GET("", sshKeyHandler.GetSSHKeys)               // 获取密钥列表
			sshKeyRoutes.POST("/generate", sshKeyHandler.GenerateSSHKey) // 生成密钥
			sshKeyRoutes.POST("/import", sshKeyHandler.ImportSSHKey)     // 导入密钥
			sshKeyRoutes.DELETE("/:id", sshKeyHandler.DeleteSSHKey)      // 删除密钥
		}

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
		r.Static("/assets", filepath.Join(staticDir, "assets"))
		r.StaticFile("/icon.svg", filepath.Join(staticDir, "icon.svg"))
		r.StaticFile("/favicon.ico", filepath.Join(staticDir, "favicon.ico"))

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
				c.File(filepath.Join(staticDir, "index.html"))
				return
			}

			// 去掉前导 /
			cleanPath = strings.TrimPrefix(cleanPath, "/")

			// 优先尝试直接文件
			filePath := filepath.Join(staticDir, cleanPath)
			if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
				c.File(filePath)
				return
			}

			// 如果是目录，尝试目录下的 index.html（例如 /login -> /static/login/index.html）
			if info, err := os.Stat(filePath); err == nil && info.IsDir() {
				indexPath := filepath.Join(filePath, "index.html")
				if _, err := os.Stat(indexPath); err == nil {
					c.File(indexPath)
					return
				}
			}

			// 最终回退到根 index.html
			c.File(filepath.Join(staticDir, "index.html"))
		})
	} else {
		log.Printf("⚠️  Static directory not found: %s (frontend not built)", staticDir)
	}

	// 创建 HTTP 服务器
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  60 * time.Second,  // 读取请求超时
		WriteTimeout: 300 * time.Second, // 写入响应超时（5分钟，用于长时间操作如删除大目录）
		IdleTimeout:  120 * time.Second, // 空闲连接超时
	}

	// 启动服务器（在 goroutine 中）
	go func() {
		log.Printf("🚀 Server starting on http://localhost%s", addr)
		log.Printf("📝 Environment: %s", cfg.Server.Env)
		log.Printf("🔗 Health check: http://localhost%s/api/v1/health", addr)

		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("❌ Failed to start server: %v", err)
		}
	}()

	// 优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("🛑 Shutting down server...")

	taskCenterService.StopRetention()
	log.Println("✅ Task retention worker stopped")

	// 停止任务调度器
	taskScheduler.Stop()
	log.Println("✅ Task scheduler stopped")

	jobQueue.Stop()
	log.Println("✅ Database job queue stopped")

	transferJobService.Stop()
	log.Println("✅ Transfer job service stopped")

	inboxNotificationService.Stop()
	log.Println("✅ Notification delivery worker stopped")

	// 关闭 SFTP 连接池
	if sftpHandler != nil {
		sftpHandler.Close()
		log.Println("✅ SFTP connection pool closed")
	}

	// 关闭监控/SSH 连接池
	if monitorConnectionPool != nil {
		monitorConnectionPool.Close()
		log.Println("✅ Monitor connection pool closed")
	}

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

func runtimeDataDir(driver string, dsn string) string {
	if strings.ToLower(strings.TrimSpace(driver)) != "sqlite" {
		return ""
	}

	pathValue := strings.TrimSpace(dsn)
	if pathValue == "" {
		return ""
	}

	if strings.HasPrefix(pathValue, "file:") {
		pathValue = strings.TrimPrefix(pathValue, "file:")
		if index := strings.Index(pathValue, "?"); index >= 0 {
			pathValue = pathValue[:index]
		}
	}

	if pathValue == "" || pathValue == ":memory:" {
		return ""
	}

	if absolutePath, err := filepath.Abs(pathValue); err == nil {
		pathValue = absolutePath
	}

	return filepath.Dir(pathValue)
}
