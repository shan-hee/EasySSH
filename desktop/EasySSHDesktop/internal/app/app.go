package app

import (
	"context"
	"io/fs"

	"log"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/easyssh/shared/instanceactivation"
	"github.com/easyssh/shared/instancebackup"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

// Run starts the desktop application with assets embedded by the executable.
func Run(assets fs.FS, appIcon []byte) {
	updater.HandleHelperMode()
	if len(os.Args) > 1 && os.Args[1] == "maintenance" {
		if err := runDesktopMaintenance(os.Args[2:]); err != nil {
			log.Print(err)
			os.Exit(1)
		}
		return
	}
	if managed, err := runDesktopInstanceLauncher(); managed {
		if err != nil {
			log.Fatal(err)
		}
		return
	}
	nativeBoundary := newDesktopNativeBoundary()
	remoteWorkspaces := newDesktopRemoteWorkspaceService(nil, nativeBoundary)
	var mainWindow *application.WebviewWindow
	var visibleWindow atomic.Pointer[application.WebviewWindow]

	showMainWindow := func() {
		window := visibleWindow.Load()
		if window == nil {
			return
		}
		window.Show()
		window.UnMinimise()
		window.Focus()
	}

	app := application.New(application.Options{
		Name:                "EasySSH",
		Description:         "EasySSH",
		Icon:                appIcon,
		Logger:              newDesktopWailsLogger(),
		PanicHandler:        handleDesktopPanic,
		NativeRuntimePolicy: nativeBoundary.allowRuntime,
		NativeEventPolicy:   nativeBoundary.allowEvent,
		NativeMessagePolicy: nativeBoundary.allowMessage,
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: nativeBoundary.assets,
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.easyssh.desktop",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if raw, err := desktopLaunchArgument(data.Args); err == nil {
					_ = remoteWorkspaces.receiveLaunch(raw, time.Time{})
				}
				showMainWindow()
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		Windows: application.WindowsOptions{DisableQuitOnLastWindowClosed: true},
		Linux:   application.LinuxOptions{DisableQuitOnLastWindowClosed: true},
	})
	// Wails single-instance identification happens before any data-directory
	// lock, logger or service constructor, including unmanaged development mode.
	instanceLock, err := instancebackup.Lock(desktopDataDir())
	if err != nil {
		log.Fatal(err)
	}
	defer instanceLock.Close()

	if err := ensureDesktopDataDir(); err != nil {
		log.Fatalf("failed to initialize desktop data directory: %v", err)
	}
	if err := initDesktopLogger(); err != nil {
		log.Fatalf("failed to initialize desktop logger: %v", err)
	}
	defer closeDesktopLogger()

	activityLogService := NewActivityLogService()
	notificationService := NewDesktopNotificationService()
	taskService := NewDesktopTaskService(notificationService)
	database, err := taskService.database()
	if err != nil {
		log.Fatalf("failed to initialize desktop database: %v", err)
	}
	if err := initDesktopProxy(database); err != nil {
		log.Fatalf("failed to initialize desktop network proxy: %v", err)
	}
	activityLogService.tasks = taskService
	serverService := NewDesktopServerService(activityLogService, taskService)
	scriptService := NewDesktopScriptService(serverService, taskService)
	terminalService := NewDesktopTerminalService(serverService, activityLogService)
	sftpService := NewDesktopSFTPService(serverService, taskService, activityLogService)
	monitorService := NewDesktopMonitorService(serverService, activityLogService)
	desktopGateway := NewDesktopGateway(serverService, scriptService, monitorService, sftpService, activityLogService)
	dockerService := NewDesktopDockerService(serverService, taskService)
	aiService := NewDesktopAIService(serverService, sftpService, monitorService)
	backupService := NewDesktopBackupService()
	updateService := NewDesktopUpdateService()
	remoteWorkspaces.servers = serverService
	for _, service := range []application.Service{
		application.NewService(activityLogService),
		application.NewService(taskService),
		application.NewService(&DesktopContentService{database: taskService.database}),
		application.NewService(serverService),
		application.NewService(remoteWorkspaces),
		application.NewService(scriptService),
		application.NewService(terminalService),
		application.NewService(sftpService),
		application.NewService(monitorService),
		application.NewService(desktopGateway),
		application.NewService(dockerService),
		application.NewService(backupService),
		application.NewService(NewDesktopSyncService(serverService, scriptService, sftpService, aiService)),
		application.NewService(NewDesktopService(desktopGateway, taskService.database)),
		application.NewService(updateService),
		application.NewService(aiService),
		application.NewService(notificationService),
		application.NewService(&DesktopActivationService{backup: backupService}),
	} {
		app.RegisterService(service)
	}
	remoteWorkspaces.app = app
	app.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(event *application.ApplicationEvent) {
		if err := remoteWorkspaces.receiveLaunch(event.Context().URL(), time.Time{}); err == nil {
			showMainWindow()
		}
	})

	if err := updateService.attachApp(app); err != nil {
		log.Printf("failed to initialize desktop updater: %v", err)
	}

	launcher := instanceactivation.FromEnvironment()
	mainWindow = app.Window.NewWithOptions(application.WebviewWindowOptions{
		RestrictNavigation: true,
		Title:              "EasySSH",
		Width:              1320,
		Height:             860,
		MinWidth:           960,
		MinHeight:          620,
		Frameless:          true,
		EnableFileDrop:     true,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(13, 17, 23, 0),
		URL:              "/",
		Hidden:           launcher != nil,
	})
	nativeBoundary.register(mainWindow, "")
	visibleWindow.Store(mainWindow)
	taskService.attachWindow(mainWindow)

	var quitting atomic.Bool
	mainWindow.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if quitting.Load() {
			return
		}
		event.Cancel()
		mainWindow.Hide()
	})

	trayMenu := application.NewMenu()
	trayMenu.Add("显示 EasySSH").OnClick(func(*application.Context) { showMainWindow() })
	trayMenu.AddSeparator()
	trayMenu.Add("退出").OnClick(func(*application.Context) {
		quitting.Store(true)
		app.Quit()
	})
	tray := app.SystemTray.New().SetIcon(appIcon).SetMenu(trayMenu).OnClick(showMainWindow)
	tray.SetTooltip("EasySSH")
	notificationService.attachTray(tray)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var launchWorkers sync.WaitGroup
	defer func() { cancel(); launchWorkers.Wait() }()
	if launcher != nil {
		var startupHandled atomic.Bool
		// ApplicationStarted can fire before WebView2 has finished initializing.
		// Wait for the window runtime before committing the selected instance.
		mainWindow.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
			if !startupHandled.CompareAndSwap(false, true) {
				return
			}
			if err := launcher.Serving(ctx); err != nil {
				log.Printf("desktop instance startup failed: %v", err)
				quitting.Store(true)
				app.Quit()
				return
			}
			close(desktopInstanceStarted)
			showMainWindow()
			go func() {
				select {
				case <-ctx.Done():
				case <-launcher.Shutdown(ctx):
					quitting.Store(true)
					app.Quit()
				}
			}()
		})
	}
	if launcher == nil {
		close(desktopInstanceStarted)
		if raw, err := desktopLaunchArgument(os.Args[1:]); err == nil {
			_ = remoteWorkspaces.receiveLaunch(raw, time.Time{})
		}
	} else {
		launchWorkers.Add(1)
		go func() {
			defer launchWorkers.Done()
			remoteWorkspaces.receiveLauncherRequests(ctx, launcher, showMainWindow)
		}()
	}
	err = app.Run()
	if err != nil {
		log.Printf("desktop app failed: %v", err)
		closeDesktopLogger()
		os.Exit(1)
	}
}
