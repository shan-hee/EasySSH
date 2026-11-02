package rest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/server/internal/domain/transferjob"
	"github.com/gin-gonic/gin"
)

type systemConfigPatchRepository struct {
	systemconfig.Repository
	config systemconfig.SystemConfig
	writes int
}

func (r *systemConfigPatchRepository) Get(context.Context) (*systemconfig.SystemConfig, error) {
	copy := r.config
	return &copy, nil
}

func (r *systemConfigPatchRepository) SaveBasic(_ context.Context, config *systemconfig.SystemConfig) error {
	r.config = *config
	r.writes++
	return nil
}

func (r *systemConfigPatchRepository) SaveFileTransfer(ctx context.Context, config *systemconfig.SystemConfig) error {
	return r.SaveBasic(ctx, config)
}

type systemConfigTransferStorage struct {
	transferjob.Service
	config systemconfig.Service
}

func (s systemConfigTransferStorage) ConfigureStorage(ctx context.Context, config *systemconfig.SystemConfig) error {
	return s.config.SaveFileTransfer(ctx, config)
}

func TestSystemBasicPatchPreservesOmittedValues(t *testing.T) {
	repo := &systemConfigPatchRepository{config: systemconfig.SystemConfig{
		SystemName: "original", SystemLogo: "logo", SystemFavicon: "icon",
		DefaultLanguage: "zh-CN", DefaultTimezone: "Asia/Shanghai", DateFormat: "YYYY-MM-DD",
		TransferStoragePath: "/managed-artifacts", JobQueueMaxConcurrency: 4,
	}}
	handler := NewSystemConfigHandler(systemconfig.NewService(repo), nil, nil, nil)
	router := gin.New()
	router.PATCH("/basic", handler.PatchBasicInfo)
	patch := func(body string, status int) {
		t.Helper()
		request := httptest.NewRequest(http.MethodPatch, "/basic", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		if recorder.Code != status {
			t.Fatalf("unexpected response %d: %s", recorder.Code, recorder.Body.String())
		}
	}
	patch(`{"system_name":"renamed"}`, http.StatusOK)
	if repo.config.SystemName != "renamed" || repo.config.SystemLogo != "logo" || repo.config.DefaultLanguage != "zh-CN" || repo.config.TransferStoragePath != "/managed-artifacts" || repo.config.JobQueueMaxConcurrency != 4 {
		t.Fatalf("partial edit erased unrelated configuration: %+v", repo.config)
	}
	patch(`{"system_logo":""}`, http.StatusOK)
	if repo.config.SystemLogo != "" || repo.config.SystemFavicon != "icon" {
		t.Fatal("explicit clearing or omitted favicon was lost")
	}
	patch(`{"system_name":""}`, http.StatusBadRequest)
	if repo.writes != 2 || repo.config.SystemName != "renamed" {
		t.Fatal("invalid required field reached storage")
	}
}

func TestFileTransferPatchPreservesStorageAndAcceptsExplicitFalseAndZero(t *testing.T) {
	repo := &systemConfigPatchRepository{config: systemconfig.SystemConfig{
		SystemName: "workspace", MaxFileUploadSize: 100, TransferStoragePath: "/managed-artifacts",
		TransferRetentionDays: 7, TransferMaxStorageGB: 10, TransferMaxConcurrency: 3,
		TransferMaxEntries: 5000, TransferMaxDepth: 64, TransferCleanupEnabled: true, SkipExcludedOnUpload: true,
		SFTPMaxIdleTimeSeconds: 120, SFTPCleanupIntervalSeconds: 30, SFTPConnTimeoutSeconds: 10,
		SFTPMaxSessionsPerConn: 8, SFTPMaxLifeTimeMinutes: 30,
	}}
	service := systemconfig.NewService(repo)
	handler := NewSystemConfigHandler(service, nil, sftp.NewTransferLimiter(3), systemConfigTransferStorage{config: service})
	router := gin.New()
	router.PATCH("/transfer", handler.PatchFileTransferConfig)
	request := httptest.NewRequest(http.MethodPatch, "/transfer", strings.NewReader(`{"skip_excluded_on_upload":false,"transfer_cleanup_enabled":false,"sftp_max_life_time_minutes":0}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("partial transfer patch failed: %s", recorder.Body.String())
	}
	if repo.config.SkipExcludedOnUpload || repo.config.TransferCleanupEnabled || repo.config.SFTPMaxLifeTimeMinutes != 0 {
		t.Fatal("explicit false/zero was omitted")
	}
	if repo.config.TransferStoragePath != "/managed-artifacts" || repo.config.TransferMaxEntries != 5000 || repo.config.TransferMaxConcurrency != 3 || repo.config.SFTPMaxSessionsPerConn != 8 || repo.config.SystemName != "workspace" {
		t.Fatalf("omitted transfer settings were reset: %+v", repo.config)
	}
}

func TestPublicBrandingDoesNotExposeSystemConfiguration(t *testing.T) {
	repo := &systemConfigPatchRepository{config: systemconfig.SystemConfig{
		SystemName: "Personal workspace", SystemLogo: "/logo.svg", SystemFavicon: "/icon.ico", DefaultLanguage: "zh-CN",
		TransferStoragePath: "/private/artifacts", JobQueueMaxConcurrency: 8,
	}}
	handler := NewSystemConfigHandler(systemconfig.NewService(repo), nil, nil, nil)
	router := gin.New()
	router.GET("/public/branding", handler.GetPublicBranding)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/public/branding", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("branding requires login: %d", recorder.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 4 || body["system_name"] != repo.config.SystemName || body["system_logo"] != repo.config.SystemLogo || body["system_favicon"] != repo.config.SystemFavicon || body["default_language"] != repo.config.DefaultLanguage {
		t.Fatalf("unexpected public configuration: %v", body)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("branding may be served stale")
	}
}
