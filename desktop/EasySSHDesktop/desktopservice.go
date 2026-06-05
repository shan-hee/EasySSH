package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type DesktopCapability string

type DesktopRuntimeInfo struct {
	Profile      string                     `json:"profile"`
	Version      string                     `json:"version"`
	Platform     string                     `json:"platform"`
	Arch         string                     `json:"arch"`
	DataDir      string                     `json:"dataDir"`
	Capabilities map[DesktopCapability]bool `json:"capabilities"`
}

type DesktopService struct{}

func (s *DesktopService) RuntimeInfo() DesktopRuntimeInfo {
	return DesktopRuntimeInfo{
		Profile:  "desktop",
		Version:  readVersion(),
		Platform: runtime.GOOS,
		Arch:     runtime.GOARCH,
		DataDir:  desktopDataDir(),
		Capabilities: map[DesktopCapability]bool{
			"servers":          true,
			"terminal":         true,
			"sftp":             false,
			"transfers":        false,
			"monitoring":       false,
			"docker":           false,
			"ai":               true,
			"activity_log":     true,
			"settings":         true,
			"desktop_data_dir": true,
			"open_data_dir":    true,
			"portable_mode":    true,
		},
	}
}

func (s *DesktopService) OpenDataDir() error {
	dataDir := desktopDataDir()
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}

	app := application.Get()
	if app == nil || app.Env == nil {
		return fmt.Errorf("application environment is not ready")
	}

	return app.Env.OpenFileManager(dataDir, false)
}

func readVersion() string {
	for _, candidate := range []string{"../../VERSION", "../VERSION", "VERSION"} {
		content, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}

		version := strings.TrimSpace(string(content))
		if version != "" {
			return version
		}
	}

	return "0.1.0"
}

func desktopDataDir() string {
	baseDir, err := os.UserConfigDir()
	if err != nil || baseDir == "" {
		baseDir = os.TempDir()
	}

	return filepath.Join(baseDir, "EasySSH", "Desktop")
}
