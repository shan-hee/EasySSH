package main

import (
	"context"
	"fmt"
	"github.com/easyssh/shared/protocol"
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

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/api/middleware"
	"github.com/easyssh/server/internal/api/rest"
	"github.com/easyssh/server/internal/api/staticfiles"
	"github.com/easyssh/server/internal/api/ws"
	"github.com/easyssh/server/internal/domain/aichat"
	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/server/internal/domain/aiconfig"
	"github.com/easyssh/server/internal/domain/auditlog"
	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/automation"
	"github.com/easyssh/server/internal/domain/batchtask"
	"github.com/easyssh/server/internal/domain/chatbridge"
	"github.com/easyssh/server/internal/domain/completion"
	"github.com/easyssh/server/internal/domain/content"
	"github.com/easyssh/server/internal/domain/dashboard"
	"github.com/easyssh/server/internal/domain/datasync"
	"github.com/easyssh/server/internal/domain/docker"
	"github.com/easyssh/server/internal/domain/grant"
	"github.com/easyssh/server/internal/domain/inboxnotification"
	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/monitor"
	"github.com/easyssh/server/internal/domain/monitoring"
	"github.com/easyssh/server/internal/domain/notification"
	"github.com/easyssh/server/internal/domain/notificationconfig"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/rdp"
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
	"github.com/easyssh/server/internal/domain/vnc"
	"github.com/easyssh/server/internal/infra/config"
	"github.com/easyssh/server/internal/infra/db"
	"github.com/easyssh/server/internal/pkg/geoip"
	"github.com/easyssh/server/internal/platform"
	"github.com/easyssh/shared/instanceactivation"
	"github.com/easyssh/shared/instancebackup"
	"github.com/easyssh/shared/secretcrypto"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
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
	if err := startDatabase(cfg, database, launcher, migrationOptions{}); err != nil {
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

	// 数据库中的系统设置承载业务与运行参数；根密钥和数据库连接仍由部署配置提供。
	systemConfigRepo := systemconfig.NewRepository(database)
	systemConfigService := systemconfig.NewService(systemConfigRepo)
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

	geoipClient := geoip.NewClient()
	log.Println("🌍 GeoIP provider: ipwho.is")

	accessRuntime := access.NewRuntime()
	defer accessRuntime.Close()
	authRepo := auth.NewRepository(database)
	authService, err := auth.NewService(database, encryptor, accessRuntime)
	if err != nil {
		log.Fatal(err)
	}
	grantService := grant.NewService(database, grant.NewResourceCatalog(encryptor), accessRuntime, func(ctx context.Context) (string, error) {
		settings, err := systemConfigService.Get(ctx)
		if err != nil {
			return "", err
		}
		return settings.PublicURL, nil
	})
	restoreExecution := func(ctx context.Context, actor protocol.Actor) (access.Scope, error) {
		switch actor.Kind {
		case protocol.Visitor:
			return grantService.Restore(ctx, actor)
		case protocol.Owner:
			if actor.SessionID == "" {
				ownerID, err := uuid.Parse(actor.ID)
				if err != nil || !actor.Valid() {
					return access.Scope{}, access.ErrForbidden
				}
				return authService.OwnerExecutionScope(ctx, ownerID)
			}
			return authService.Restore(ctx, actor)
		default:
			return access.Scope{}, access.ErrForbidden
		}
	}
	ticketService := auth.NewTicketService(database, auth.TicketConfig{TTL: 30 * time.Second}, accessRuntime, func(ctx context.Context, actor protocol.Actor) (access.Scope, error) {
		if actor.Kind == protocol.Visitor {
			return grantService.Restore(ctx, actor)
		}
		return authService.Restore(ctx, actor)
	})
	grantContext, cancelGrants := context.WithCancel(context.Background())
	defer cancelGrants()
	go func() {
		if err := grantService.Run(grantContext); err != nil && grantContext.Err() == nil {
			log.Printf("grant session maintenance: %v", err)
		}
	}()

	// 通知配置服务
	notificationConfigRepo := notificationconfig.NewRepository(database)
	notificationConfigService := notificationconfig.NewService(notificationConfigRepo, encryptor)

	// AI配置服务
	aiConfigRepo := aiconfig.NewRepository(database, encryptor)
	aiConfigService := aiconfig.NewService(aiConfigRepo, encryptor)

	log.Println("✅ New configuration services initialized")

	// 登录提醒在每次发送前读取 SMTP，启用/修改/关闭无需重启。
	currentLoginEmail := func(ctx context.Context) (auth.EmailService, error) {
		config, err := notificationConfigService.GetSMTPConfig(ctx)
		if err != nil {
			return nil, err
		}
		if !config.Enabled {
			return nil, nil
		}
		sysConfig, err := systemConfigService.Get(ctx)
		if err != nil {
			return nil, err
		}
		systemName := "EasySSH"
		if sysConfig != nil && sysConfig.SystemName != "" {
			systemName = sysConfig.SystemName
		}
		return notification.NewEmailService(&notification.EmailConfig{
			SMTPHost: config.Host, SMTPPort: config.Port, SMTPUsername: config.Username, SMTPPassword: config.Password,
			FromEmail: config.FromEmail, FromName: config.FromName, UseTLS: config.UseTLS,
			SystemName: systemName, CurrentYear: time.Now().Year(),
		})
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

	authService.SetAccountLockService(accountLockService)

	// 登录检测服务（需要数据库）
	knownLoginDeviceRepo := auth.NewKnownLoginDeviceRepository(database)
	loginDetectionService := auth.NewLoginDetectionService(knownLoginDeviceRepo, authRepo, geoipClient, currentLoginEmail)
	log.Println("✅ Login detection service initialized")

	authService.SetLoginDetectionService(loginDetectionService)

	serverRepo := server.NewRepository(database, accessRuntime)
	sshKeyRepo := sshkey.NewRepository(database, encryptor)
	sshKeyService := sshkey.NewService(sshKeyRepo, encryptor)
	serverService := server.NewService(serverRepo, encryptor, geoipClient, sshKeyService)

	// SSH 主机密钥验证服务（TOFU安全模型）
	sshHostKeyService := sshhostkey.NewService(database, accessRuntime)

	// SSH 会话管理器
	sessionManager := ssh.NewSessionManager()

	// 监控连接池（独立于终端会话）
	monitorConnectionPool := monitor.NewConnectionPool(serverService, encryptor, sshHostKeyService.GetHostKeyPolicy())
	defer monitorConnectionPool.Close() // 程序退出时关闭连接池

	contentService, err := content.New(database, runtimeInfo.DataDir)
	if err != nil {
		log.Fatalf("Open content storage: %v", err)
	}
	defer contentService.Close()
	if err := contentService.Recover(context.Background()); err != nil {
		log.Fatalf("Recover interrupted content: %v", err)
	}
	contentHandler := rest.NewContentHandler(contentService)

	// 审计日志服务
	auditLogRepo := auditlog.NewRepository(database, contentService)
	auditLogService := auditlog.NewService(auditLogRepo)

	// 仪表盘聚合服务
	dashboardRepo := dashboard.NewRepository(database)
	dashboardService := dashboard.NewService(dashboardRepo)

	// 监控服务
	monitoringService := monitoring.NewService(serverService, encryptor, sshHostKeyService.GetHostKeyPolicy())

	// 脚本服务
	scriptRepo := script.NewRepository(database)
	scriptService := script.NewService(scriptRepo, grantService, accessRuntime)

	// 补全服务
	completionService := completion.NewService(scriptService)

	// 批量任务服务
	batchTaskRepo := batchtask.NewRepository(database, contentService)
	batchTaskService := batchtask.NewService(batchTaskRepo, scriptService)
	realtimeHub := realtime.NewHub()
	jobQueueRepo := jobqueue.NewRepository(database, realtimeHub, contentService)
	instanceStarted := make(chan struct{})
	jobQueue := jobqueue.New(jobQueueRepo, jobqueue.Options{
		Restore:              restoreExecution,
		StartGate:            instanceStarted,
		MaxConcurrency:       systemCfg.JobQueueMaxConcurrency,
		FallbackPollInterval: 2 * time.Second,
		LeaseDuration:        60 * time.Second,
	})
	batchTaskService.SetQueue(jobQueue)

	// 定时任务服务
	scheduledTaskRepo := scheduledtask.NewRepository(database)
	scheduledTaskService := scheduledtask.NewService(scheduledTaskRepo, scriptService)

	// 统一操作记录服务
	operationRecordRepo := operationrecord.NewRepository(database, contentService)
	operationRecordService := operationrecord.NewService(operationRecordRepo)
	if err := operationRecordService.EnsureCoverage(context.Background()); err != nil {
		log.Fatalf("initialize activity coverage: %v", err)
	}

	if err := operationRecordService.RecoverInterrupted(context.Background()); err != nil {
		log.Fatalf("recover interrupted activities: %v", err)
	}

	// 统一任务运行中心与站内通知
	operationRecordService.SetPublisher(realtimeHub)
	taskCenterRepo := taskcenter.NewRepository(database, contentService)
	taskCenterService := taskcenter.NewService(taskCenterRepo, realtimeHub)
	taskCenterService.SetContentCleanup(contentService.Cleanup)
	inboxNotificationRepo := inboxnotification.NewRepository(database)
	inboxNotificationService := inboxnotification.NewService(inboxNotificationRepo, authRepo, notificationConfigService, nil, realtimeHub)

	// 任务执行引擎
	taskExecutor := taskexecutor.NewExecutor(
		serverService,
		scriptService,
		scheduledTaskRepo,
		encryptor,
		10, // 最大并发数
		taskCenterService,
	)
	taskExecutor.SetHostKeyPolicy(sshHostKeyService.GetHostKeyPolicy())
	taskExecutor.SetQueue(jobQueue)
	if err := taskCenterService.RecoverInterrupted(context.Background()); err != nil {
		log.Fatalf("Failed to recover interrupted task outcomes: %v", err)
	}

	// 注入执行器到批量任务服务
	batchTaskService.SetExecutor(taskExecutor)
	batchTaskService.SetTaskCenter(taskCenterService)

	// 任务调度器
	taskScheduler := taskscheduler.NewScheduler(database, scheduledTaskRepo, jobQueue, taskCenterService, authService.OwnerExecutionScope, contentService)

	// 注入调度器到定时任务服务
	scheduledTaskService.SetScheduler(taskScheduler)

	// 共享传输并发限制
	transferLimiter := sftp.NewTransferLimiter(systemCfg.TransferMaxConcurrency)
	runtimeCredentialStore := ssh.NewRuntimeCredentialStore()

	// 令牌有效期（秒），用于 Cookie 和 API 响应

	// 初始化处理器
	ownerHandler := rest.NewOwnerHandler(authService, securityService)
	grantHandler := rest.NewGrantHandler(grantService)
	accessHandler := rest.NewAccessHandler(grantService, func(c *gin.Context) (string, error) {
		settings, err := systemConfigService.Get(c.Request.Context())
		if err != nil {
			return "", err
		}
		return settings.PublicURL, nil
	})
	serverHandler := rest.NewServerHandler(serverService)
	serverGroupHandler := rest.NewServerGroupHandler(server.NewGroupService(database))
	sshHandler := rest.NewSSHHandler(sessionManager)
	sftpPoolConfig := &sftp.PoolConfig{
		MaxIdleTime:            time.Duration(systemCfg.SFTPMaxIdleTimeSeconds) * time.Second,
		CleanupInterval:        time.Duration(systemCfg.SFTPCleanupIntervalSeconds) * time.Second,
		MaxLifeTime:            time.Duration(systemCfg.SFTPMaxLifeTimeMinutes) * time.Minute,
		ConnTimeout:            time.Duration(systemCfg.SFTPConnTimeoutSeconds) * time.Second,
		MaxSFTPSessionsPerConn: systemCfg.SFTPMaxSessionsPerConn,
	}
	sftpHandler := rest.NewSFTPHandler(serverService, serverRepo, encryptor, sshHostKeyService.GetHostKeyPolicy(), sftpPoolConfig, runtimeCredentialStore, operationRecordService)
	sftpHandler.SetTaskCenter(taskCenterService)
	sftpHandler.SetContentStore(contentService)
	taskCenterService.SetCanceler(taskcenter.CancelHandlerFunc(func(ctx context.Context, id uuid.UUID) error {
		run, err := taskCenterService.Get(ctx, id)
		if err != nil {
			return err
		}
		if run.SourceType == "sftp_delete" {
			return sftpHandler.CancelDeleteTask(ctx, id)
		}
		return taskExecutor.CancelTask(ctx, id)
	}))
	sftpAuthWSHandler := ws.NewSFTPAuthHandler(sftpHandler.GetPool(), serverService, sshHostKeyService)

	transferJobRepo := transferjob.NewRepository(database, realtimeHub, contentService)
	transferJobService := transferjob.NewService(
		transferJobRepo,
		sftpHandler.GetPool(),
		serverService,
		systemConfigService,
		transferjob.ServiceOptions{DataDir: runtimeInfo.DataDir, Limiter: transferLimiter},
	)
	if err := ticketService.RegisterWorkResolver(auth.TicketTypeTransferArtifact, transferJobService.ArtifactRequirements); err != nil {
		log.Fatal(err)
	}
	transferJobService.SetTaskCenter(taskCenterService)
	transferJobService.SetQueue(jobQueue)
	taskExecutor.SetTransferJobService(transferJobService)
	jobQueue.SetAccessRejectionHandler(func(ctx context.Context, job *jobqueue.Job, reason error) error {
		switch job.Kind {
		case taskexecutor.QueueJobKind, "batch.execute":
			// The queue transaction settles only TaskRuns still queued.
			return nil
		case "transfer.execute":
			return transferJobService.RejectQueueJob(ctx, job, reason)
		default:
			return access.ErrForbidden
		}
	})
	jobQueue.Register(taskexecutor.QueueJobKind, taskExecutor.HandleQueueJob)
	jobQueue.Register("batch.execute", batchTaskService.HandleQueueJob)
	jobQueue.Register("transfer.execute", transferJobService.HandleQueueJob)

	terminalHandler := ws.NewTerminalHandler(serverService, serverRepo, sessionManager, encryptor, operationRecordService, sshHostKeyService, completionService, runtimeCredentialStore)
	monitorHandler := ws.NewMonitorHandler(monitorConnectionPool, serverRepo)
	auditLogHandler := rest.NewAuditLogHandler(auditLogService)
	dashboardHandler := rest.NewDashboardHandler(dashboardService)
	monitoringHandler := rest.NewMonitoringHandler(monitoringService, authService)
	ticketHandler := rest.NewTicketHandler(ticketService)
	connectionHandler := rest.NewConnectionHandler(accessRuntime)
	scriptHandler := rest.NewScriptHandler(scriptService, batchTaskService)
	batchTaskHandler := rest.NewBatchTaskHandler(batchTaskService)
	scheduledTaskHandler := rest.NewScheduledTaskHandler(scheduledTaskService)
	scheduledTaskHandler.SetTransferJobService(transferJobService)
	transferJobHandler := rest.NewTransferJobHandler(transferJobService, transferLimiter)
	taskCenterHandler := rest.NewTaskCenterHandler(taskCenterService, scheduledTaskService)
	inboxNotificationHandler := rest.NewInboxNotificationHandler(inboxNotificationService)
	realtimeHandler := rest.NewRealtimeHandler(realtimeHub)
	operationRecordHandler := rest.NewOperationRecordHandler(operationRecordService)
	// 新的配置处理器
	securityHandler := rest.NewSecurityHandler(securityService)
	systemConfigHandler := rest.NewSystemConfigHandler(systemConfigService, jobQueue, transferLimiter, transferJobService)
	notificationConfigHandler := rest.NewNotificationConfigHandler(notificationConfigService)
	aiConfigHandler := rest.NewAIConfigHandler(aiConfigService)
	aiRuntimeConfigHandler := rest.NewAIRuntimeConfigHandler(aichat.NewConfigResolver(aiConfigService))
	// AI 工具执行器和会话运行时
	aiToolExecutor := aichat.NewToolExecutorService(serverService, sftpHandler.GetPool(), encryptor, sshHostKeyService.GetHostKeyPolicy())
	automationService, err := automation.NewService(aiToolExecutor, batchTaskService, taskCenterService, scriptService, operationRecordService)
	if err != nil {
		log.Fatalf("Initialize automation tools: %v", err)
	}
	automationHandler := rest.NewAutomationHandler(automationService, securityService, cfg.Server.WebDevPort)
	rdpGateway, err := rdp.NewGateway(cfg.Server.GuacdAddress, cfg.Server.GuacdTLS)
	if err != nil {
		log.Fatal(err)
	}
	rdpService := rdp.NewService(database, serverService, accessRuntime)
	rdpHandler := rest.NewRDPHandler(rdpService, rdpGateway.Configured())
	rdpWSHandler := ws.NewRDPHandler(rdpService, rdpGateway, operationRecordService)
	vncService := vnc.NewService(database, serverService, accessRuntime)
	vncHandler := rest.NewVNCHandler(vncService)
	vncWSHandler := ws.NewVNCHandler(vncService, operationRecordService)

	aiRuntimeManager := aichat.NewRuntimeManager(aiConfigService, aiToolExecutor)
	recoveryCtx, recoveryCancel := context.WithTimeout(context.Background(), 30*time.Second)
	recoveryErr := runtime.RecoverInterrupted(recoveryCtx, database, contentService)
	recoveryCancel()
	if recoveryErr != nil {
		log.Fatalf("恢复 AI 执行记录失败: %v", recoveryErr)
	}
	aiRuntimeManager.SetSessionStore(runtime.NewGormSessionStore(database, contentService))
	aiSessionHandler := rest.NewAISessionHandler(aiRuntimeManager)
	chatConnectionService := chatbridge.NewService(database, encryptor, aiRuntimeManager, accessRuntime)
	chatConnectionHandler := rest.NewChatConnectionHandler(chatConnectionService)
	// Docker 处理器（复用监控连接池）
	dockerService := docker.NewService(monitorConnectionPool, taskCenterService, taskCenterRepo)
	dockerHandler := rest.NewDockerHandler(dockerService)
	systemInfoHandler := rest.NewSystemInfoHandler(monitorConnectionPool)
	// 其他处理器
	sshKeyHandler := rest.NewSSHKeyHandler(sshKeyService)
	avatarHandler := rest.NewAvatarHandler()
	instanceHistory, err := newInstanceHistory(cfg, database, func(capture func() error) error {
		return transferJobService.SnapshotStorage(func() error { return contentService.SnapshotStorage(capture) })
	})
	if err != nil {
		log.Fatalf("Failed to initialize backup history: %v", err)
	}
	defer instanceHistory.Close()
	instanceBackupHandler := rest.NewInstanceBackupHandler(instanceHistory, cfg.Database.Driver == "sqlite" || os.Getenv("EASYSSH_RESTORE_DSN") != "")
	instanceBackupHandler.SetActivation(launcher)

	syncEngine := &datasync.Engine{}
	defer syncEngine.Close()
	syncHandler := rest.NewSyncHandler(&datasync.Service{DB: database, Content: contentService, Engine: syncEngine, Encryptor: encryptor, WithSessionSync: aiRuntimeManager.WithSyncSession, InvalidateScript: func(id string) { accessRuntime.InvalidateScript(id, access.ErrResourceChanged) }, InvalidateConnection: func(owner, id uuid.UUID) {
		accessRuntime.RevalidateResource(id.String())
		runtimeCredentialStore.Invalidate(owner, id)
		sftpHandler.GetPool().InvalidateResource(owner, id)
		_ = monitorConnectionPool.ForceClose(owner.String(), id.String())
	}})
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
	r.Use(middleware.Recovery())  // 错误恢复
	r.Use(middleware.Logger())    // 日志记录
	r.Use(middleware.RequestID()) // 请求 ID

	r.Use(middleware.SecurityConfigCache(securityService))            // 请求级安全配置快照
	r.Use(middleware.SecurityHeaders(cfg.Server.Env != "production")) // 安全响应头
	r.Use(middleware.CORS(cfg, securityService))                      // 跨域（支持动态配置）
	r.Use(middleware.OptionalIPWhitelistMiddleware(securityService))  // IP 访问控制验证（可选）

	// API v1 路由组
	v1 := middleware.NewPolicyRoutes(r.Group("/api/v1"))
	{
		v1.GET("/runtime", middleware.PublicRoute(), runtimeHandler.GetRuntime)
		v1.GET("/public/branding", middleware.PublicRoute(), systemConfigHandler.GetPublicBranding)
		v1.GET("/updates/check", middleware.PublicRoute(), updateCheckHandler.Check)
		v1.GET("/backup/activation/status/:operationId", middleware.PublicRoute(), instanceBackupHandler.ActivationStatus)

		// 健康检查
		v1.GET("/health", middleware.PublicRoute(), func(c *gin.Context) {
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
		v1.HEAD("/ping", middleware.PublicRoute(), func(c *gin.Context) {
			c.Status(http.StatusOK)
		})
		v1.GET("/ping", middleware.PublicRoute(), func(c *gin.Context) {
			c.JSON(http.StatusOK, protocol.PingResult{Pong: time.Now().UnixMilli()})
		})

		// Owner bootstrap and sessions are separate from visitor access.
		ownerRoutes := v1.Group("/owner")
		{
			ownerRoutes.GET("/status", middleware.PublicRoute(), ownerHandler.Status)
			ownerRoutes.POST("/initialize", middleware.PublicRoute(), middleware.LoginRateLimitMiddleware(securityService), middleware.RequireJSONBody(), ownerHandler.Initialize)
			ownerRoutes.POST("/login", middleware.PublicRoute(), middleware.LoginRateLimitMiddleware(securityService), middleware.RequireJSONBody(), ownerHandler.Login)
			ownerRoutes.GET("/csrf", middleware.PublicRoute(), ownerHandler.CSRF)
			ownerPrivate := ownerRoutes.Group("")
			ownerPrivate.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
			ownerPrivate.Use(middleware.AuditLogMiddleware(auditLogService, nil))
			ownerPrivate.GET("/profile", middleware.OwnerRoute(protocol.OwnerManage, ""), ownerHandler.Profile)
			ownerPrivate.PUT("/profile", middleware.OwnerRoute(protocol.OwnerManage, ""), ownerHandler.UpdateProfile)
			ownerPrivate.PUT("/password", middleware.OwnerRoute(protocol.OwnerManage, ""), ownerHandler.ChangePassword)
			ownerPrivate.POST("/logout", middleware.OwnerRoute(protocol.OwnerManage, ""), ownerHandler.Logout)
			ownerPrivate.POST("/2fa/setup", middleware.OwnerRoute(protocol.OwnerManage, ""), ownerHandler.Generate2FA)
			ownerPrivate.POST("/2fa/enable", middleware.OwnerRoute(protocol.OwnerManage, ""), middleware.TwoFARateLimitMiddleware(securityService), ownerHandler.Enable2FA)
			ownerPrivate.POST("/2fa/disable", middleware.OwnerRoute(protocol.OwnerManage, ""), middleware.TwoFARateLimitMiddleware(securityService), ownerHandler.Disable2FA)
			ownerPrivate.GET("/sessions", middleware.OwnerRoute(protocol.OwnerManage, ""), ownerHandler.ListSessions)
			ownerPrivate.DELETE("/sessions/:session_id", middleware.OwnerRoute(protocol.OwnerManage, ""), ownerHandler.RevokeSession)
			ownerPrivate.POST("/sessions/revoke-others", middleware.OwnerRoute(protocol.OwnerManage, ""), ownerHandler.RevokeOtherSessions)
			ownerPrivate.PUT("/notifications", middleware.OwnerRoute(protocol.OwnerManage, ""), ownerHandler.UpdateNotifications)
			ownerPrivate.PUT("/monitor-datasource", middleware.OwnerRoute(protocol.OwnerManage, ""), ownerHandler.UpdateMonitorDataSource)
			ownerPrivate.GET("/ai-config", middleware.OwnerRoute(protocol.OwnerManage, ""), aiConfigHandler.Get)
			ownerPrivate.PUT("/ai-config", middleware.OwnerRoute(protocol.OwnerManage, ""), aiConfigHandler.Save)
			ownerPrivate.POST("/ai-config/models", middleware.OwnerRoute(protocol.OwnerManage, ""), aiConfigHandler.ProbeModels)
			ownerPrivate.DELETE("/ai-config", middleware.OwnerRoute(protocol.OwnerManage, ""), aiConfigHandler.Reset)
		}
		grantRoutes := v1.Group("/grants", middleware.AuthMiddleware(authService, ticketService, securityService))
		grantRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		grantRoutes.GET("", middleware.OwnerRoute(protocol.GrantsManage, ""), grantHandler.List)
		grantRoutes.POST("", middleware.OwnerRoute(protocol.GrantsManage, ""), grantHandler.Create)
		grantRoutes.GET("/:id", middleware.OwnerRoute(protocol.GrantsManage, ""), grantHandler.Detail)
		grantRoutes.PUT("/:id", middleware.OwnerRoute(protocol.GrantsManage, ""), grantHandler.Update)
		grantRoutes.DELETE("/:id", middleware.OwnerRoute(protocol.GrantsManage, ""), grantHandler.Revoke)
		grantRoutes.POST("/:id/rotate-secret", middleware.OwnerRoute(protocol.GrantsManage, ""), grantHandler.RotateSecret)
		grantRoutes.POST("/:id/resources/:server_id/confirm", middleware.OwnerRoute(protocol.GrantsManage, ""), grantHandler.ConfirmResource)
		grantRoutes.DELETE("/sessions/:id", middleware.OwnerRoute(protocol.GrantsManage, ""), accessHandler.EndSession)

		accessRoutes := v1.Group("/access")
		accessRoutes.POST("/exchanges", middleware.PublicRoute(), middleware.LoginRateLimitMiddleware(securityService), accessHandler.Exchange)
		accessRoutes.POST("/handoffs/:id/bind", middleware.PublicRoute(), middleware.LoginRateLimitMiddleware(securityService), accessHandler.BindHandoff)
		accessRoutes.POST("/handoffs/:id/claim", middleware.PublicRoute(), middleware.LoginRateLimitMiddleware(securityService), accessHandler.ClaimHandoff)
		visitorRoutes := accessRoutes.Group("", accessHandler.Authenticate())
		visitorRoutes.GET("/context", middleware.AccessRoute(protocol.WorkspaceRead, ""), accessHandler.Context)
		visitorRoutes.DELETE("/sessions/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), accessHandler.EndSession)
		visitorRoutes.POST("/handoffs", middleware.AccessRoute(protocol.WorkspaceRead, ""), accessHandler.CreateHandoff)
		visitorRoutes.GET("/handoffs/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), accessHandler.HandoffStatus)
		visitorRoutes.POST("/handoffs/:id/approve", middleware.AccessRoute(protocol.WorkspaceRead, ""), accessHandler.ApproveHandoff)
		// Resource execution routes are enabled per capability when their
		// complete service and running-work checks have been connected.
		executionAuth := middleware.ExecutionAuth(authService, ticketService, securityService, accessHandler.Authenticate())
		tokenRoutes := v1.Group("/access-tokens", middleware.AuthMiddleware(authService, ticketService, securityService))
		tokenRoutes.GET("", middleware.OwnerRoute(protocol.GrantsManage, ""), accessHandler.ListTokens)
		tokenRoutes.POST("", middleware.OwnerRoute(protocol.GrantsManage, ""), accessHandler.CreateToken)
		tokenRoutes.DELETE("/:id", middleware.OwnerRoute(protocol.GrantsManage, ""), accessHandler.RevokeToken)
		automationRoutes := v1.Group("/automation", executionAuth, middleware.APIRateLimitMiddleware(securityService))
		automationRoutes.GET("/tools", middleware.AccessRoute(protocol.WorkspaceRead, ""), automationHandler.Catalog)
		automationRoutes.POST("/tools/:name", middleware.AccessRoute(protocol.WorkspaceRead, ""), automationHandler.Call)
		v1.POST("/mcp", middleware.AccessRoute(protocol.WorkspaceRead, ""), accessHandler.Authenticate(), middleware.APIRateLimitMiddleware(securityService), automationHandler.MCP)
		v1.GET("/mcp", middleware.AccessRoute(protocol.WorkspaceRead, ""), accessHandler.Authenticate(), automationHandler.MCP)
		v1.DELETE("/mcp", middleware.AccessRoute(protocol.WorkspaceRead, ""), accessHandler.Authenticate(), automationHandler.MCP)
		v1.GET("/rdp/status", middleware.AccessRoute(protocol.WorkspaceRead, ""), executionAuth, rdpHandler.Status)
		rdpRoutes := v1.Group("/rdp/:server_id", executionAuth)
		rdpRoutes.GET("/config", middleware.AccessRoute(protocol.WorkspaceRead, ""), rdpHandler.Get)
		rdpRoutes.PUT("/config", middleware.OwnerRoute(protocol.ResourcesManage, ""), rdpHandler.Save)
		rdpRoutes.GET("/ws", middleware.AccessRoute(protocol.RDPConnect, "server_id"), middleware.ConnectionContext(accessRuntime, "server_id"), rdpWSHandler.Connect)
		vncRoutes := v1.Group("/vnc/:server_id", executionAuth)
		vncRoutes.GET("/config", middleware.AccessRoute(protocol.WorkspaceRead, ""), vncHandler.Get)
		vncRoutes.PUT("/config", middleware.OwnerRoute(protocol.ResourcesManage, ""), vncHandler.Save)
		vncRoutes.GET("/ws", middleware.AccessRoute(protocol.VNCConnect, "server_id"), middleware.ConnectionContext(accessRuntime, "server_id"), vncWSHandler.Connect)

		accessRoutes.POST("/tickets", middleware.AccessRoute(protocol.WorkspaceRead, ""), executionAuth, ticketHandler.CreateTicket)
		connectionRoutes := v1.Group("/connections", executionAuth)
		connectionRoutes.POST("", middleware.AccessRoute(protocol.WorkspaceRead, ""), connectionHandler.Create)
		connectionRoutes.POST("/:id/heartbeat", middleware.AccessRoute(protocol.WorkspaceRead, ""), connectionHandler.Heartbeat)
		connectionRoutes.DELETE("/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), connectionHandler.Close)

		// 服务器路由（需要认证）
		serverRoutes := v1.Group("/servers")
		serverRoutes.Use(executionAuth)
		serverRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			serverRoutes.GET("", middleware.AccessRoute(protocol.WorkspaceRead, ""), serverHandler.List)                     // 列表
			serverRoutes.GET("/statistics", middleware.AccessRoute(protocol.WorkspaceRead, ""), serverHandler.GetStatistics) // 统计
			serverRoutes.GET("/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), serverHandler.GetByID)              // 详情

			serverRoutes.POST("", middleware.OwnerRoute(protocol.ResourcesManage, ""), serverHandler.Create)           // 创建
			serverRoutes.PATCH("/reorder", middleware.OwnerRoute(protocol.ResourcesManage, ""), serverHandler.Reorder) // 批量更新排序
			serverRoutes.PUT("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), serverHandler.Update)        // 更新
			serverRoutes.DELETE("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), serverHandler.Delete)     // 删除
		}

		groupRoutes := v1.Group("/server-groups")
		groupRoutes.Use(executionAuth, middleware.AuditLogMiddleware(auditLogService, nil))
		groupRoutes.GET("", middleware.OwnerRoute(protocol.ResourcesManage, ""), serverGroupHandler.List)
		groupRoutes.POST("", middleware.OwnerRoute(protocol.ResourcesManage, ""), serverGroupHandler.Create)
		groupRoutes.PUT("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), serverGroupHandler.Update)
		groupRoutes.DELETE("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), serverGroupHandler.Delete)

		// SSH 路由（需要认证）
		sshRoutes := v1.Group("/ssh")
		sshRoutes.Use(executionAuth)
		{
			// WebSocket 终端
			sshRoutes.GET(
				"/terminal/:server_id",
				middleware.AccessRoute(protocol.TerminalConnect, "server_id"), middleware.ConnectionContext(accessRuntime, "server_id"), terminalHandler.HandleSSH,
			)

			// 会话管理 REST API
			sshRoutes.GET("/sessions", middleware.AccessRoute(protocol.WorkspaceRead, ""), sshHandler.ListSessions)        // 会话列表
			sshRoutes.GET("/sessions/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), sshHandler.GetSession)      // 会话详情
			sshRoutes.DELETE("/sessions/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), sshHandler.CloseSession) // 关闭会话
			sshRoutes.GET("/statistics", middleware.AccessRoute(protocol.WorkspaceRead, ""), sshHandler.GetStatistics)     // 统计信息
		}

		systemRoutes := v1.Group("/system/:serverId")
		systemRoutes.Use(executionAuth, middleware.ConnectionContext(accessRuntime, "serverId"))
		systemRoutes.GET("/:kind", middleware.AccessRoute(protocol.MonitorRead, "serverId"), systemInfoHandler.Snapshot)

		// Docker 路由（需要认证）
		dockerRoutes := v1.Group("/docker/:serverId")
		dockerRoutes.Use(executionAuth, middleware.ConnectionContext(accessRuntime, "serverId"))
		{
			dockerRoutes.GET("/tasks/:taskId", middleware.AccessRoute(protocol.DockerManage, "serverId"), dockerHandler.Result)
			dockerRoutes.GET("/containers", middleware.AccessRoute(protocol.DockerRead, "serverId"), dockerHandler.ListContainers)
			dockerRoutes.GET("/containers/:id/stats", middleware.AccessRoute(protocol.DockerRead, "serverId"), dockerHandler.GetContainerStat)
			dockerRoutes.GET("/containers/:id/logs", middleware.AccessRoute(protocol.DockerRead, "serverId"), dockerHandler.GetContainerLogs)
			dockerRoutes.GET("/containers/:id/check-update", middleware.AccessRoute(protocol.DockerRead, "serverId"), dockerHandler.CheckContainerImageUpdate)
			dockerRoutes.POST("/containers/:id/start", middleware.AccessRoute(protocol.DockerManage, "serverId"), dockerHandler.StartContainer)
			dockerRoutes.POST("/containers/:id/stop", middleware.AccessRoute(protocol.DockerManage, "serverId"), dockerHandler.StopContainer)
			dockerRoutes.POST("/containers/:id/restart", middleware.AccessRoute(protocol.DockerManage, "serverId"), dockerHandler.RestartContainer)
			dockerRoutes.POST("/containers/:id/pause", middleware.AccessRoute(protocol.DockerManage, "serverId"), dockerHandler.PauseContainer)
			dockerRoutes.POST("/containers/:id/unpause", middleware.AccessRoute(protocol.DockerManage, "serverId"), dockerHandler.UnpauseContainer)
			dockerRoutes.DELETE("/containers/:id", middleware.AccessRoute(protocol.DockerManage, "serverId"), dockerHandler.RemoveContainer)
			dockerRoutes.GET("/images", middleware.AccessRoute(protocol.DockerRead, "serverId"), dockerHandler.ListImages)
			dockerRoutes.GET("/system", middleware.AccessRoute(protocol.DockerRead, "serverId"), dockerHandler.GetSystemInfo)
			dockerRoutes.GET("/stats", middleware.AccessRoute(protocol.DockerRead, "serverId"), dockerHandler.GetStats)
			dockerRoutes.GET("/resources", middleware.AccessRoute(protocol.DockerRead, "serverId"), dockerHandler.GetResources)
		}

		// 监控 WebSocket 路由（需要认证）
		monitorRoutes := v1.Group("/monitor")
		monitorRoutes.Use(executionAuth, middleware.ConnectionContext(accessRuntime, "server_id"))
		{
			// WebSocket 实时监控 - 使用 server_id 查找活跃会话
			monitorRoutes.GET("/server/:server_id", middleware.AccessRoute(protocol.MonitorRead, "server_id"), monitorHandler.HandleMonitor) // 实时监控 WebSocket
		}

		// SFTP 路由（需要认证）
		sftpRoutes := v1.Group("/sftp/:server_id")
		sftpRoutes.Use(executionAuth, middleware.ConnectionContext(accessRuntime, "server_id"))
		{
			// 文件浏览
			sftpRoutes.GET("/list", middleware.AccessRoute(protocol.FilesList, "server_id"), sftpHandler.ListDirectory)
			sftpRoutes.GET("/stat", middleware.AccessRoute(protocol.FilesList, "server_id"), sftpHandler.GetFileInfo)
			sftpRoutes.GET("/disk-usage", middleware.AccessRoute(protocol.FilesList, "server_id"), sftpHandler.GetDiskUsage)
			sftpRoutes.POST("/auth", middleware.OwnerRoute(protocol.FilesList, "server_id"), sftpHandler.Authenticate)
			sftpRoutes.GET("/auth/ws", middleware.AccessRoute(protocol.FilesList, "server_id"), sftpAuthWSHandler.HandleAuthWebSocket)

			// 文件传输

			// 文件操作
			sftpRoutes.POST("/mkdir", middleware.AccessRoute(protocol.FilesWrite, "server_id"), sftpHandler.CreateDirectory)
			sftpRoutes.DELETE("/delete", middleware.AccessRoute(protocol.FilesDelete, "server_id"), sftpHandler.Delete)
			sftpRoutes.POST("/delete-paths", middleware.AccessRoute(protocol.FilesDelete, "server_id"), sftpHandler.DeletePaths)
			sftpRoutes.POST("/rename", middleware.AccessRoute(protocol.FilesWrite, "server_id"), sftpHandler.Rename)
			sftpRoutes.POST("/chmod", middleware.AccessRoute(protocol.FilesWrite, "server_id"), sftpHandler.Chmod)

			// 批量操作
			sftpRoutes.POST("/batch-delete", middleware.AccessRoute(protocol.FilesDelete, "server_id"), sftpHandler.BatchDelete)

			// 文件内容
			sftpRoutes.GET("/read", middleware.AccessRoute(protocol.FilesRead, "server_id"), sftpHandler.ReadFile)
			sftpRoutes.POST("/write", middleware.AccessRoute(protocol.FilesWrite, "server_id"), sftpHandler.WriteFile)

			// 连接管理

		}

		// SFTP 连接池统计路由（需要认证）
		sftpPoolRoutes := v1.Group("/sftp/pool")
		sftpPoolRoutes.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
		{
			sftpPoolRoutes.GET("/stats", middleware.OwnerRoute(protocol.WorkspaceRead, ""), sftpHandler.GetPoolStats) // 连接池统计
		}

		// 监控路由（需要认证）
		monitoringRoutes := v1.Group("/monitoring")
		monitoringRoutes.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
		{
			monitoringRoutes.GET("/resources", middleware.OwnerRoute(protocol.WorkspaceRead, ""), monitoringHandler.GetAllResources)                 // 所有服务器资源概览
			monitoringRoutes.POST("/datasource/test", middleware.OwnerRoute(protocol.WorkspaceRead, ""), monitoringHandler.TestDataSourceConnection) // 测试数据源连接
		}

		// 仪表盘聚合路由（需要认证）
		dashboardRoutes := v1.Group("/dashboard")
		dashboardRoutes.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
		{
			dashboardRoutes.GET("/overview", middleware.OwnerRoute(protocol.WorkspaceRead, ""), dashboardHandler.GetOverview) // 仪表盘聚合概览
		}

		// 全部日志路由（团队治理，需要管理员审计权限）
		logRoutes := v1.Group("/logs")
		logRoutes.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
		{
			logRoutes.GET("", middleware.OwnerRoute(protocol.ActivityRead, ""), auditLogHandler.ListAll)
			logRoutes.GET("/statistics", middleware.OwnerRoute(protocol.ActivityRead, ""), auditLogHandler.GetAllStatistics)
			logRoutes.DELETE("/cleanup", middleware.OwnerRoute(protocol.ActivityRead, ""), auditLogHandler.CleanupOldLogs)
			logRoutes.GET("/:id", middleware.OwnerRoute(protocol.ActivityRead, ""), auditLogHandler.GetAnyByID)
		}

		// 活动读取在仓储层按可信主体过滤，所有者可查看工作区。
		operationRecordRoutes := v1.Group("/operation-records")
		operationRecordRoutes.Use(executionAuth)
		{
			operationRecordRoutes.GET("", middleware.AccessRoute(protocol.WorkspaceRead, ""), operationRecordHandler.List)
			operationRecordRoutes.GET("/overview", middleware.AccessRoute(protocol.WorkspaceRead, ""), operationRecordHandler.Overview)
			operationRecordRoutes.GET("/statistics", middleware.AccessRoute(protocol.WorkspaceRead, ""), operationRecordHandler.GetStatistics)
			operationRecordRoutes.GET("/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), operationRecordHandler.GetByID)
		}

		// 后台文件传输任务路由（需要认证）
		transferJobRoutes := v1.Group("/transfer-jobs")
		transferJobRoutes.Use(executionAuth)
		{
			transferJobRoutes.GET("", middleware.AccessRoute(protocol.WorkspaceRead, ""), transferJobHandler.List)
			transferJobRoutes.GET("/statistics", middleware.AccessRoute(protocol.WorkspaceRead, ""), transferJobHandler.GetStatistics)
			transferJobRoutes.POST("/sftp/upload", middleware.AccessRoute(protocol.WorkspaceRead, ""), transferJobHandler.CreateUpload)
			transferJobRoutes.PUT("/:id/input", middleware.AccessRoute(protocol.WorkspaceRead, ""), transferJobHandler.UploadContent)
			transferJobRoutes.POST("/sftp/relay", middleware.AccessRoute(protocol.WorkspaceRead, ""), transferJobHandler.CreateRelay)
			transferJobRoutes.POST("/sftp/download", middleware.AccessRoute(protocol.WorkspaceRead, ""), transferJobHandler.CreateDownload)
			transferJobRoutes.GET("/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), transferJobHandler.GetByID)
			transferJobRoutes.POST("/:id/cancel", middleware.AccessRoute(protocol.WorkspaceRead, ""), transferJobHandler.Cancel)
			transferJobRoutes.DELETE("/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), transferJobHandler.Delete)
			transferJobRoutes.GET("/:id/artifact", middleware.AccessRoute(protocol.WorkspaceRead, ""), transferJobHandler.DownloadArtifact)
		}

		// 用户任务与通知实时事件
		realtimeRoutes := v1.Group("/events")
		realtimeRoutes.Use(executionAuth)
		{
			realtimeRoutes.GET("/stream", middleware.AccessRoute(protocol.WorkspaceRead, ""), realtimeHandler.Stream)
		}

		// 统一任务运行中心
		taskCenterRoutes := v1.Group("/tasks")
		taskCenterRoutes.Use(executionAuth)
		{
			taskCenterRoutes.GET("", middleware.AccessRoute(protocol.WorkspaceRead, ""), taskCenterHandler.List)
			taskCenterRoutes.GET("/statistics", middleware.AccessRoute(protocol.WorkspaceRead, ""), taskCenterHandler.Statistics)
			taskCenterRoutes.DELETE("/cleanup", middleware.OwnerRoute(protocol.ResourcesManage, ""), taskCenterHandler.Cleanup)
			taskCenterRoutes.GET("/:id/events", middleware.AccessRoute(protocol.WorkspaceRead, ""), taskCenterHandler.Events)
			taskCenterRoutes.GET("/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), taskCenterHandler.Get)
			taskCenterRoutes.POST("/:id/cancel", middleware.AccessRoute(protocol.WorkspaceRead, ""), taskCenterHandler.Cancel)
			taskCenterRoutes.POST("/:id/retry", middleware.OwnerRoute(protocol.ResourcesManage, ""), taskCenterHandler.Retry)
		}

		// 用户站内通知
		inboxNotificationRoutes := v1.Group("/notifications")
		inboxNotificationRoutes.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
		{
			inboxNotificationRoutes.GET("", middleware.OwnerRoute(protocol.OwnerManage, ""), inboxNotificationHandler.List)
			inboxNotificationRoutes.POST("/read-all", middleware.OwnerRoute(protocol.OwnerManage, ""), inboxNotificationHandler.MarkAllRead)
			inboxNotificationRoutes.DELETE("/read", middleware.OwnerRoute(protocol.OwnerManage, ""), inboxNotificationHandler.ClearRead)
			inboxNotificationRoutes.POST("/:id/read", middleware.OwnerRoute(protocol.OwnerManage, ""), inboxNotificationHandler.MarkRead)
			inboxNotificationRoutes.DELETE("/:id", middleware.OwnerRoute(protocol.OwnerManage, ""), inboxNotificationHandler.Delete)
		}

		// 脚本管理路由（需要认证）
		scriptRoutes := v1.Group("/scripts")
		scriptRoutes.Use(executionAuth)
		scriptRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			scriptRoutes.GET("/available", middleware.AccessRoute(protocol.WorkspaceRead, ""), scriptHandler.Available)
			scriptRoutes.GET("", middleware.OwnerRoute(protocol.ResourcesManage, ""), scriptHandler.List)                // 脚本列表
			scriptRoutes.POST("", middleware.OwnerRoute(protocol.ResourcesManage, ""), scriptHandler.Create)             // 创建脚本
			scriptRoutes.GET("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), scriptHandler.GetByID)         // 脚本详情
			scriptRoutes.PUT("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), scriptHandler.Update)          // 更新脚本
			scriptRoutes.DELETE("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), scriptHandler.Delete)       // 删除脚本
			scriptRoutes.POST("/:id/execute", middleware.AccessRoute(protocol.WorkspaceRead, ""), scriptHandler.Execute) // 执行脚本
		}

		// 批量任务路由（需要认证）
		batchTaskRoutes := v1.Group("/batch-tasks")
		batchTaskRoutes.Use(executionAuth)
		{
			batchTaskRoutes.GET("", middleware.AccessRoute(protocol.WorkspaceRead, ""), batchTaskHandler.List)                     // 任务列表
			batchTaskRoutes.POST("", middleware.AccessRoute(protocol.WorkspaceRead, ""), batchTaskHandler.Create)                  // 创建任务
			batchTaskRoutes.GET("/statistics", middleware.AccessRoute(protocol.WorkspaceRead, ""), batchTaskHandler.GetStatistics) // 统计信息
			batchTaskRoutes.GET("/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), batchTaskHandler.GetByID)              // 任务详情
			batchTaskRoutes.PUT("/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), batchTaskHandler.Update)               // 更新任务
			batchTaskRoutes.DELETE("/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), batchTaskHandler.Delete)            // 删除任务
			batchTaskRoutes.POST("/:id/start", middleware.AccessRoute(protocol.WorkspaceRead, ""), batchTaskHandler.Start)         // 启动任务
		}

		// 定时任务路由（需要认证）
		scheduledTaskRoutes := v1.Group("/scheduled-tasks")
		scheduledTaskRoutes.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
		scheduledTaskRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			scheduledTaskRoutes.GET("", middleware.OwnerRoute(protocol.ResourcesManage, ""), scheduledTaskHandler.List)                     // 任务列表
			scheduledTaskRoutes.POST("", middleware.OwnerRoute(protocol.ResourcesManage, ""), scheduledTaskHandler.Create)                  // 创建任务
			scheduledTaskRoutes.GET("/statistics", middleware.OwnerRoute(protocol.ResourcesManage, ""), scheduledTaskHandler.GetStatistics) // 统计信息
			scheduledTaskRoutes.GET("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), scheduledTaskHandler.GetByID)              // 任务详情
			scheduledTaskRoutes.PUT("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), scheduledTaskHandler.Update)               // 更新任务
			scheduledTaskRoutes.DELETE("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), scheduledTaskHandler.Delete)            // 删除任务
			scheduledTaskRoutes.POST("/:id/toggle", middleware.OwnerRoute(protocol.ResourcesManage, ""), scheduledTaskHandler.Toggle)       // 启用/禁用
			scheduledTaskRoutes.POST("/:id/trigger", middleware.OwnerRoute(protocol.ResourcesManage, ""), scheduledTaskHandler.Trigger)     // 手动触发
		}

		// 系统设置路由（需要认证）
		settingsGroup := v1.Group("/settings")
		settingsGroup.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
		settingsGroup.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			// 系统配置
			settingsGroup.GET("/system", middleware.OwnerRoute(protocol.OwnerManage, ""), systemConfigHandler.GetSystemConfig)
			// 系统配置 - 分组部分更新
			settingsGroup.PATCH("/system/basic", middleware.OwnerRoute(protocol.OwnerManage, ""), systemConfigHandler.PatchBasicInfo)
			settingsGroup.PATCH("/system/file-transfer", middleware.OwnerRoute(protocol.OwnerManage, ""), systemConfigHandler.PatchFileTransferConfig)
			settingsGroup.GET("/system/scheduled-tasks", middleware.OwnerRoute(protocol.OwnerManage, ""), systemConfigHandler.GetScheduledTaskConfig)
			settingsGroup.PATCH("/system/scheduled-tasks", middleware.OwnerRoute(protocol.OwnerManage, ""), systemConfigHandler.PatchScheduledTaskConfig)

			settingsGroup.GET("/workspace", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.GetWorkspaceConfig)
			settingsGroup.POST("/workspace", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.SaveWorkspaceConfig)
			settingsGroup.GET("/login-session", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.GetLoginSessionConfig)
			settingsGroup.POST("/login-session", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.SaveLoginSessionConfig)
			settingsGroup.GET("/login-security", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.GetLoginSecurityConfig)
			settingsGroup.POST("/login-security", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.SaveLoginSecurityConfig)
			settingsGroup.GET("/web-security", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.GetWebSecurityConfig)
			settingsGroup.POST("/web-security", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.SaveWebSecurityConfig)
			settingsGroup.GET("/cors", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.GetCORSConfig)
			settingsGroup.POST("/cors", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.SaveCORSConfig)

			// IP访问控制配置
			settingsGroup.GET("/access-control", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.GetAccessControlConfig)
			settingsGroup.POST("/access-control", middleware.OwnerRoute(protocol.OwnerManage, ""), securityHandler.SaveAccessControlConfig)

			// 通知配置 - 统一接口
			settingsGroup.GET("/notifications", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.GetAllNotificationConfig)
			settingsGroup.POST("/notifications", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.SaveAllNotificationConfig)

			// 通知配置 - SMTP
			settingsGroup.GET("/smtp", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.GetSMTPConfig)
			settingsGroup.POST("/smtp", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.SaveSMTPConfig)
			settingsGroup.POST("/smtp/test", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.TestSMTPConnection)

			// 通知配置 - Webhook
			settingsGroup.GET("/webhook", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.GetWebhookConfig)
			settingsGroup.POST("/webhook", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.SaveWebhookConfig)
			settingsGroup.POST("/webhook/test", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.TestWebhookConnection)

			// 通知配置 - 钉钉
			settingsGroup.GET("/dingtalk", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.GetDingTalkConfig)
			settingsGroup.POST("/dingtalk", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.SaveDingTalkConfig)
			settingsGroup.POST("/dingtalk/test", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.TestDingTalkConnection)

			// 通知配置 - 企业微信
			settingsGroup.GET("/wecom", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.GetWeComConfig)
			settingsGroup.POST("/wecom", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.SaveWeComConfig)
			settingsGroup.POST("/wecom/test", middleware.OwnerRoute(protocol.OwnerManage, ""), notificationConfigHandler.TestWeComConnection)

		}

		contentRoutes := v1.Group("/content")
		contentRoutes.Use(executionAuth)
		{
			contentRoutes.GET("/:id", middleware.AccessRoute(protocol.WorkspaceRead, ""), contentHandler.Reference)
			contentRoutes.GET("/:id/bytes", middleware.AccessRoute(protocol.WorkspaceRead, ""), contentHandler.Read)
		}

		// Chat connection management is owner-only; Telegram never receives an HTTP login scope.
		chatConnections := v1.Group("/chat-connections", middleware.AuthMiddleware(authService, ticketService, securityService), middleware.APIRateLimitMiddleware(securityService))
		{
			chatConnections.GET("", middleware.OwnerRoute(protocol.OwnerManage, ""), chatConnectionHandler.List)
			chatConnections.POST("", middleware.OwnerRoute(protocol.OwnerManage, ""), chatConnectionHandler.Save)
			chatConnections.GET("/:id", middleware.OwnerRoute(protocol.OwnerManage, ""), chatConnectionHandler.Detail)
			chatConnections.PUT("/:id", middleware.OwnerRoute(protocol.OwnerManage, ""), chatConnectionHandler.Save)
			chatConnections.DELETE("/:id", middleware.OwnerRoute(protocol.OwnerManage, ""), chatConnectionHandler.Delete)
			chatConnections.PATCH("/:id/enabled", middleware.OwnerRoute(protocol.OwnerManage, ""), chatConnectionHandler.SetEnabled)
			chatConnections.POST("/:id/bind-code", middleware.OwnerRoute(protocol.OwnerManage, ""), chatConnectionHandler.BindCode)
			chatConnections.DELETE("/:id/bindings/:binding_id", middleware.OwnerRoute(protocol.OwnerManage, ""), chatConnectionHandler.Revoke)
			chatConnections.GET("/:id/sessions", middleware.OwnerRoute(protocol.OwnerManage, ""), chatConnectionHandler.Sessions)
			chatConnections.GET("/:id/sessions/:session_id", middleware.OwnerRoute(protocol.OwnerManage, ""), chatConnectionHandler.Transcript)
		}

		// AI聊天路由（需要认证）
		aiChatRoutes := v1.Group("/ai")
		aiChatRoutes.Use(executionAuth)
		{
			aiChatRoutes.GET("/config", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiRuntimeConfigHandler.GetConfig)
			aiChatRoutes.GET("/sessions", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.ListSessions)
			aiChatRoutes.GET("/sessions/latest", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.GetLatestSession)
			aiChatRoutes.POST("/sessions", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.CreateSession)
			aiChatRoutes.GET("/sessions/:session_id", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.GetSession)
			aiChatRoutes.GET("/sessions/:session_id/history", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.History)
			aiChatRoutes.GET("/sessions/:session_id/tasks/:task_id/file", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.GetTaskFile)
			aiChatRoutes.PATCH("/sessions/:session_id", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.RenameSession)
			aiChatRoutes.POST("/sessions/:session_id/chat", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.Chat)
			aiChatRoutes.GET("/sessions/:session_id/chat/stream", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.ResumeChat)
			aiChatRoutes.POST("/sessions/:session_id/cancel", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.CancelSession)
			aiChatRoutes.PATCH("/sessions/:session_id/messages/:message_id", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.UpdateMessage)
			aiChatRoutes.DELETE("/sessions/:session_id/messages/:message_id", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.DeleteMessage)
			aiChatRoutes.DELETE("/sessions/:session_id", middleware.AccessRoute(protocol.WorkspaceRead, ""), aiSessionHandler.DeleteSession)
		}

		// Personal sync authorization is independent of system backup permissions.
		v1.POST("/sync/authorization/start", middleware.PublicRoute(), middleware.LoginRateLimitMiddleware(securityService), syncHandler.StartAuthorization)
		v1.POST("/sync/authorization/cancel", middleware.PublicRoute(), middleware.APIRateLimitMiddleware(securityService), syncHandler.CancelAuthorization)
		v1.POST("/sync/authorization/poll", middleware.PublicRoute(), middleware.APIRateLimitMiddleware(securityService), syncHandler.PollAuthorization)
		syncRoutes := v1.Group("/sync")
		syncRoutes.Use(middleware.AuthMiddleware(authService, ticketService, securityService))

		{
			syncRoutes.GET("/status", middleware.OwnerRoute(protocol.SyncWrite, ""), syncHandler.Status)
			syncRoutes.PUT("/settings", middleware.OwnerRoute(protocol.SyncWrite, ""), syncHandler.SetEnabled)
			syncRoutes.POST("/authorization/deny", middleware.OwnerRoute(protocol.SyncWrite, ""), syncHandler.DenyAuthorization)
			syncRoutes.POST("/authorization/info", middleware.OwnerRoute(protocol.SyncWrite, ""), syncHandler.AuthorizationInfo)
			syncRoutes.POST("/authorization/approve", middleware.OwnerRoute(protocol.SyncWrite, ""), syncHandler.ApproveAuthorization)
			syncRoutes.DELETE("/devices/:id", middleware.OwnerRoute(protocol.SyncWrite, ""), syncHandler.RevokeDevice)
			syncRoutes.PUT("/devices/:id/scopes", middleware.OwnerRoute(protocol.SyncWrite, ""), syncHandler.UpdateDeviceScopes)
			syncRoutes.POST("/vault/fork", middleware.OwnerRoute(protocol.SyncWrite, ""), syncHandler.ForkVaultSession)
			syncRoutes.POST("/resolve", middleware.OwnerRoute(protocol.SyncWrite, ""), syncHandler.Resolve)
		}
		deviceSyncRoutes := v1.Group("/sync/device")
		deviceSyncRoutes.Use(syncHandler.DeviceAuth())
		{
			deviceSyncRoutes.GET("", middleware.AccessRoute(protocol.SyncRead, ""), syncHandler.Identity)
			deviceSyncRoutes.POST("/exchange", middleware.AccessRoute(protocol.SyncWrite, ""), syncHandler.Exchange)
			deviceSyncRoutes.POST("/disconnect", middleware.AccessRoute(protocol.SyncWrite, ""), syncHandler.Disconnect)
			deviceSyncRoutes.GET("/vault", middleware.AccessRoute(protocol.SyncRead, ""), syncHandler.VaultList)
			deviceSyncRoutes.GET("/vault/objects/:id", middleware.AccessRoute(protocol.SyncRead, ""), syncHandler.VaultGet)
			deviceSyncRoutes.POST("/vault/objects/:id", middleware.AccessRoute(protocol.SyncWrite, ""), syncHandler.VaultPut)
			deviceSyncRoutes.POST("/vault/documents/:kind/:id", middleware.AccessRoute(protocol.SyncWrite, ""), syncHandler.VaultExchange)
		}
		backupRoutes := v1.Group("/backup")
		backupRoutes.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
		{
			backupRoutes.GET("/instances", middleware.OwnerRoute(protocol.BackupManage, ""), instanceBackupHandler.List)
			backupRoutes.POST("/instances", middleware.OwnerRoute(protocol.BackupManage, ""), instanceBackupHandler.Create)
			backupRoutes.POST("/instances/upload", middleware.OwnerRoute(protocol.BackupManage, ""), instanceBackupHandler.Upload)
			backupRoutes.GET("/instances/:id/download", middleware.OwnerRoute(protocol.BackupManage, ""), instanceBackupHandler.Download)
			backupRoutes.DELETE("/instances/:id", middleware.OwnerRoute(protocol.BackupManage, ""), instanceBackupHandler.Delete)
			backupRoutes.POST("/instances/:id/inspect", middleware.OwnerRoute(protocol.BackupManage, ""), instanceBackupHandler.Inspect)
			backupRoutes.POST("/instances/:id/restore", middleware.OwnerRoute(protocol.BackupManage, ""), instanceBackupHandler.Restore)
			backupRoutes.POST("/instances/:id/activate", middleware.OwnerRoute(protocol.BackupManage, ""), instanceBackupHandler.Activate)
			backupRoutes.POST("/activation/rollback", middleware.OwnerRoute(protocol.BackupManage, ""), instanceBackupHandler.Rollback)
		}

		// SSH密钥路由（需要认证）
		sshKeyRoutes := v1.Group("/ssh-keys")
		sshKeyRoutes.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
		sshKeyRoutes.Use(middleware.AuditLogMiddleware(auditLogService, nil))
		{
			sshKeyRoutes.GET("", middleware.OwnerRoute(protocol.CredentialsRead, ""), sshKeyHandler.GetSSHKeys)               // 获取密钥列表
			sshKeyRoutes.POST("/generate", middleware.OwnerRoute(protocol.ResourcesManage, ""), sshKeyHandler.GenerateSSHKey) // 生成密钥
			sshKeyRoutes.POST("/import", middleware.OwnerRoute(protocol.ResourcesManage, ""), sshKeyHandler.ImportSSHKey)     // 导入密钥
			sshKeyRoutes.GET("/:id/references", middleware.OwnerRoute(protocol.CredentialsRead, ""), sshKeyHandler.GetReferences)
			sshKeyRoutes.PUT("/:id/passphrase", middleware.OwnerRoute(protocol.ResourcesManage, ""), sshKeyHandler.SetPassphrase)
			sshKeyRoutes.DELETE("/:id", middleware.OwnerRoute(protocol.ResourcesManage, ""), sshKeyHandler.DeleteSSHKey) // 删除密钥
		}

		// 头像生成路由（需要认证）
		avatarRoutes := v1.Group("/avatar")
		avatarRoutes.Use(middleware.AuthMiddleware(authService, ticketService, securityService))
		{
			avatarRoutes.POST("/generate", middleware.OwnerRoute(protocol.OwnerManage, ""), avatarHandler.GenerateAvatar) // 生成头像
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

	if err := v1.Audit(r.Routes()); err != nil {
		log.Fatal(err)
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
	// Prepare the queue and scheduler while execution is gated. Failures here
	// still belong to candidate startup and trigger launcher rollback.
	if err := transferJobService.RecoverInterrupted(context.Background()); err != nil {
		log.Fatalf("Failed to recover transfer outcomes: %v", err)
	}
	if err := jobQueue.Start(context.Background()); err != nil {
		log.Fatalf("Failed to start database job queue: %v", err)
	}
	if err := taskScheduler.Start(); err != nil {
		if launcher != nil {
			log.Fatal(err)
		}
		log.Printf("Warning: Failed to start task scheduler: %v", err)
	}
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
	close(instanceStarted)
	inboxNotificationService.Start(context.Background())
	chatConnectionService.Start(context.Background())
	taskCenterService.StartRetention(context.Background())
	transferJobService.StartMaintenance(context.Background())
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
	chatConnectionService.Stop()

	aiStopContext, cancelAIStop := context.WithTimeout(context.Background(), 30*time.Second)
	if err := aiRuntimeManager.Stop(aiStopContext); err != nil {
		log.Printf("⚠️ AI shutdown incomplete; results may still await persistence: %v", err)
	} else {
		log.Println("✅ AI runtime stopped and conversation results saved")
	}
	cancelAIStop()

	taskCenterService.StopRetention()
	log.Println("✅ Task retention worker stopped")

	// 停止任务调度器
	taskScheduler.Stop()
	log.Println("✅ Task scheduler stopped")

	jobQueue.Stop()
	log.Println("✅ Database job queue stopped")

	executorStopContext, cancelExecutorStop := context.WithTimeout(context.Background(), 30*time.Second)
	if err := taskExecutor.Stop(executorStopContext); err != nil {
		log.Printf("⚠️ Task executor shutdown incomplete; outcomes may await persistence: %v", err)
	} else {
		log.Println("✅ Task executor stopped and observed outcomes saved")
	}
	cancelExecutorStop()

	transferStopContext, cancelTransferStop := context.WithTimeout(context.Background(), 30*time.Second)
	if err := transferJobService.Stop(transferStopContext); err != nil {
		log.Printf("⚠️ Transfer shutdown incomplete; outcomes may await persistence: %v", err)
	} else {
		log.Println("✅ Transfer job service stopped and outcomes saved")
	}
	cancelTransferStop()

	dockerStopContext, cancelDockerStop := context.WithTimeout(context.Background(), 30*time.Second)
	if err := dockerService.Stop(dockerStopContext); err != nil {
		log.Printf("⚠️ Docker shutdown incomplete: %v", err)
	}
	cancelDockerStop()
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
