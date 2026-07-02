package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/updatecheck"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
)

const desktopUpdateEventName = "easyssh:desktop:update-status"

type DesktopUpdateStatus string

const (
	DesktopUpdateStatusIdle        DesktopUpdateStatus = "idle"
	DesktopUpdateStatusChecking    DesktopUpdateStatus = "checking"
	DesktopUpdateStatusUpToDate    DesktopUpdateStatus = "up_to_date"
	DesktopUpdateStatusAvailable   DesktopUpdateStatus = "available"
	DesktopUpdateStatusDownloading DesktopUpdateStatus = "downloading"
	DesktopUpdateStatusVerifying   DesktopUpdateStatus = "verifying"
	DesktopUpdateStatusReady       DesktopUpdateStatus = "ready"
	DesktopUpdateStatusError       DesktopUpdateStatus = "error"
)

type DesktopUpdateCheckResult struct {
	CurrentVersion string              `json:"current_version"`
	LatestVersion  string              `json:"latest_version"`
	HasUpdate      bool                `json:"has_update"`
	Status         DesktopUpdateStatus `json:"status"`
	ReleaseURL     string              `json:"release_url,omitempty"`
	PublishedAt    string              `json:"published_at,omitempty"`
	Notes          string              `json:"notes,omitempty"`
	Artifact       *DesktopUpdateAsset `json:"artifact,omitempty"`
	Error          string              `json:"error,omitempty"`
}

