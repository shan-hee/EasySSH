package updatecheck

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
)

const (
	DefaultManifestURL = "https://github.com/shan-hee/EasySSH/releases/latest/download/release-manifest.json"
	defaultHTTPTimeout = 15 * time.Second
	maxManifestBytes   = 2 << 20
)

type Manifest = protocol.UpdateManifest

type WebUpdateInfo = protocol.UpdateInstructions

type DesktopTarget = protocol.UpdateArtifact

type CheckResult = protocol.UpdateCheckResult

type Fetcher struct {
	URL        string
	HTTPClient *http.Client
}

func (f Fetcher) Fetch(ctx context.Context) (*Manifest, error) {
	url := strings.TrimSpace(f.URL)
	if url == "" {
		url = DefaultManifestURL
	}

	client := f.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: defaultHTTPTimeout}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch update manifest: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("fetch update manifest: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxManifestBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxManifestBytes {
		return nil, errors.New("update manifest is too large")
	}

	var manifest Manifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return nil, fmt.Errorf("parse update manifest: %w", err)
	}
	if err := validateManifest(manifest); err != nil {
		return nil, err
	}
	return &manifest, nil
}

func validateManifest(m Manifest) error {
	if strings.TrimSpace(m.Version) == "" {
		return errors.New("update manifest version is required")
	}
	if strings.TrimSpace(m.ReleaseURL) == "" {
		return errors.New("update manifest release_url is required")
	}
	return nil
}

func BuildCheckResult(currentVersion string, target string, manifest *Manifest) CheckResult {
	current := NormalizeVersion(currentVersion)
	latest := ""
	if manifest != nil {
		latest = NormalizeVersion(manifest.Version)
	}

	result := CheckResult{
		CurrentVersion: current,
		LatestVersion:  latest,
		HasUpdate:      IsNewer(latest, current),
		Target:         target,
	}

	if manifest == nil {
		return result
	}

	result.ReleaseURL = manifest.ReleaseURL
	result.PublishedAt = manifest.PublishedAt
	result.Notes = manifest.Notes
	if target == "web" {
		result.Instructions = manifest.Web
	}
	return result
}

func DesktopTargetKey(platform string, arch string) string {
	return strings.ToLower(strings.TrimSpace(platform)) + "-" + strings.ToLower(strings.TrimSpace(arch))
}

func NormalizeVersion(version string) string {
	version = strings.TrimSpace(version)
	version = strings.TrimPrefix(version, "v")
	version = strings.TrimPrefix(version, "V")
	return version
}

func IsNewer(candidate string, current string) bool {
	if !IsComparableVersion(candidate) || !IsComparableVersion(current) {
		return false
	}
	return CompareVersions(candidate, current) > 0
}

func CompareVersions(a string, b string) int {
	left, leftErr := semver.NewVersion(NormalizeVersion(a))
	right, rightErr := semver.NewVersion(NormalizeVersion(b))
	if leftErr != nil || rightErr != nil {
		return 0
	}
	return left.Compare(right)
}

func IsComparableVersion(version string) bool {
	_, err := semver.NewVersion(NormalizeVersion(version))
	return err == nil
}
