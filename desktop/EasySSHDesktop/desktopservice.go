package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

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

type DesktopPreferenceSnapshot map[string]string

type DesktopService struct{}

var desktopPreferenceMu sync.Mutex

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
			"sftp":             true,
			"transfers":        true,
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

func (s *DesktopService) ListPreferences() (DesktopPreferenceSnapshot, error) {
	desktopPreferenceMu.Lock()
	defer desktopPreferenceMu.Unlock()

	preferences, err := readDesktopPreferences()
	if err != nil {
		return nil, err
	}

	return preferences, nil
}

func (s *DesktopService) SetPreference(key string, value string) error {
	if err := validateDesktopPreferenceKey(key); err != nil {
		return err
	}

	desktopPreferenceMu.Lock()
	defer desktopPreferenceMu.Unlock()

	preferences, err := readDesktopPreferences()
	if err != nil {
		return err
	}

	preferences[key] = value
	return writeDesktopPreferences(preferences)
}

func (s *DesktopService) RemovePreference(key string) error {
	if err := validateDesktopPreferenceKey(key); err != nil {
		return err
	}

	desktopPreferenceMu.Lock()
	defer desktopPreferenceMu.Unlock()

	preferences, err := readDesktopPreferences()
	if err != nil {
		return err
	}

	delete(preferences, key)
	return writeDesktopPreferences(preferences)
}

func validateDesktopPreferenceKey(key string) error {
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("preference key is required")
	}
	if strings.ContainsRune(key, '\x00') {
		return fmt.Errorf("preference key contains invalid characters")
	}
	return nil
}

func desktopPreferencesPath() string {
	return filepath.Join(desktopDataDir(), "preferences.json")
}

func readDesktopPreferences() (DesktopPreferenceSnapshot, error) {
	content, err := os.ReadFile(desktopPreferencesPath())
	if errors.Is(err, os.ErrNotExist) {
		return DesktopPreferenceSnapshot{}, nil
	}
	if err != nil {
		return nil, err
	}

	var preferences DesktopPreferenceSnapshot
	if len(content) > 0 {
		if err := json.Unmarshal(content, &preferences); err != nil {
			return nil, err
		}
	}
	if preferences == nil {
		return DesktopPreferenceSnapshot{}, nil
	}

	return preferences, nil
}

func writeDesktopPreferences(preferences DesktopPreferenceSnapshot) error {
	dataDir := desktopDataDir()
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}

	content, err := json.MarshalIndent(preferences, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(desktopPreferencesPath(), append(content, '\n'), 0o600)
}