type DesktopUpdateAsset struct {
	Filename    string `json:"filename"`
	DownloadURL string `json:"download_url"`
	Size        int64  `json:"size,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
	Platform    string `json:"platform"`
	Arch        string `json:"arch"`
}

type DesktopUpdateProgress struct {
	Status         DesktopUpdateStatus `json:"status"`
	CurrentVersion string              `json:"current_version"`
	LatestVersion  string              `json:"latest_version,omitempty"`
	Written        int64               `json:"written,omitempty"`
	Total          int64               `json:"total,omitempty"`
	Rate           float64             `json:"rate,omitempty"`
	Error          string              `json:"error,omitempty"`
	ReleaseURL     string              `json:"release_url,omitempty"`
}

type DesktopUpdateService struct {
	mu        sync.Mutex
	app       *application.App
	current   string
	status    DesktopUpdateStatus
	lastCheck *DesktopUpdateCheckResult
}

func NewDesktopUpdateService() *DesktopUpdateService {
	return &DesktopUpdateService{
		current: readVersion(),
		status:  DesktopUpdateStatusIdle,
	}
}

func (s *DesktopUpdateService) attachApp(app *application.App) error {
	if app == nil || app.Updater == nil {
		return errors.New("application updater is not ready")
	}

	s.app = app
	if err := app.Updater.Init(updater.Config{
		CurrentVersion: s.current,
		Providers: []updater.Provider{
			newDesktopManifestProvider(updatecheck.DefaultManifestURL),
		},
		Window: updater.WindowNone,
	}); err != nil {
		return err
	}

	s.subscribeUpdaterEvents(app)
	return nil
}

func (s *DesktopUpdateService) GetUpdateStatus() DesktopUpdateCheckResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.lastCheck != nil {
		result := *s.lastCheck
		result.Status = s.status
		return result
	}

	return DesktopUpdateCheckResult{
		CurrentVersion: s.current,
		Status:         s.status,
	}
}

func (s *DesktopUpdateService) CheckForUpdate() (DesktopUpdateCheckResult, error) {
	if s.app == nil || s.app.Updater == nil {
		return DesktopUpdateCheckResult{}, errors.New("application updater is not ready")
	}

	s.setStatus(DesktopUpdateStatusChecking, "")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	release, err := s.app.Updater.Check(ctx)
	if err != nil {
		result := s.resultFromState(DesktopUpdateStatusError, err.Error())
		s.storeResult(result)
		s.emitStatus(result)
		return result, err
	}

	if release == nil {
		result := s.resultFromState(DesktopUpdateStatusUpToDate, "")
		result.LatestVersion = s.current
		result.HasUpdate = false
		result.ReleaseURL = ""
		result.PublishedAt = ""
		result.Notes = ""
		result.Artifact = nil
		s.storeResult(result)
		s.emitStatus(result)
		return result, nil
	}

	result := s.resultFromState(DesktopUpdateStatusAvailable, "")
	result.LatestVersion = release.Version
	result.HasUpdate = true
	result.Artifact = assetFromRelease(release)
	if value, ok := release.Metadata["easyssh.release.url"].(string); ok {
		result.ReleaseURL = value
	}
	if value, ok := release.Metadata["easyssh.published_at"].(string); ok {
		result.PublishedAt = value
	}
	result.Notes = release.Notes
	s.storeResult(result)
	s.emitStatus(result)
	return result, nil
}

func (s *DesktopUpdateService) InstallUpdate() (DesktopUpdateCheckResult, error) {
	if s.app == nil || s.app.Updater == nil {
		return DesktopUpdateCheckResult{}, errors.New("application updater is not ready")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := s.app.Updater.DownloadAndInstall(ctx); err != nil {
		result := s.resultFromState(DesktopUpdateStatusError, err.Error())
		s.storeResult(result)
		s.emitStatus(result)
		return result, err
	}

	result := s.resultFromState(DesktopUpdateStatusReady, "")
	result.HasUpdate = true
	s.storeResult(result)
	s.emitStatus(result)
	return result, nil
}

func (s *DesktopUpdateService) RestartToUpdate() error {
	if s.app == nil || s.app.Updater == nil {
		return errors.New("application updater is not ready")
	}
	return s.app.Updater.Restart(context.Background())
}

func (s *DesktopUpdateService) subscribeUpdaterEvents(app *application.App) {
	app.Event.On(updater.EventDownloadProgress, func(event *application.CustomEvent) {
		progress, ok := parseUpdaterProgress(event)
		if !ok {
			return
		}
		s.emitProgress(DesktopUpdateProgress{
			Status:         DesktopUpdateStatusDownloading,
			CurrentVersion: s.current,
			LatestVersion:  s.latestVersion(),
			Written:        progress.Written,
			Total:          progress.Total,
			Rate:           progress.Rate,
			ReleaseURL:     s.releaseURL(),
		})
	})
	app.Event.On(updater.EventVerifying, func(*application.CustomEvent) {
		s.setStatus(DesktopUpdateStatusVerifying, "")
	})
	app.Event.On(updater.EventUpdateReady, func(*application.CustomEvent) {
		s.setStatus(DesktopUpdateStatusReady, "")
	})
	app.Event.On(updater.EventError, func(event *application.CustomEvent) {
		message := "update failed"
		if info, ok := parseUpdaterError(event); ok && info.Message != "" {
			message = info.Message
		}
		s.setStatus(DesktopUpdateStatusError, message)
	})
}

func (s *DesktopUpdateService) setStatus(status DesktopUpdateStatus, message string) {
	result := s.resultFromState(status, message)
	s.storeResult(result)
	s.emitStatus(result)
}

func (s *DesktopUpdateService) resultFromState(status DesktopUpdateStatus, message string) DesktopUpdateCheckResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	result := DesktopUpdateCheckResult{
		CurrentVersion: s.current,
		Status:         status,
		Error:          message,
	}
	if s.lastCheck != nil {
		result.LatestVersion = s.lastCheck.LatestVersion
		result.HasUpdate = s.lastCheck.HasUpdate
		result.ReleaseURL = s.lastCheck.ReleaseURL
		result.PublishedAt = s.lastCheck.PublishedAt
		result.Notes = s.lastCheck.Notes
		result.Artifact = s.lastCheck.Artifact
	}
	return result
}

func (s *DesktopUpdateService) storeResult(result DesktopUpdateCheckResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = result.Status
	copied := result
	s.lastCheck = &copied
}

func (s *DesktopUpdateService) latestVersion() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastCheck != nil {
		return s.lastCheck.LatestVersion
	}
	return ""
}

func (s *DesktopUpdateService) releaseURL() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastCheck != nil {
		return s.lastCheck.ReleaseURL
	}
	return ""
}

func (s *DesktopUpdateService) emitStatus(result DesktopUpdateCheckResult) {
	s.emitProgress(DesktopUpdateProgress{
		Status:         result.Status,
		CurrentVersion: result.CurrentVersion,
		LatestVersion:  result.LatestVersion,
		Error:          result.Error,
		ReleaseURL:     result.ReleaseURL,
	})
}

func (s *DesktopUpdateService) emitProgress(progress DesktopUpdateProgress) {
	if s.app == nil {
		return
	}
	s.app.Event.Emit(desktopUpdateEventName, progress)
}

type desktopManifestProvider struct {
	manifestURL string
	client      *http.Client
}

func newDesktopManifestProvider(manifestURL string) *desktopManifestProvider {
	if value := strings.TrimSpace(os.Getenv("EASYSSH_UPDATE_MANIFEST_URL")); value != "" {
		manifestURL = value
	}
	if strings.TrimSpace(manifestURL) == "" {
		manifestURL = updatecheck.DefaultManifestURL
	}

	return &desktopManifestProvider{
		manifestURL: manifestURL,
		client:      &http.Client{Timeout: 30 * time.Second},
	}
}

func (p *desktopManifestProvider) Name() string {
	return "easyssh-manifest"
}

func (p *desktopManifestProvider) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	manifest, err := updatecheck.Fetcher{URL: p.manifestURL, HTTPClient: p.client}.Fetch(ctx)
	if err != nil {
		return nil, err
	}
	if !updatecheck.IsNewer(manifest.Version, req.CurrentVersion) {
		return nil, nil
	}

	key := updatecheck.DesktopTargetKey(req.Platform, req.Arch)
	target, ok := manifest.Desktop[key]
	if !ok {
		return nil, fmt.Errorf("update manifest has no desktop asset for %s", key)
	}
	if strings.TrimSpace(target.DownloadURL) == "" {
		return nil, fmt.Errorf("desktop update asset %s has no download_url", key)
	}

	release := &updater.Release{
		Version: manifest.Version,
		Name:    "EasySSH " + manifest.Version,
		Notes:   manifest.Notes,
		Artifact: updater.Artifact{
			Filename: target.Filename,
			Filetype: filetypeFromName(target.Filename),
			Size:     target.Size,
			Platform: target.Platform,
			Arch:     target.Arch,
		},
		Metadata: map[string]any{
			"easyssh.download_url":  target.DownloadURL,
			"easyssh.release.url":   manifest.ReleaseURL,
			"easyssh.published_at":  manifest.PublishedAt,
			"easyssh.artifact.sha":  target.SHA256,
			"easyssh.artifact.name": target.Filename,
		},
	}

	if target.SHA256 != "" {
		digest, err := hex.DecodeString(strings.TrimSpace(target.SHA256))
		if err != nil {
			return nil, fmt.Errorf("desktop update sha256 is invalid: %w", err)
		}
		release.Verification = &updater.Verification{
			DigestAlgo: "sha256",
			Digest:     digest,
		}
	}

	return release, nil
}

func (p *desktopManifestProvider) Download(ctx context.Context, release *updater.Release, dst io.Writer, onProgress func(written, total int64)) error {
	if release == nil || release.Metadata == nil {
		return errors.New("desktop update release is missing metadata")
	}

	url, ok := release.Metadata["easyssh.download_url"].(string)
	if !ok || strings.TrimSpace(url) == "" {
		return errors.New("desktop update release has no download URL")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/octet-stream")

	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download desktop update: HTTP %d", resp.StatusCode)
	}

	total := release.Artifact.Size
	if total == 0 && resp.ContentLength > 0 {
		total = resp.ContentLength
	}

	hasher := sha256.New()
	writer := io.MultiWriter(dst, hasher)
	buffer := make([]byte, 64*1024)
	var written int64
	for {
		n, readErr := resp.Body.Read(buffer)
		if n > 0 {
			if _, writeErr := writer.Write(buffer[:n]); writeErr != nil {
				return writeErr
			}
			written += int64(n)
			onProgress(written, total)
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return readErr
		}
	}

	if expected, _ := release.Metadata["easyssh.artifact.sha"].(string); expected != "" {
		actual := hex.EncodeToString(hasher.Sum(nil))
		if !strings.EqualFold(strings.TrimSpace(expected), actual) {
			return fmt.Errorf("desktop update digest mismatch")
		}
	}

	return nil
}

func assetFromRelease(release *updater.Release) *DesktopUpdateAsset {
	if release == nil {
		return nil
	}
	asset := &DesktopUpdateAsset{
		Filename: release.Artifact.Filename,
		Size:     release.Artifact.Size,
		Platform: release.Artifact.Platform,
		Arch:     release.Artifact.Arch,
	}
	if value, ok := release.Metadata["easyssh.download_url"].(string); ok {
		asset.DownloadURL = value
	}
	if value, ok := release.Metadata["easyssh.artifact.sha"].(string); ok {
		asset.SHA256 = value
	}
	return asset
}

func filetypeFromName(name string) string {
	lower := strings.ToLower(name)
	switch {
	case strings.HasSuffix(lower, ".zip"):
		return "zip"
	case strings.HasSuffix(lower, ".tar.gz"):
		return "tar.gz"
	case strings.HasSuffix(lower, ".tgz"):
		return "tgz"
	case strings.HasSuffix(lower, ".exe"):
		return "exe"
	default:
		return strings.TrimPrefix(lower[strings.LastIndex(lower, ".")+1:], ".")
	}
}

func parseUpdaterProgress(event *application.CustomEvent) (updater.Progress, bool) {
	if event == nil || event.Data == nil {
		return updater.Progress{}, false
	}
	if progress, ok := event.Data.(updater.Progress); ok {
		return progress, true
	}
	var progress updater.Progress
	if decodeEventData(event.Data, &progress) == nil {
		return progress, true
	}
	return updater.Progress{}, false
}

func parseUpdaterError(event *application.CustomEvent) (updater.ErrorInfo, bool) {
	if event == nil || event.Data == nil {
		return updater.ErrorInfo{}, false
	}
	if info, ok := event.Data.(updater.ErrorInfo); ok {
		return info, true
	}
	var info updater.ErrorInfo
	if decodeEventData(event.Data, &info) == nil {
		return info, true
	}
	return updater.ErrorInfo{}, false
}

func decodeEventData(data any, out any) error {
	content, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return json.Unmarshal(content, out)
}
