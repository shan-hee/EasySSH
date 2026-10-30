package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type DesktopCapability = protocol.RuntimeCapability

type DesktopRuntimeInfo = protocol.DesktopRuntimeInfo

type DesktopUpdateFailureNotice = protocol.DesktopUpdateFailureNotice

type DesktopPreferenceSnapshot map[string]string

type DesktopService struct {
	gateway  *DesktopGateway
	database func() (*sql.DB, error)
}

func NewDesktopService(gateway *DesktopGateway, database func() (*sql.DB, error)) *DesktopService {
	return &DesktopService{gateway: gateway, database: database}
}

var desktopPreferenceMu sync.Mutex

func (s *DesktopService) RuntimeInfo() DesktopRuntimeInfo {
	var gateway DesktopGatewayInfo
	if s.gateway != nil {
		gateway = s.gateway.Info()
	}

	return DesktopRuntimeInfo{
		Profile:  "desktop",
		Version:  readVersion(),
		Platform: runtime.GOOS,
		Arch:     runtime.GOARCH,
		DataDir:  desktopDataDir(),
		Gateway:  gateway,
		Capabilities: map[DesktopCapability]bool{
			"servers":          true,
			"scripts":          true,
			"terminal":         true,
			"sftp":             true,
			"transfers":        true,
			"tasks":            true,
			"monitoring":       true,
			"docker":           true,
			"ai":               true,
			"activity_log":     true,
			"backup":           true,
			"settings":         true,
			"desktop_data_dir": true,
			"open_data_dir":    true,
			"portable_mode":    true,
			"automation":       false,
			"audit":            false,
			"login_logs":       false,
			"notifications":    true,
			"oauth":            false,
			"security_policy":  false,
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

func (s *DesktopService) OpenPathInFileManager(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("path is required")
	}

	app := application.Get()
	if app == nil || app.Env == nil {
		return fmt.Errorf("application environment is not ready")
	}

	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			parent := filepath.Dir(path)
			if parent == "." || parent == "" {
				return err
			}
			return app.Env.OpenFileManager(parent, false)
		}
		return err
	}

	return app.Env.OpenFileManager(path, !info.IsDir())
}

func (s *DesktopService) GetUpdateFailureNotice() (*DesktopUpdateFailureNotice, error) {
	path := desktopUpdateFailureNoticePath()
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var notice DesktopUpdateFailureNotice
	if err := json.Unmarshal(content, &notice); err != nil {
		return nil, err
	}

	return &notice, nil
}

func (s *DesktopService) ClearUpdateFailureNotice() error {
	err := os.Remove(desktopUpdateFailureNoticePath())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
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

	return desktopBundledVersion
}

func desktopDataDir() string {
	if value := os.Getenv("EASYSSH_DESKTOP_DATA_DIR"); value != "" {
		resolved, err := filepath.Abs(value)
		if err != nil {
			panic(err)
		}
		return resolved
	}

	executablePath, err := os.Executable()
	if err != nil {
		panic(fmt.Errorf("failed to resolve desktop executable path: %w", err))
	}

	return filepath.Join(filepath.Dir(executablePath), "data")
}

func ensureDesktopDataDir() error {
	return os.MkdirAll(desktopDataDir(), 0o755)
}

func (s *DesktopService) ListPreferences() (DesktopPreferenceSnapshot, error) {
	desktopPreferenceMu.Lock()
	defer desktopPreferenceMu.Unlock()

	preferences, err := readDesktopPreferences()
	if err != nil {
		return nil, err
	}
	db, err := s.database()
	if err != nil {
		return nil, err
	}
	config, err := readDesktopProxy(db)
	if err != nil {
		return nil, err
	}
	value, err := publicDesktopProxy(config)
	if err != nil {
		return nil, err
	}
	preferences[desktopProxyPreferenceKey] = value

	return preferences, nil
}

func (s *DesktopService) SetPreference(key string, value string) error {
	if err := validateDesktopPreferenceKey(key); err != nil {
		return err
	}
	desktopPreferenceMu.Lock()
	defer desktopPreferenceMu.Unlock()
	if key == desktopProxyPreferenceKey {
		return s.saveProxy(value)
	}

	preferences, err := readDesktopPreferences()
	if err != nil {
		return err
	}

	preferences[key] = value
	if err := writeDesktopPreferences(preferences); err != nil {
		return err
	}
	return nil
}

func (s *DesktopService) RemovePreference(key string) error {
	if err := validateDesktopPreferenceKey(key); err != nil {
		return err
	}

	desktopPreferenceMu.Lock()
	defer desktopPreferenceMu.Unlock()
	if key == desktopProxyPreferenceKey {
		return s.saveProxy(`{"mode":"system"}`)
	}

	preferences, err := readDesktopPreferences()
	if err != nil {
		return err
	}

	delete(preferences, key)
	if err := writeDesktopPreferences(preferences); err != nil {
		return err
	}
	return nil
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

func desktopUpdateFailureNoticePath() string {
	return filepath.Join(desktopDataDir(), "update-failure.json")
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
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
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
