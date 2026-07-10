package main

import (
	"embed"

	"log"
	"os"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Wails uses Go's `embed` package to embed the frontend files into the binary.
// Any files in the frontend/dist folder will be embedded into the binary and
// made available to the frontend.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

// main initializes the desktop shell. The first screen is the SSH/SFTP workspace;
// Dashboard navigation and server administration stay outside this window shell.
func main() {
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
	serverService := NewDesktopServerService()
	scriptService := NewDesktopScriptService(serverService, activityLogService, taskService)
	terminalService := NewDesktopTerminalService(serverService)
	sftpService := NewDesktopSFTPService(serverService, activityLogService, notificationService, taskService)
	monitorService := NewDesktopMonitorService(serverService)
	desktopGateway := NewDesktopGateway(serverService, scriptService, monitorService, sftpService)
	dockerService := NewDesktopDockerService(serverService)
	aiService := NewDesktopAIService(serverService, sftpService, monitorService)
	backupService := NewDesktopBackupService()
	updateService := NewDesktopUpdateService()

	app := application.New(application.Options{
		Name:         "EasySSH",
		Description:  "EasySSH",
		Icon:         appIcon,
		Logger:       newDesktopWailsLogger(),
		PanicHandler: handleDesktopPanic,
		Services: []application.Service{
			application.NewService(taskService),
			application.NewService(serverService),
			application.NewService(scriptService),
			application.NewService(terminalService),
			application.NewService(desktopGateway),
			application.NewService(sftpService),
			application.NewService(monitorService),
			application.NewService(dockerService),
			application.NewService(activityLogService),
			application.NewService(backupService),
			application.NewService(NewDesktopService(desktopGateway)),
			application.NewService(updateService),
			application.NewService(aiService),
			application.NewService(notificationService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		Windows: application.WindowsOptions{DisableQuitOnLastWindowClosed: true},
		Linux:   application.LinuxOptions{DisableQuitOnLastWindowClosed: true},
	})

	if err := updateService.attachApp(app); err != nil {
		log.Printf("failed to initialize desktop updater: %v", err)
	}

	mainWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "EasySSH",
		Width:     1320,
		Height:    860,
		MinWidth:  960,
		MinHeight: 620,
		Frameless: true,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(13, 17, 23, 0),
		URL:              "/",
	})
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
	trayMenu.Add("显示 EasySSH").OnClick(func(*application.Context) { mainWindow.Show().Focus() })
	trayMenu.AddSeparator()
	trayMenu.Add("退出").OnClick(func(*application.Context) {
		quitting.Store(true)
		app.Quit()
	})
	tray := app.SystemTray.New().SetIcon(appIcon).SetMenu(trayMenu).OnClick(func() { mainWindow.Show().Focus() })
	tray.SetTooltip("EasySSH")
	notificationService.attachTray(tray)

	err := app.Run()
	if err != nil {
		log.Printf("desktop app failed: %v", err)
		closeDesktopLogger()
		os.Exit(1)
	}
}
