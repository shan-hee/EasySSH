package app

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/aichatui"
	sharedaiconfig "github.com/easyssh/shared/aiconfig"
	"github.com/easyssh/shared/aipermission"
	"github.com/easyssh/shared/aiprovider"
	"github.com/easyssh/shared/aitooloutput"
	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

var desktopAISyncMu sync.RWMutex

type DesktopAIPermissionMode string

const (
	DesktopAIPermissionReadonly   DesktopAIPermissionMode = aipermission.ModeReadonly
	DesktopAIPermissionBalanced   DesktopAIPermissionMode = aipermission.ModeBalanced
	DesktopAIPermissionPrivileged DesktopAIPermissionMode = aipermission.ModePrivileged
)

type DesktopAISessionStatus string

const (
	DesktopAISessionIdle                DesktopAISessionStatus = "idle"
	DesktopAISessionRunning             DesktopAISessionStatus = "running"
	DesktopAISessionWaitingConfirmation DesktopAISessionStatus = "waiting_confirmation"
	DesktopAISessionClosed              DesktopAISessionStatus = "closed"
)

const desktopAISessionEvent = "easyssh:desktop-ai:session-event"

type DesktopAITaskStatus string

const (
	DesktopAITaskQueued         DesktopAITaskStatus = "queued"
	DesktopAITaskWaitingConfirm DesktopAITaskStatus = "waiting_confirm"
	DesktopAITaskRunning        DesktopAITaskStatus = "running"
	DesktopAITaskSucceeded      DesktopAITaskStatus = "succeeded"
	DesktopAITaskFailed         DesktopAITaskStatus = "failed"
	DesktopAITaskUnknown        DesktopAITaskStatus = "unknown"
	DesktopAITaskCancelled      DesktopAITaskStatus = "cancelled"
)

type desktopAIConfirmStrategy string

const (
	desktopAIConfirmNone desktopAIConfirmStrategy = "none"
	desktopAIConfirmUser desktopAIConfirmStrategy = "user"
)

type DesktopAISessionScope struct {
	Kind              string `json:"kind,omitempty"`
	TerminalSessionID string `json:"terminal_session_id,omitempty"`
	ServerID          string `json:"server_id,omitempty"`
	ServerName        string `json:"server_name,omitempty"`
	Host              string `json:"host,omitempty"`
	Port              int    `json:"port,omitempty"`
	Username          string `json:"username,omitempty"`
}

type DesktopAIImageAttachment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
	Size      int64  `json:"size"`
}

type DesktopAIUsage struct {
	InputTokens      int64 `json:"input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
	CachedTokens     int64 `json:"cached_tokens,omitempty"`
	CacheWriteTokens int64 `json:"cache_write_tokens,omitempty"`
	ReasoningTokens  int64 `json:"reasoning_tokens,omitempty"`
	TotalTokens      int64 `json:"total_tokens"`
}

type DesktopAIProviderMetadata struct {
	Provider            string `json:"provider"`
	API                 string `json:"api"`
	Endpoint            string `json:"endpoint,omitempty"`
	RequestID           string `json:"request_id,omitempty"`
	ResponseID          string `json:"response_id,omitempty"`
	Model               string `json:"model,omitempty"`
	FinishReason        string `json:"finish_reason,omitempty"`
	ServiceTier         string `json:"service_tier,omitempty"`
	EstimatedCostMicros int64  `json:"estimated_cost_micros,omitempty"`
	CostEstimateKind    string `json:"cost_estimate_kind,omitempty"`
}

type DesktopAIMessageView struct {
	ExternalContent  bool                       `json:"external_content,omitempty"`
	ServerReferences []aichatui.ServerReference `json:"server_references,omitempty"`
	ID               string                     `json:"id"`
	Role             string                     `json:"role"`
	Content          string                     `json:"content"`
	Reasoning        string                     `json:"reasoning,omitempty"`
	Attachments      []DesktopAIImageAttachment `json:"attachments,omitempty"`
	Usage            *DesktopAIUsage            `json:"usage,omitempty"`
	ProviderMetadata *DesktopAIProviderMetadata `json:"provider_metadata,omitempty"`
	CreatedAt        string                     `json:"created_at"`
	StoppedAt        string                     `json:"stopped_at,omitempty"`
}

type DesktopAITaskView struct {
	File                 *aiworkspace.FileSummary  `json:"file,omitempty"`
	Artifact             *aiworkspace.FileArtifact `json:"artifact,omitempty"`
	CommandOutput        string                    `json:"command_output,omitempty"`
	ID                   string                    `json:"id"`
	AssistantMessageID   string                    `json:"assistant_message_id,omitempty"`
	ToolCallID           string                    `json:"tool_call_id"`
	ToolName             string                    `json:"tool_name"`
	ToolDisplayName      string                    `json:"tool_display_name,omitempty"`
	Summary              string                    `json:"summary,omitempty"`
	Status               DesktopAITaskStatus       `json:"status"`
	Dangerous            bool                      `json:"dangerous"`
	RequiresConfirmation bool                      `json:"requires_confirmation"`
	Arguments            map[string]any            `json:"arguments,omitempty"`
	Result               string                    `json:"result,omitempty"`
	Error                string                    `json:"error,omitempty"`
	CreatedAt            string                    `json:"created_at"`
	UpdatedAt            string                    `json:"updated_at"`
	CustomTitle          bool                      `json:"custom_title,omitempty"`
}

type DesktopAISessionView struct {
	Title            string                  `json:"title,omitempty"`
	ID               string                  `json:"id"`
	Model            string                  `json:"model"`
	PermissionMode   DesktopAIPermissionMode `json:"permission_mode"`
	Scope            *DesktopAISessionScope  `json:"scope,omitempty"`
	Status           DesktopAISessionStatus  `json:"status"`
	CreatedAt        string                  `json:"created_at"`
	UpdatedAt        string                  `json:"updated_at"`
	MessageCount     int                     `json:"message_count"`
	TaskCount        int                     `json:"task_count"`
	DefaultTransport string                  `json:"default_transport"`
}

type DesktopAISessionListItem struct {
	Preview        string                  `json:"preview,omitempty"`
	ID             string                  `json:"id"`
	Model          string                  `json:"model"`
	PermissionMode DesktopAIPermissionMode `json:"permission_mode"`
	Status         DesktopAISessionStatus  `json:"status"`
	Scope          *DesktopAISessionScope  `json:"scope,omitempty"`
	Title          string                  `json:"title"`
	CustomTitle    bool                    `json:"custom_title"`
	MessageCount   int                     `json:"message_count"`
	TaskCount      int                     `json:"task_count"`
	CreatedAt      string                  `json:"created_at"`
	UpdatedAt      string                  `json:"updated_at"`
}

type DesktopAIListSessionsParams struct {
	Page              int    `json:"page,omitempty"`
	Limit             int    `json:"limit,omitempty"`
	Q                 string `json:"q,omitempty"`
	ScopeKind         string `json:"scope_kind,omitempty"`
	TerminalSessionID string `json:"terminal_session_id,omitempty"`
	ServerID          string `json:"server_id,omitempty"`
}

type DesktopAIListSessionsResult struct {
	Items []DesktopAISessionListItem `json:"items"`
	Total int                        `json:"total"`
}

type DesktopAICreateSessionInput struct {
	Model          string                  `json:"model,omitempty"`
	PermissionMode DesktopAIPermissionMode `json:"permission_mode,omitempty"`
	Scope          *DesktopAISessionScope  `json:"scope,omitempty"`
}

type DesktopAICreateSessionResponse struct {
	SessionID        string               `json:"session_id"`
	Session          DesktopAISessionView `json:"session"`
	DefaultTransport string               `json:"default_transport"`
}

type DesktopAISendMessageInput struct {
	ReasoningEffort  string                     `json:"reasoning_effort,omitempty"`
	ServerReferences []aichatui.ServerReference `json:"server_references,omitempty"`
	SessionID        string                     `json:"session_id"`
	Content          string                     `json:"content"`
	Context          string                     `json:"context,omitempty"`
	Model            string                     `json:"model,omitempty"`
	PermissionMode   DesktopAIPermissionMode    `json:"permission_mode,omitempty"`
	Scope            *DesktopAISessionScope     `json:"scope,omitempty"`
	Attachments      []DesktopAIImageAttachment `json:"attachments,omitempty"`
}

type DesktopAIUpdateMessageInput struct {
	ServerReferences []aichatui.ServerReference `json:"server_references,omitempty"`
	SessionID        string                     `json:"session_id"`
	MessageID        string                     `json:"message_id"`
	Content          string                     `json:"content"`
}

type DesktopAIRegenerateMessageInput struct {
	ReasoningEffort string                  `json:"reasoning_effort,omitempty"`
	SessionID       string                  `json:"session_id"`
	MessageID       string                  `json:"message_id"`
	Context         string                  `json:"context,omitempty"`
	Model           string                  `json:"model,omitempty"`
	PermissionMode  DesktopAIPermissionMode `json:"permission_mode,omitempty"`
	Scope           *DesktopAISessionScope  `json:"scope,omitempty"`
}

type DesktopAIToolApprovalInput struct {
	ReasoningEffort string `json:"reasoning_effort,omitempty"`
	SessionID       string `json:"session_id"`
	ID              string `json:"id"`
	Approved        *bool  `json:"approved"`
	Reason          string `json:"reason,omitempty"`
}

type DesktopAISessionEvent struct {
	Output    *protocol.AITaskOutputDelta `json:"output,omitempty"`
	Task      *DesktopAITaskView          `json:"task,omitempty"`
	SessionID string                      `json:"session_id"`
	Type      string                      `json:"type"`
	Session   *DesktopAISessionView       `json:"session,omitempty"`
	Delta     *protocol.AITextDelta       `json:"delta,omitempty"`
	History   *protocol.AIHistoryChange   `json:"history,omitempty"`
	Error     string                      `json:"error,omitempty"`
}

type desktopAIConfigRecord struct {
	Stored   bool
	Enabled  bool
	Provider string
	Endpoint string
	APIKey   string
	Models   []string
}

func (c desktopAIConfigRecord) input() protocol.AIConfigInput {
	key := c.APIKey
	return protocol.AIConfigInput{Enabled: c.Enabled, Provider: c.Provider, Endpoint: c.Endpoint, APIKey: &key, Models: append([]string{}, c.Models...)}
}

type desktopAISessionRecord struct {
	ExecutionOrigins map[string]desktopAIExecutionOrigin
	ConfigSpaceID    string
	ID               string
	Title            string
	CustomTitle      bool
	Model            string
	PermissionMode   DesktopAIPermissionMode
	Scope            *DesktopAISessionScope
	Status           DesktopAISessionStatus
	Messages         []DesktopAIMessageView
	Tasks            []DesktopAITaskView
	CreatedAt        string
	UpdatedAt        string
}

type desktopAIActiveRequest struct {
	StorageErr     error // guarded by mu; only lives for the active request
	CommandOutputs map[string]string
	Cancel         context.CancelFunc
	Done           chan struct{}
	finish         sync.Once
}

type desktopAIToolSpec struct {
	Name            string
	DisplayName     string
	Description     string
	Parameters      map[string]interface{}
	Dangerous       bool
	ConfirmStrategy desktopAIConfirmStrategy
	SupportedModes  []DesktopAIPermissionMode
}

type desktopAIToolResult struct {
	Artifact      *aiworkspace.FileArtifact
	CommandOutput string
	Content       string
	IsError       bool
	Unknown       bool
	Cancelled     bool
}

type desktopAIConfirmedToolRun struct {
	ReasoningEffort string
	Context         context.Context
	Cancel          context.CancelFunc
	Request         *desktopAIActiveRequest
	Active          int
	Halted          bool // guarded by sessionMu; wait for every in-flight result before finishing
}

type DesktopAIService struct {
	shutdownDone   chan struct{}
	shutdownErr    error
	stopping       bool
	closed         bool
	mu             sync.Mutex
	sessionMu      sync.Mutex
	db             *sql.DB
	activeRequests map[string]*desktopAIActiveRequest
	confirmedRuns  map[string]*desktopAIConfirmedToolRun
	serverService  *DesktopServerService
	sftpService    *DesktopSFTPService
	monitorService *DesktopMonitorService
}

func NewDesktopAIService(serverService *DesktopServerService, sftpService *DesktopSFTPService, monitorService *DesktopMonitorService) *DesktopAIService {
	return &DesktopAIService{
		activeRequests: map[string]*desktopAIActiveRequest{},
		confirmedRuns:  map[string]*desktopAIConfirmedToolRun{},
		serverService:  serverService,
		sftpService:    sftpService,
		monitorService: monitorService,
	}
}

func (s *DesktopAIService) ServiceName() string {
	return "DesktopAIService"
}

func (s *DesktopAIService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	recoveryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	database, err := s.database()
	if err != nil {
		return err
	}
	if err := cleanupDesktopContent(recoveryCtx, database); err != nil {
		return err
	}
	if err := s.recoverAIExecutionFacts(recoveryCtx); err != nil {
		return err
	}
	if err := s.recoverInterruptedAITasks(recoveryCtx); err != nil {
		return err
	}
	return nil
}

func (s *DesktopAIService) ServiceShutdown() (shutdownErr error) {
	s.mu.Lock()
	if s.shutdownDone != nil {
		done := s.shutdownDone
		s.mu.Unlock()
		<-done
		return s.shutdownErr
	}
	s.shutdownDone = make(chan struct{})
	s.stopping = true
	var completions []*desktopAIActiveRequest
	for _, active := range s.activeRequests {
		active.Cancel()
		completions = append(completions, active)
	}
	s.mu.Unlock()
	defer func() { s.shutdownErr = shutdownErr; close(s.shutdownDone) }()
	s.sessionMu.Lock()
	for _, run := range s.confirmedRuns {
		run.Halted = true
		run.Cancel()
	}
	s.sessionMu.Unlock()
	for _, request := range completions {
		<-request.Done
		shutdownErr = errors.Join(shutdownErr, request.StorageErr)
	}

	// Keep final persistence and database close exclusive with ordinary idle
	// edits, and exclude sync imports until the database has been closed.
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	s.mu.Lock()
	database := s.db
	s.db, s.closed = nil, true
	s.mu.Unlock()
	if database != nil {
		shutdownErr = errors.Join(shutdownErr, database.Close())
	}
	return shutdownErr
}

func (s *DesktopAIService) GetAIConfig() (protocol.AIRuntimeConfig, error) {
	config, err := s.loadConfig()
	if err != nil {
		return protocol.AIRuntimeConfig{}, err
	}

	models := config.Models
	configured := config.Enabled && strings.TrimSpace(config.APIKey) != "" && len(models) > 0
	status := protocol.AIRuntimeConfig{
		Configured: configured,
		Provider:   sharedaiconfig.NormalizeProvider(config.Provider),
		Models:     models,
		HasKey:     strings.TrimSpace(config.APIKey) != "",
	}
	if len(models) > 0 {
		status.Model = models[0]
	}
	if !configured {
		status.Message = "AI is not configured"
	}
	return status, nil
}

func (s *DesktopAIService) GetOwnerAIConfig() (protocol.OwnerAIConfig, error) {
	config, err := s.loadConfig()
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	return sharedaiconfig.Public(config.input()), nil
}
func (s *DesktopAIService) SaveOwnerAIConfig(input protocol.AIConfigInput) (protocol.OwnerAIConfig, error) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	database, err := s.database()
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	configID, err := s.configSpace("")
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	tx, err := database.Begin()
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	defer tx.Rollback()
	current, err := loadDesktopAIConfig(tx, configID)
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	input, err = sharedaiconfig.NormalizeInput(input, current.input())
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	fields := []string{}
	for _, f := range []struct {
		name    string
		changed bool
	}{
		{"enabled", current.Enabled != input.Enabled}, {"provider", current.Provider != input.Provider},
		{"endpoint", current.Endpoint != input.Endpoint}, {"api_key", current.APIKey != *input.APIKey},
		{"models", !slices.Equal(current.Models, input.Models)},
	} {
		if f.changed {
			fields = append(fields, f.name)
		}
	}
	if len(fields) == 0 && current.Stored {
		return sharedaiconfig.Public(input), tx.Commit()
	}
	encrypted, err := encryptDesktopCredential(*input.APIKey, "desktop_ai_config", configID, "api_key")
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	models, err := json.Marshal(input.Models)
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	now := time.Now().UTC().Format(desktopAITimeLayout)
	_, err = tx.Exec(`INSERT INTO desktop_ai_config(id,enabled,provider,endpoint,api_key,models,updated_at) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,provider=excluded.provider,endpoint=excluded.endpoint,api_key=excluded.api_key,models=excluded.models,updated_at=excluded.updated_at`, configID, boolToInt(input.Enabled), input.Provider, input.Endpoint, encrypted, string(models), now)
	if err != nil {
		return protocol.OwnerAIConfig{}, err
	}
	if len(fields) > 0 {
		if err = recordDesktopConfiguration(tx, "ai_config_updated", "ai_config", configID, "AI 配置", "manual", fields, nil); err != nil {
			return protocol.OwnerAIConfig{}, err
		}
	}
	return sharedaiconfig.Public(input), tx.Commit()
}
func (s *DesktopAIService) ResetOwnerAIConfig() error {
	empty := ""
	_, err := s.SaveOwnerAIConfig(protocol.AIConfigInput{Provider: "openai", APIKey: &empty, Models: []string{}})
	return err
}
func (s *DesktopAIService) ProbeAIModels(input protocol.AIModelsProbeInput) (protocol.AIModelsProbeResult, error) {
	current, err := s.loadConfig()
	if err != nil {
		return protocol.AIModelsProbeResult{}, err
	}
	input, err = sharedaiconfig.ResolveProbe(input, current.input())
	if err != nil {
		return protocol.AIModelsProbeResult{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	models, err := aiprovider.NewFactory().ListModels(ctx, aiprovider.Config{Provider: input.Provider, APIKey: *input.APIKey, Endpoint: input.Endpoint})
	if err != nil {
		return protocol.AIModelsProbeResult{}, errors.New("unable to retrieve models from the AI provider")
	}
	if models == nil {
		models = []string{}
	}
	return protocol.AIModelsProbeResult{Available: true, Models: models}, nil
}

func (s *DesktopAIService) GetLatestSession(scope *DesktopAISessionScope) (*DesktopAICreateSessionResponse, error) {
	params := DesktopAIListSessionsParams{Page: 1, Limit: 1}
	if normalizedScope := normalizeDesktopAISessionScope(scope); normalizedScope != nil {
		params.ScopeKind = normalizedScope.Kind
		params.TerminalSessionID = normalizedScope.TerminalSessionID
		params.ServerID = normalizedScope.ServerID
	}
	result, err := s.ListSessions(params)
	if err != nil {
		return nil, err
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	response, err := s.GetSession(result.Items[0].ID)
	if err != nil {
		return nil, err
	}
	return &response, nil
}

func (s *DesktopAIService) GetSession(id string) (DesktopAICreateSessionResponse, error) {
	record, err := s.loadHistorySession(strings.TrimSpace(id))
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	view := record.toView()
	return DesktopAICreateSessionResponse{
		SessionID:        view.ID,
		Session:          view,
		DefaultTransport: view.DefaultTransport,
	}, nil
}

func (s *DesktopAIService) CreateSession(input DesktopAICreateSessionInput) (DesktopAICreateSessionResponse, error) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	configSpaceID, err := s.configSpace("")
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	config, err := s.loadSpaceConfig(configSpaceID)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}

	model := strings.TrimSpace(input.Model)
	if model == "" {
		models := config.Models
		if len(models) > 0 {
			model = models[0]
		}
	}
	if model == "" {
		model = "default"
	}

	permissionMode := normalizeDesktopAIPermission(input.PermissionMode)
	now := time.Now().UTC().Format(desktopAITimeLayout)
	record := desktopAISessionRecord{
		ConfigSpaceID:  configSpaceID,
		ID:             newDesktopAIID("ai-session"),
		Title:          "",
		CustomTitle:    false,
		Model:          model,
		PermissionMode: permissionMode,
		Scope:          normalizeDesktopAISessionScope(input.Scope),
		Status:         DesktopAISessionIdle,
		Messages:       []DesktopAIMessageView{},
		Tasks:          []DesktopAITaskView{},
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.saveSession(record); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}

	if err := s.enrollNewSyncSession(record.ID); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	view := record.toView()
	return DesktopAICreateSessionResponse{
		SessionID:        view.ID,
		Session:          view,
		DefaultTransport: view.DefaultTransport,
	}, nil
}

func (s *DesktopAIService) SendMessage(ctx context.Context, input DesktopAISendMessageInput) (DesktopAICreateSessionResponse, error) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	sessionID := strings.TrimSpace(input.SessionID)
	s.sessionMu.Lock()
	if _, err := s.loadIdleAISession(sessionID); err != nil {
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, err
	}
	requestContext, request, beginErr := s.beginAIRequest(ctx, sessionID)
	s.sessionMu.Unlock()
	if beginErr != nil {
		return DesktopAICreateSessionResponse{}, beginErr
	}
	defer s.finishAIRequest(sessionID, request)
	if sessionID == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI session id is required")
	}

	content := strings.TrimSpace(input.Content)
	if content == "" && len(input.Attachments) == 0 {
		return DesktopAICreateSessionResponse{}, errors.New("AI message content is required")
	}
	providerAttachments := desktopAIProviderAttachments(input.Attachments)
	if err := aiprovider.ValidateAttachments(providerAttachments); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}

	refs, err := s.resolveServerReferences(ctx, input.ServerReferences)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}

	record, err := s.loadSession(sessionID)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	if desktopAIHasPendingConfirmation(record.Tasks) {
		return DesktopAICreateSessionResponse{}, errors.New("AI session has pending confirmations")
	}

	config, err := s.loadSessionConfig(record.ID)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	model := strings.TrimSpace(input.Model)
	if model == "" {
		model = record.Model
	}
	if model == "" {
		models := config.Models
		if len(models) > 0 {
			model = models[0]
		}
	}
	if model == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI model is required")
	}
	if !config.Enabled || strings.TrimSpace(config.APIKey) == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI API key is required")
	}

	now := time.Now().UTC().Format(desktopAITimeLayout)
	record.Model = model
	record.PermissionMode = normalizeDesktopAIPermission(input.PermissionMode)
	if input.Scope != nil {
		if strings.EqualFold(strings.TrimSpace(input.Scope.Kind), "global") {
			record.Scope = nil
		} else if scope := normalizeDesktopAISessionScope(input.Scope); scope != nil {
			record.Scope = scope
		}
	}
	record.Status = DesktopAISessionRunning
	record.UpdatedAt = now
	userMessage := DesktopAIMessageView{
		ID: newDesktopAIID("msg"), Role: "user", Content: content, ServerReferences: refs,
		Attachments: append([]DesktopAIImageAttachment(nil), input.Attachments...), CreatedAt: now,
	}
	record.Messages = append(record.Messages, userMessage)
	if record.Title == "" {
		record.Title = defaultDesktopAISessionTitle(record.Messages)
	}
	if err := validateDesktopAIContext(record, input.Context); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	return s.completeDesktopAITurnWithContext(requestContext, record, config, input.Context, model, input.ReasoningEffort)
}

func (s *DesktopAIService) completeDesktopAITurnWithContext(requestContext context.Context, record desktopAISessionRecord, config desktopAIConfigRecord, contextText string, model string, reasoningEffort string) (DesktopAICreateSessionResponse, error) {
	if err := s.refreshRunServerReferences(requestContext, &record); err != nil {
		return s.failDesktopAITurn(record, err)
	}
	sessionID := record.ID
	if strings.TrimSpace(contextText) != "" {
		for i := len(record.Messages) - 1; i >= 0; i-- {
			if record.Messages[i].Role == "user" {
				record.Messages[i].ExternalContent = true
				break
			}
		}
	}

	if err := s.saveSession(record); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	s.emitAISessionSnapshot(record)

	for turn := 0; ; turn++ {
		if turn >= aiprovider.MaxAutomaticTurns {
			return s.failDesktopAITurn(record, aiprovider.NewLimitError("ai_iteration_limit", "连续自动处理已达到 32 轮，本轮已停止；请检查已完成工作后继续。"))
		}
		if err := validateDesktopAIHistoryGrowth(record); err != nil {
			return s.failDesktopAITurn(record, err)
		}
		assistantMessageID := newDesktopAIID("msg")
		assistantStartedAt := time.Now().UTC().Format(desktopAITimeLayout)
		var assistantContentBuilder strings.Builder
		var assistantReasoningBuilder strings.Builder
		turnResult, err := s.completeChat(requestContext, config, record, contextText, model, reasoningEffort, func(event aiprovider.Event) error {
			kind, offset := "text", assistantContentBuilder.Len()
			switch event.Type {
			case aiprovider.EventTextDelta:
				assistantContentBuilder.WriteString(event.Delta)
			case aiprovider.EventReasoningDelta:
				kind, offset = "reasoning", assistantReasoningBuilder.Len()
				assistantReasoningBuilder.WriteString(event.Delta)
			default:
				return nil
			}

			for remaining := event.Delta; remaining != ""; {
				delta, tail := aiwire.NextTextChunk(remaining)
				s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "message.delta", Delta: &protocol.AITextDelta{
					MessageID: assistantMessageID, Kind: kind, Offset: offset, NextOffset: offset + len(delta), Text: delta, CreatedAt: parseDesktopAITime(assistantStartedAt),
				}})
				offset += len(delta)
				remaining = tail
			}
			return nil
		})
		completedAt := time.Now().UTC().Format(desktopAITimeLayout)
		if err != nil {
			record.Messages = append(record.Messages, DesktopAIMessageView{
				ID: assistantMessageID, Role: "assistant", Content: assistantContentBuilder.String(), ExternalContent: desktopAIHasExternalContent(record),
				Reasoning: assistantReasoningBuilder.String(), CreatedAt: assistantStartedAt, StoppedAt: completedAt,
			})
			if errors.Is(err, context.Canceled) || errors.Is(requestContext.Err(), context.Canceled) {
				record.Status = DesktopAISessionIdle
				record.UpdatedAt = completedAt
				cancelDesktopAIActiveTasks(&record, completedAt)
				if saveErr := s.saveSession(record); saveErr != nil {
					return DesktopAICreateSessionResponse{}, saveErr
				}
				s.emitAISessionSnapshot(record)
				view := record.toView()
				return DesktopAICreateSessionResponse{
					SessionID:        view.ID,
					Session:          view,
					DefaultTransport: view.DefaultTransport,
				}, nil
			}
			return s.failDesktopAITurn(record, err)
		}
		assistantMessage := DesktopAIMessageView{
			ID: assistantMessageID, Role: "assistant", Content: strings.TrimSpace(turnResult.Content), ExternalContent: desktopAIHasExternalContent(record),
			Reasoning: strings.TrimSpace(turnResult.Reasoning), Usage: desktopAIUsage(&turnResult.Usage),
			ProviderMetadata: desktopAIProviderMetadata(&turnResult.Metadata), CreatedAt: assistantStartedAt,
		}
		record.Messages = append(record.Messages, assistantMessage)
		record.UpdatedAt = completedAt
		if strings.TrimSpace(turnResult.Content) == "" && len(turnResult.ToolCalls) == 0 {
			return s.failDesktopAITurn(record, errors.New("AI provider returned no text"))
		}

		if len(turnResult.ToolCalls) == 0 {
			record.Status = DesktopAISessionIdle
			if err := s.saveSession(record); err != nil {
				return DesktopAICreateSessionResponse{}, err
			}
			s.emitAISessionSnapshot(record)

			view := record.toView()
			return DesktopAICreateSessionResponse{
				SessionID:        view.ID,
				Session:          view,
				DefaultTransport: view.DefaultTransport,
			}, nil
		}

		if record.ExecutionOrigins == nil {
			record.ExecutionOrigins = make(map[string]desktopAIExecutionOrigin)
		}
		tasks, autoTaskIDs, pendingConfirm := s.materializeDesktopAITasks(requestContext, record, assistantMessageID, turnResult.ToolCalls)
		record.Tasks = append(record.Tasks, tasks...)
		if err := validateDesktopAIHistoryGrowth(record); err != nil {
			return s.failDesktopAITurn(record, err)
		}
		record.Status = DesktopAISessionRunning
		if err := s.saveSession(record); err != nil {
			return DesktopAICreateSessionResponse{}, err
		}
		s.emitAISessionSnapshot(record)

		for _, taskID := range autoTaskIDs {
			var executeErr error
			record, executeErr = s.executeDesktopAITask(requestContext, record, taskID)
			if executeErr != nil {
				return DesktopAICreateSessionResponse{}, executeErr
			}
			if requestContext.Err() != nil || desktopAITaskUnknown(record.Tasks, taskID) {
				view := record.toView()
				return DesktopAICreateSessionResponse{
					SessionID:        view.ID,
					Session:          view,
					DefaultTransport: view.DefaultTransport,
				}, nil
			}
		}
		if pendingConfirm {
			record.Status = DesktopAISessionWaitingConfirmation
			record.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
			if err := s.saveSession(record); err != nil {
				return DesktopAICreateSessionResponse{}, err
			}
			s.emitAISessionSnapshot(record)

			view := record.toView()
			return DesktopAICreateSessionResponse{
				SessionID:        view.ID,
				Session:          view,
				DefaultTransport: view.DefaultTransport,
			}, nil
		}
		contextText = ""
	}
}

func (s *DesktopAIService) failDesktopAITurn(record desktopAISessionRecord, turnErr error) (DesktopAICreateSessionResponse, error) {
	var limit *aiprovider.ProviderError
	if errors.As(turnErr, &limit) && limit.Code == "ai_history_limit" {
		cancelDesktopAIQueuedTasks(&record, time.Now().UTC().Format(desktopAITimeLayout))
	}
	record.Status = DesktopAISessionIdle
	record.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
	if err := s.saveSession(record); err != nil {
		return DesktopAICreateSessionResponse{}, errors.Join(turnErr, err)
	}
	s.emitAISessionSnapshot(record)
	return DesktopAICreateSessionResponse{}, turnErr
}

func (s *DesktopAIService) RespondToToolApproval(ctx context.Context, input DesktopAIToolApprovalInput) (DesktopAICreateSessionResponse, error) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	sessionID := strings.TrimSpace(input.SessionID)
	taskID := strings.TrimSpace(input.ID)
	if sessionID == "" || taskID == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI session id and task id are required")
	}
	if input.Approved == nil {
		return DesktopAICreateSessionResponse{}, errors.New("AI tool approval decision is required")
	}
	approved := *input.Approved

	s.sessionMu.Lock()
	record, err := s.loadIdleAISession(sessionID)
	if err != nil {
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, err
	}

	if record.Status != DesktopAISessionWaitingConfirmation && record.Status != DesktopAISessionRunning {
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, errors.New("AI session is not awaiting tool approval")
	}

	taskIndex := desktopAIFindTaskIndex(record.Tasks, taskID)
	if taskIndex < 0 {
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, errors.New("AI task not found")
	}
	if record.Tasks[taskIndex].Status != DesktopAITaskWaitingConfirm {
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, errors.New("AI task is not awaiting confirmation")
	}
	if approved {
		if err := validateDesktopAIHistoryGrowth(record); err != nil {
			s.sessionMu.Unlock()
			return DesktopAICreateSessionResponse{}, err
		}
		task := record.Tasks[taskIndex]
		if spec, ok := desktopAIToolSpecByName(record.PermissionMode, record.Scope, task.ToolName); ok {
			if message := desktopAIValidateServerReference(record, spec, task.Arguments); message != "" {
				s.sessionMu.Unlock()
				return DesktopAICreateSessionResponse{}, errors.New(message)
			}
		}
	}

	now := time.Now().UTC().Format(desktopAITimeLayout)
	run := s.confirmedRuns[sessionID]
	if run != nil && run.Active >= 8 {
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, errors.New("AI tool capacity reached")
	}
	if run != nil && (run.Halted || run.Context.Err() != nil) {
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, errors.New("AI 本轮已停止，请先核对已有结果")
	}
	if run == nil {
		turnContext, cancelTurn := context.WithCancel(context.Background())
		requestContext, request, beginErr := s.beginAIRequest(turnContext, sessionID)
		if beginErr != nil {
			cancelTurn()
			s.sessionMu.Unlock()
			return DesktopAICreateSessionResponse{}, beginErr
		}
		run = &desktopAIConfirmedToolRun{
			ReasoningEffort: input.ReasoningEffort,
			Context:         requestContext,
			Cancel:          cancelTurn,
			Request:         request,
		}
		if s.confirmedRuns == nil {
			s.confirmedRuns = make(map[string]*desktopAIConfirmedToolRun)
		}
		s.confirmedRuns[sessionID] = run
	}

	taskName := record.Tasks[taskIndex].ToolName
	taskArguments := record.Tasks[taskIndex].Arguments
	if !approved {
		record.Tasks[taskIndex].Status = DesktopAITaskCancelled
		record.Tasks[taskIndex].Result = "用户已拒绝执行该操作。"
		if reason := strings.TrimSpace(input.Reason); reason != "" {
			record.Tasks[taskIndex].Result += " " + reason
		}
		record.Tasks[taskIndex].Error = ""
		record.Tasks[taskIndex].UpdatedAt = now
	} else {
		if spec, ok := desktopAIToolSpecByName(record.PermissionMode, record.Scope, taskName); ok {
			taskArguments = desktopAIEnforceScopedArguments(record.Scope, spec, taskArguments)
			record.Tasks[taskIndex].Arguments = taskArguments
		}
		record.Tasks[taskIndex].Status = DesktopAITaskRunning
		record.Tasks[taskIndex].UpdatedAt = now
	}
	run.Active++

	if desktopAIHasPendingConfirmation(record.Tasks) {
		record.Status = DesktopAISessionWaitingConfirmation
	} else {
		record.Status = DesktopAISessionRunning
	}
	record.UpdatedAt = now
	if err := s.saveSession(record); err != nil {
		run.Halted = true
		run.Cancel()
		run.Active--
		if run.Active == 0 {
			delete(s.confirmedRuns, sessionID)
			run.Cancel()
			s.finishAIRequest(sessionID, run.Request)
		}
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, err
	}
	view := record.toView()
	s.sessionMu.Unlock()

	s.emitAISessionSnapshot(record)
	go s.resolveDesktopConfirmedTask(sessionID, taskID, approved, run)

	return DesktopAICreateSessionResponse{
		SessionID:        view.ID,
		Session:          view,
		DefaultTransport: view.DefaultTransport,
	}, nil
}

func (s *DesktopAIService) resolveDesktopConfirmedTask(
	sessionID string,
	taskID string,
	approved bool,
	run *desktopAIConfirmedToolRun,
) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	result := desktopAIToolResult{Cancelled: true, Content: "操作未开始，已取消。"}
	var executeErr error
	var historyErr error
	if approved && run.Context.Err() == nil {
		record, err := s.loadSession(sessionID)
		if err != nil {
			result.Cancelled = false
			executeErr = err
		} else if index := desktopAIFindTaskIndex(record.Tasks, taskID); index < 0 {
			result.Cancelled = false
			executeErr = errors.New("AI task not found")
		} else if historyErr = validateDesktopAIHistoryGrowth(record); historyErr != nil {
			result.Content = historyErr.Error()
		} else {
			result, executeErr = s.executeWorkspaceTool(run.Context, sessionID, record.Tasks[index])
		}
	}

	s.sessionMu.Lock()
	record, loadErr := s.loadSession(sessionID)
	if loadErr != nil {
		run.Halted = true
		run.Cancel()
		s.finishDesktopConfirmedRunLocked(sessionID, run)
		s.sessionMu.Unlock()
		s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "error", Error: "AI 结果无法保存，已停止后续执行：" + loadErr.Error()})
		return
	}
	if s.confirmedRuns[sessionID] != run {
		s.sessionMu.Unlock()
		return
	}

	taskIndex := desktopAIFindTaskIndex(record.Tasks, taskID)
	now := time.Now().UTC().Format(desktopAITimeLayout)
	if taskIndex >= 0 && approved && record.Tasks[taskIndex].Status != DesktopAITaskCancelled {
		record.Tasks[taskIndex].CommandOutput = result.CommandOutput
		if result.Artifact != nil {
			record.Tasks[taskIndex].Artifact = result.Artifact
			summary := result.Artifact.FileSummary
			record.Tasks[taskIndex].File = &summary
		}
		applyDesktopAIToolOutcome(&record.Tasks[taskIndex], result, executeErr)
		if result.Unknown {
			run.Halted = true
			run.Cancel()
		}
		record.Tasks[taskIndex].UpdatedAt = now
	}

	if historyErr != nil {
		run.Halted = true
		run.Cancel()
	}
	if run.Active > 0 {
		run.Active--
	}
	if run.Halted || run.Context.Err() != nil {
		cancelDesktopAIQueuedTasks(&record, now)
	}
	pendingConfirmation := desktopAIHasPendingConfirmation(record.Tasks)
	if run.Active == 0 && (run.Halted || run.Context.Err() != nil) {
		record.Status = DesktopAISessionIdle
	} else if pendingConfirmation {
		record.Status = DesktopAISessionWaitingConfirmation
	} else {
		record.Status = DesktopAISessionRunning
	}
	record.UpdatedAt = now
	saveErr := s.saveSession(record)
	if saveErr != nil {
		run.Halted = true
		run.Cancel()
	}
	shouldContinue := run.Active == 0 && !pendingConfirmation && !run.Halted && run.Context.Err() == nil
	shouldWait := run.Active == 0 && pendingConfirmation
	runFinished := run.Active == 0
	if runFinished {
		delete(s.confirmedRuns, sessionID)
	}
	s.sessionMu.Unlock()

	if saveErr != nil {
		s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "error", Error: "AI 执行结果保存失败，已停止后续执行：" + saveErr.Error()})
	} else {
		s.emitAISessionSnapshot(record)
	}
	if historyErr != nil {
		s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "error", Error: historyErr.Error()})
	}
	if !runFinished {
		return
	}
	if shouldWait || run.Context.Err() != nil {
		run.Cancel()
		s.finishAIRequest(sessionID, run.Request)
		return
	}
	if !shouldContinue {
		return
	}

	defer run.Cancel()
	defer s.finishAIRequest(sessionID, run.Request)
	config, err := s.loadSessionConfig(sessionID)
	if err != nil {
		s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "error", Error: err.Error()})
		_, _ = s.failDesktopAITurn(record, err)
		return
	}
	model := strings.TrimSpace(record.Model)
	if model == "" {
		models := config.Models
		if len(models) > 0 {
			model = models[0]
		}
	}
	if !config.Enabled || model == "" || strings.TrimSpace(config.APIKey) == "" {
		err = errors.New("AI model and API key are required")
		s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "error", Error: err.Error()})
		_, _ = s.failDesktopAITurn(record, err)
		return
	}
	record.Model = model
	if _, err = s.completeDesktopAITurnWithContext(run.Context, record, config, "", model, run.ReasoningEffort); err != nil {
		s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "error", Error: err.Error()})
	}
}

func (s *DesktopAIService) finishDesktopConfirmedRunLocked(sessionID string, run *desktopAIConfirmedToolRun) {
	if run.Active > 0 {
		run.Active--
	}
	if run.Active != 0 {
		return
	}
	delete(s.confirmedRuns, sessionID)
	run.Cancel()
	s.finishAIRequest(sessionID, run.Request)
}

func (s *DesktopAIService) cancelDesktopConfirmedRun(sessionID string) {
	s.sessionMu.Lock()
	run := s.confirmedRuns[sessionID]
	if run != nil {
		run.Halted = true
		run.Cancel()
	}
	s.sessionMu.Unlock()
	if run != nil {
		<-run.Request.Done
	}
}

func (s *DesktopAIService) CancelSession(id string) (map[string]bool, error) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	id = strings.TrimSpace(id)
	cancelled := s.cancelAIRequest(id)
	s.cancelDesktopConfirmedRun(id)
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	if s.hasActiveAIRequest(id) {
		return nil, errors.New("another AI turn started while canceling")
	}
	record, err := s.loadIdleAISession(id)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(desktopAITimeLayout)
	if cancelled || record.Status == DesktopAISessionRunning || record.Status == DesktopAISessionWaitingConfirmation {
		markDesktopAIRunStopped(&record, now)
	}
	record.Status = DesktopAISessionIdle
	record.UpdatedAt = now
	cancelDesktopAIActiveTasks(&record, now)
	if err := s.saveSession(record); err != nil {
		return nil, err
	}
	s.emitAISessionSnapshot(record)
	return map[string]bool{"cancelled": cancelled}, nil
}

func (s *DesktopAIService) UpdateMessage(input DesktopAIUpdateMessageInput) (DesktopAICreateSessionResponse, error) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	sessionID := strings.TrimSpace(input.SessionID)
	messageID := strings.TrimSpace(input.MessageID)
	content := strings.TrimSpace(input.Content)
	if sessionID == "" || messageID == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI session id and message id are required")
	}
	if content == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI message content is required")
	}

	refs, err := s.resolveServerReferences(context.Background(), input.ServerReferences)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}

	if s.hasActiveAIRequest(sessionID) {
		return DesktopAICreateSessionResponse{}, errors.New("AI session is busy")
	}
	record, err := s.loadIdleAISession(sessionID)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	if record.Status == DesktopAISessionRunning {
		return DesktopAICreateSessionResponse{}, errors.New("AI session is busy")
	}
	if desktopAIHasPendingConfirmation(record.Tasks) {
		return DesktopAICreateSessionResponse{}, errors.New("AI session has pending confirmations")
	}

	messageIndex := -1
	for index, message := range record.Messages {
		if message.ID == messageID {
			messageIndex = index
			break
		}
	}
	if messageIndex < 0 {
		return DesktopAICreateSessionResponse{}, errors.New("AI message not found")
	}
	if record.Messages[messageIndex].Role != "user" {
		return DesktopAICreateSessionResponse{}, errors.New("AI message cannot be edited")
	}

	record.Messages[messageIndex].Content = content
	record.Messages[messageIndex].ServerReferences = refs
	record.Messages = truncateDesktopAIMessages(record.Messages, messageIndex+1)
	record.Tasks = truncateDesktopAITasks(record.Tasks, record.Messages)
	record.Status = DesktopAISessionIdle
	record.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
	if !record.CustomTitle {
		record.Title = defaultDesktopAISessionTitle(record.Messages)
	}
	if err := validateDesktopAIContext(record, ""); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	if err := s.saveSession(record); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	s.emitAISessionSnapshot(record)

	view := record.toView()
	return DesktopAICreateSessionResponse{
		SessionID:        view.ID,
		Session:          view,
		DefaultTransport: view.DefaultTransport,
	}, nil
}

func (s *DesktopAIService) RegenerateMessage(ctx context.Context, input DesktopAIRegenerateMessageInput) (DesktopAICreateSessionResponse, error) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	sessionID := strings.TrimSpace(input.SessionID)
	s.sessionMu.Lock()
	if _, err := s.loadIdleAISession(sessionID); err != nil {
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, err
	}
	requestContext, request, beginErr := s.beginAIRequest(ctx, sessionID)
	s.sessionMu.Unlock()
	if beginErr != nil {
		return DesktopAICreateSessionResponse{}, beginErr
	}
	defer s.finishAIRequest(sessionID, request)
	messageID := strings.TrimSpace(input.MessageID)
	if sessionID == "" || messageID == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI session id and message id are required")
	}

	record, err := s.loadSession(sessionID)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	if desktopAIHasPendingConfirmation(record.Tasks) {
		return DesktopAICreateSessionResponse{}, errors.New("AI session has pending confirmations")
	}

	messageIndex := -1
	for index, message := range record.Messages {
		if message.ID == messageID {
			messageIndex = index
			break
		}
	}
	if messageIndex < 0 {
		return DesktopAICreateSessionResponse{}, errors.New("AI message not found")
	}
	if record.Messages[messageIndex].Role != "user" {
		return DesktopAICreateSessionResponse{}, errors.New("AI message cannot be regenerated")
	}

	config, err := s.loadSessionConfig(record.ID)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	model := strings.TrimSpace(input.Model)
	if model == "" {
		model = record.Model
	}
	if model == "" {
		models := config.Models
		if len(models) > 0 {
			model = models[0]
		}
	}
	if model == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI model is required")
	}
	if !config.Enabled || strings.TrimSpace(config.APIKey) == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI API key is required")
	}

	now := time.Now().UTC().Format(desktopAITimeLayout)
	record.Model = model
	if input.PermissionMode != "" {
		record.PermissionMode = normalizeDesktopAIPermission(input.PermissionMode)
	}
	if input.Scope != nil {
		if strings.EqualFold(strings.TrimSpace(input.Scope.Kind), "global") {
			record.Scope = nil
		} else if scope := normalizeDesktopAISessionScope(input.Scope); scope != nil {
			record.Scope = scope
		}
	}
	record.Messages = truncateDesktopAIMessages(record.Messages, messageIndex+1)
	record.Tasks = truncateDesktopAITasks(record.Tasks, record.Messages)
	record.Status = DesktopAISessionRunning
	record.UpdatedAt = now
	if !record.CustomTitle {
		record.Title = defaultDesktopAISessionTitle(record.Messages)
	}

	if err := validateDesktopAIContext(record, input.Context); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	return s.completeDesktopAITurnWithContext(requestContext, record, config, input.Context, model, input.ReasoningEffort)
}

func (s *DesktopAIService) DeleteMessage(sessionID string, messageID string) (DesktopAICreateSessionResponse, error) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	sessionID = strings.TrimSpace(sessionID)
	messageID = strings.TrimSpace(messageID)
	if sessionID == "" || messageID == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI session id and message id are required")
	}

	if s.hasActiveAIRequest(sessionID) {
		return DesktopAICreateSessionResponse{}, errors.New("AI session is busy")
	}
	record, err := s.loadIdleAISession(sessionID)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	if record.Status == DesktopAISessionRunning {
		return DesktopAICreateSessionResponse{}, errors.New("AI session is busy")
	}
	if desktopAIHasPendingConfirmation(record.Tasks) {
		return DesktopAICreateSessionResponse{}, errors.New("AI session has pending confirmations")
	}

	messageIndex := -1
	for index, message := range record.Messages {
		if message.ID == messageID {
			messageIndex = index
			break
		}
	}
	if messageIndex < 0 {
		return DesktopAICreateSessionResponse{}, errors.New("AI message not found")
	}
	if record.Messages[messageIndex].Role == "assistant" && record.Messages[messageIndex].StoppedAt != "" {
		for messageIndex > 0 && record.Messages[messageIndex-1].Role != "user" {
			messageIndex--
		}
	} else if record.Messages[messageIndex].Role != "user" {
		return DesktopAICreateSessionResponse{}, errors.New("AI message cannot be deleted")
	}

	record.Messages = truncateDesktopAIMessages(record.Messages, messageIndex)
	record.Tasks = truncateDesktopAITasks(record.Tasks, record.Messages)
	record.Status = DesktopAISessionIdle
	record.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
	if !record.CustomTitle {
		record.Title = defaultDesktopAISessionTitle(record.Messages)
	}
	if err := s.saveSession(record); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	s.emitAISessionSnapshot(record)

	view := record.toView()
	return DesktopAICreateSessionResponse{
		SessionID:        view.ID,
		Session:          view,
		DefaultTransport: view.DefaultTransport,
	}, nil
}

func (s *DesktopAIService) RenameSession(id string, title string) (map[string]bool, error) {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	if s.hasActiveAIRequest(strings.TrimSpace(id)) {
		return nil, errors.New("AI session is busy")
	}
	record, err := s.loadIdleAISession(strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, errors.New("AI session title is required")
	}
	record.Title = title
	record.CustomTitle = true
	record.UpdatedAt = time.Now().UTC().Format(desktopAITimeLayout)
	if err := s.saveSession(record); err != nil {
		return nil, err
	}
	return map[string]bool{"updated": true}, nil
}

func (s *DesktopAIService) DeleteSession(id string) error {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("AI session id is required")
	}
	s.cancelAIRequest(id)
	s.cancelDesktopConfirmedRun(id)
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	if s.hasActiveAIRequest(id) {
		return errors.New("AI session is busy")
	}
	if _, err := s.loadIdleAISession(id); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	database, err := s.database()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := deleteDesktopAISession(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *DesktopAIService) CloseSession(id string) error {
	desktopAISyncMu.RLock()
	defer desktopAISyncMu.RUnlock()
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("AI session id is required")
	}

	s.cancelAIRequest(id)
	s.cancelDesktopConfirmedRun(id)
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	if s.hasActiveAIRequest(id) {
		return errors.New("another AI turn started while canceling")
	}
	record, err := s.loadIdleAISession(id)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(desktopAITimeLayout)
	record.Status = DesktopAISessionClosed
	record.UpdatedAt = now
	cancelDesktopAIActiveTasks(&record, now)
	if err := s.saveSession(record); err != nil {
		return err
	}
	s.emitAISessionSnapshot(record)
	return nil
}

func (s *DesktopAIService) database() (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, errors.New("AI service is shut down")
	}

	if s.db != nil {
		return s.db, nil
	}

	dataDir := desktopDataDir()
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create desktop data directory: %w", err)
	}

	dbPath := filepath.Join(dataDir, "easyssh-desktop.sqlite")
	database, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}

	if err := configureDesktopDatabase(database); err != nil {
		database.Close()
		return nil, err
	}

	s.db = database
	return s.db, nil
}

func (s *DesktopAIService) loadConfig() (desktopAIConfigRecord, error) {
	id, err := s.configSpace("")
	if err != nil {
		return desktopAIConfigRecord{}, err
	}
	return s.loadSpaceConfig(id)
}
func (s *DesktopAIService) loadSpaceConfig(id string) (desktopAIConfigRecord, error) {
	database, err := s.database()
	if err != nil {
		return desktopAIConfigRecord{}, err
	}
	return loadDesktopAIConfig(database, id)
}

func loadDesktopAIConfig(database interface{ QueryRow(string, ...any) *sql.Row }, id string) (desktopAIConfigRecord, error) {
	var record desktopAIConfigRecord
	var enabled int
	var models string
	err := database.QueryRow(`SELECT enabled,provider,endpoint,api_key,models FROM desktop_ai_config WHERE id=?`, id).Scan(&enabled, &record.Provider, &record.Endpoint, &record.APIKey, &models)
	if errors.Is(err, sql.ErrNoRows) {
		return desktopAIConfigRecord{Provider: "openai", Models: []string{}}, nil
	}
	if err != nil {
		return desktopAIConfigRecord{}, err
	}
	if err := json.Unmarshal([]byte(models), &record.Models); err != nil {
		return desktopAIConfigRecord{}, err
	}
	record.APIKey, err = decryptDesktopCredential(record.APIKey, "desktop_ai_config", id, "api_key")
	if err != nil {
		return desktopAIConfigRecord{}, err
	}
	record.Enabled = enabled == 1
	record.Stored = true
	return record, nil
}

func (s *DesktopAIService) loadSession(id string) (desktopAISessionRecord, error) {
	database, err := s.database()
	if err != nil {
		return desktopAISessionRecord{}, err
	}
	if id == "" {
		return desktopAISessionRecord{}, errors.New("AI session id is required")
	}

	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := database.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return desktopAISessionRecord{}, err
	}
	defer tx.Rollback()
	record, err := loadDesktopAISession(tx, id)
	if err != nil {
		return desktopAISessionRecord{}, err
	}
	if err := tx.Commit(); err != nil {
		return desktopAISessionRecord{}, err
	}
	s.mu.Lock()
	if request := s.activeRequests[id]; request != nil {
		for index := range record.Tasks {
			if output, ok := request.CommandOutputs[record.Tasks[index].ID]; ok {
				record.Tasks[index].CommandOutput = output
			}
		}
	}
	s.mu.Unlock()
	if !record.CustomTitle {
		record.Title = defaultDesktopAISessionTitle(record.Messages)
	}
	return record, nil
}

func (s *DesktopAIService) saveSessionRaw(ctx context.Context, record desktopAISessionRecord) error {
	database, err := s.database()
	if err != nil {
		return err
	}
	saveCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := database.BeginTx(saveCtx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := saveDesktopAISession(saveCtx, tx, record); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *DesktopAIService) beginAIRequest(parent context.Context, sessionID string) (context.Context, *desktopAIActiveRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopping || s.closed {
		return nil, nil, errors.New("AI service is stopping")
	}
	if sessionID == "" {
		return nil, nil, errors.New("AI session id is required")
	}
	if s.activeRequests[sessionID] != nil {
		return nil, nil, errors.New("AI session is busy")
	}
	if len(s.activeRequests) >= 128 {
		return nil, nil, errors.New("AI request capacity reached")
	}
	requestContext, cancel := context.WithTimeout(desktopNonNilContext(parent), aiprovider.AutomaticRunTimeout)
	request := &desktopAIActiveRequest{Cancel: cancel, Done: make(chan struct{}), CommandOutputs: map[string]string{}}
	if s.activeRequests == nil {
		s.activeRequests = map[string]*desktopAIActiveRequest{}
	}
	s.activeRequests[sessionID] = request
	return requestContext, request, nil
}

func (s *DesktopAIService) finishAIRequest(sessionID string, request *desktopAIActiveRequest) {
	request.Cancel()
	s.mu.Lock()
	if s.activeRequests[sessionID] == request {
		delete(s.activeRequests, sessionID)
	}
	s.mu.Unlock()
	request.finish.Do(func() { close(request.Done) })
}

func (s *DesktopAIService) cancelAIRequest(sessionID string) bool {
	s.mu.Lock()
	active, ok := s.activeRequests[sessionID]
	s.mu.Unlock()

	if !ok {
		return false
	}
	active.Cancel()
	// The final snapshot owns the partial reply. Wait before loading and saving it again.
	<-active.Done
	return true
}

func (s *DesktopAIService) hasActiveAIRequest(sessionID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.activeRequests[sessionID]
	return ok
}

func (s *DesktopAIService) completeChat(ctx context.Context, config desktopAIConfigRecord, record desktopAISessionRecord, contextText string, model string, reasoningEffort string, onEvent func(aiprovider.Event) error) (aiprovider.TurnResult, error) {
	factory := aiprovider.NewFactory()
	result, err := factory.StreamTurn(ctx, aiprovider.Config{
		Provider: config.Provider,
		APIKey:   strings.TrimSpace(config.APIKey),
		Endpoint: strings.TrimSpace(config.Endpoint),
		Model:    model,
	}, aiprovider.TurnRequest{
		ReasoningEffort: reasoningEffort,
		Model:           model,
		Messages:        desktopAIProviderMessages(record, contextText),
		Tools:           desktopAIProviderToolSpecs(desktopAIVisibleToolSpecs(record.PermissionMode, record.Scope)),
	}, func(event aiprovider.Event) error {
		if onEvent != nil {
			return onEvent(event)
		}
		return nil
	})
	if err != nil {
		return aiprovider.TurnResult{}, err
	}
	return result, nil
}

func desktopAIProviderMessages(record desktopAISessionRecord, contextText string) []aiprovider.Message {
	tools := desktopAIVisibleToolSpecs(record.PermissionMode, record.Scope)
	result := []aiprovider.Message{{
		Role:    "system",
		Content: desktopAIToolSystemPrompt(record.PermissionMode, tools, record.Scope),
	}}
	contextText = strings.TrimSpace(contextText)

	for _, message := range record.Messages {
		if message.Role != "user" && message.Role != "assistant" {
			continue
		}
		content := aichatui.ContentWithServerReferences(message.Content, message.ServerReferences)
		providerMessage := aiprovider.Message{
			Role: message.Role, Content: content,
			Attachments: desktopAIProviderAttachments(message.Attachments),
		}
		if message.Role == "assistant" {
			providerMessage.ToolCalls = desktopAIProviderToolCalls(record.Tasks, message.ID)
			if message.StoppedAt != "" && strings.TrimSpace(content) == "" && len(providerMessage.ToolCalls) == 0 {
				continue
			}
		}
		result = append(result, providerMessage)

		if message.Role == "assistant" {
			result = append(result, desktopAIToolResultMessages(record.Tasks, message.ID)...)
		}
	}
	if contextText != "" {
		result = append(result, aiprovider.Message{Role: "user", Content: aipermission.ExternalContext(contextText)})
	}

	return result
}

func desktopAIProviderToolSpecs(tools []desktopAIToolSpec) []aiprovider.ToolSpec {
	if len(tools) == 0 {
		return nil
	}

	result := make([]aiprovider.ToolSpec, 0, len(tools))
	for _, tool := range tools {
		result = append(result, aiprovider.ToolSpec{
			Name:        tool.Name,
			DisplayName: tool.DisplayName,
			Description: tool.Description,
			Parameters:  tool.Parameters,
			Dangerous:   tool.Dangerous,
		})
	}
	return result
}

func desktopAIProviderToolCalls(tasks []DesktopAITaskView, assistantMessageID string) []aiprovider.ToolCall {
	if len(tasks) == 0 {
		return nil
	}

	result := make([]aiprovider.ToolCall, 0)
	for _, task := range tasks {
		if task.AssistantMessageID != assistantMessageID || task.ToolCallID == "" || task.ToolName == "" {
			continue
		}
		result = append(result, aiprovider.ToolCall{
			ID:        task.ToolCallID,
			Name:      task.ToolName,
			Arguments: desktopAIEncodeArguments(task.Arguments),
		})
	}
	return result
}

func desktopAIToolResultMessages(tasks []DesktopAITaskView, assistantMessageID string) []aiprovider.Message {
	if len(tasks) == 0 {
		return nil
	}

	result := make([]aiprovider.Message, 0)
	for _, task := range tasks {
		if task.AssistantMessageID != assistantMessageID || task.ToolCallID == "" {
			continue
		}
		switch task.Status {
		case DesktopAITaskSucceeded:
			result = append(result, aiprovider.Message{
				Role:       "tool",
				Content:    strings.TrimSpace(task.Result),
				ToolCallID: task.ToolCallID,
			})
		case DesktopAITaskUnknown:
			result = append(result, aiprovider.Message{
				Role: "tool", Content: "工具执行结果未知，远端可能已发生变化。先只读核对，不能直接重试：" + strings.TrimSpace(task.Result), ToolCallID: task.ToolCallID,
			})
		case DesktopAITaskFailed:
			result = append(result, aiprovider.Message{
				Role:       "tool",
				Content:    "工具执行失败: " + strings.TrimSpace(desktopAIFirstNonEmpty(task.Error, task.Result)),
				ToolCallID: task.ToolCallID,
			})
		case DesktopAITaskCancelled:
			result = append(result, aiprovider.Message{
				Role:       "tool",
				Content:    desktopAIFirstNonEmpty(task.Result, "用户已拒绝执行该操作。"),
				ToolCallID: task.ToolCallID,
			})
		}
	}
	return result
}

func desktopAIEncodeArguments(args map[string]any) json.RawMessage {
	if args == nil {
		return json.RawMessage("{}")
	}
	data, err := json.Marshal(args)
	if err != nil {
		return json.RawMessage("{}")
	}
	return json.RawMessage(data)
}

func (s *DesktopAIService) materializeDesktopAITasks(ctx context.Context, record desktopAISessionRecord, assistantMessageID string, toolCalls []aiprovider.ToolCall) ([]DesktopAITaskView, []string, bool) {
	tasks := make([]DesktopAITaskView, 0, len(toolCalls))
	autoTaskIDs := make([]string, 0, len(toolCalls))
	pendingConfirm := false
	for _, toolCall := range toolCalls {
		toolCall = desktopAIScopeToolCall(record.Scope, toolCall)
		args := desktopAIDecodeArguments(toolCall.Arguments)
		spec, ok := desktopAIToolSpecByName(record.PermissionMode, record.Scope, toolCall.Name)
		now := time.Now().UTC().Format(desktopAITimeLayout)
		taskID := newDesktopAIID("ai-task")
		task := DesktopAITaskView{
			ID:                   taskID,
			AssistantMessageID:   assistantMessageID,
			ToolCallID:           desktopAIFirstNonEmpty(toolCall.ID, taskID),
			ToolName:             toolCall.Name,
			ToolDisplayName:      desktopAIFirstNonEmpty(spec.DisplayName, toolCall.Name),
			Summary:              desktopAISummarizeTask(toolCall.Name, args),
			Status:               DesktopAITaskQueued,
			Dangerous:            spec.Dangerous,
			RequiresConfirmation: desktopAIRequiresConfirmation(record.PermissionMode, spec),
			Arguments:            args,
			CreatedAt:            now,
			UpdatedAt:            now,
		}
		if trackedDesktopAITool(task.ToolName) {
			origin, err := s.newExecutionOrigin(ctx, task)
			record.ExecutionOrigins[task.ID] = origin
			if err != nil {
				task.Status = DesktopAITaskFailed
				task.Error = err.Error()
				task.Result = task.Error
				tasks = append(tasks, task)
				continue
			}
		}
		if !ok {
			task.Status = DesktopAITaskFailed
			task.Error = fmt.Sprintf("未知工具: %s", toolCall.Name)
			task.Result = task.Error
			tasks = append(tasks, task)
			continue
		}
		if message := desktopAIValidateServerReference(record, spec, args); message != "" {
			task.Status = DesktopAITaskFailed
			task.Error = message
			task.Result = message
			tasks = append(tasks, task)
			continue
		}
		candidate := record
		candidate.Tasks = append(append([]DesktopAITaskView(nil), record.Tasks...), tasks...)
		if err := validateDesktopAIHistoryGrowth(candidate); err != nil {
			task.Status, task.Result = DesktopAITaskCancelled, err.Error()
			tasks = append(tasks, task)
			continue
		}
		if toolCall.Name == "write_file" {
			file, err := s.prepareDesktopWrite(ctx, args)
			if err != nil {
				task.Status = DesktopAITaskFailed
				task.Error = err.Error()
				task.Result = task.Error
				tasks = append(tasks, task)
				continue
			}
			task.Artifact = file
			summary := file.FileSummary
			task.File = &summary
		}

		if task.RequiresConfirmation {
			task.Status = DesktopAITaskWaitingConfirm
			pendingConfirm = true
		} else {
			autoTaskIDs = append(autoTaskIDs, taskID)
		}
		tasks = append(tasks, task)
	}
	return tasks, autoTaskIDs, pendingConfirm
}

func (s *DesktopAIService) executeDesktopAITask(ctx context.Context, record desktopAISessionRecord, taskID string) (desktopAISessionRecord, error) {
	if err := validateDesktopAIHistoryGrowth(record); err != nil {
		_, saveErr := s.failDesktopAITurn(record, err)
		return record, saveErr
	}
	taskIndex := desktopAIFindTaskIndex(record.Tasks, taskID)
	if taskIndex < 0 {
		return record, errors.New("AI task not found")
	}

	now := time.Now().UTC().Format(desktopAITimeLayout)
	if ctx.Err() != nil {
		cancelDesktopAIActiveTasks(&record, now)
		record.Status = DesktopAISessionIdle
		record.UpdatedAt = now
		if err := s.saveSession(record); err != nil {
			return record, err
		}
		s.emitAISessionSnapshot(record)
		return record, nil
	}

	spec, ok := desktopAIToolSpecByName(record.PermissionMode, record.Scope, record.Tasks[taskIndex].ToolName)
	if !ok {
		record.Tasks[taskIndex].Status = DesktopAITaskFailed
		record.Tasks[taskIndex].Error = fmt.Sprintf("当前权限不允许执行工具: %s", record.Tasks[taskIndex].ToolName)
		record.Tasks[taskIndex].Result = record.Tasks[taskIndex].Error
		record.Tasks[taskIndex].UpdatedAt = now
		record.UpdatedAt = now
		if err := s.saveSession(record); err != nil {
			return record, err
		}
		s.emitAISessionSnapshot(record)
		return record, nil
	}
	if message := desktopAIValidateServerReference(record, spec, record.Tasks[taskIndex].Arguments); message != "" {
		record.Tasks[taskIndex].Status = DesktopAITaskFailed
		record.Tasks[taskIndex].Error = message
		record.Tasks[taskIndex].Result = message
		record.Tasks[taskIndex].UpdatedAt = now
		record.UpdatedAt = now
		if err := s.saveSession(record); err != nil {
			return record, err
		}
		s.emitAISessionSnapshot(record)
		return record, nil
	}
	record.Tasks[taskIndex].Arguments = desktopAIEnforceScopedArguments(record.Scope, spec, record.Tasks[taskIndex].Arguments)

	record.Tasks[taskIndex].Status = DesktopAITaskRunning
	record.Tasks[taskIndex].UpdatedAt = now
	record.Status = DesktopAISessionRunning
	record.UpdatedAt = now
	if err := s.saveSession(record); err != nil {
		return record, err
	}
	if ctx.Err() != nil {
		record.Tasks[taskIndex].Status = DesktopAITaskCancelled
		record.Tasks[taskIndex].Result = "操作未开始，已取消。"
		cancelDesktopAIQueuedTasks(&record, time.Now().UTC().Format(desktopAITimeLayout))
		record.Status, record.UpdatedAt = DesktopAISessionIdle, time.Now().UTC().Format(desktopAITimeLayout)
		return record, s.saveSession(record)
	}
	s.emitAISessionSnapshot(record)

	var result desktopAIToolResult
	var err error
	if record.Tasks[taskIndex].ToolName == aitooloutput.ReadResultTool {
		result = desktopAIReadToolResult(record, record.Tasks[taskIndex].Arguments)
	} else {
		result, err = s.executeWorkspaceTool(ctx, record.ID, record.Tasks[taskIndex])
	}
	record.Tasks[taskIndex].CommandOutput = result.CommandOutput
	if result.Artifact != nil {
		record.Tasks[taskIndex].Artifact = result.Artifact
		summary := result.Artifact.FileSummary
		record.Tasks[taskIndex].File = &summary
	}

	now = time.Now().UTC().Format(desktopAITimeLayout)
	applyDesktopAIToolOutcome(&record.Tasks[taskIndex], result, err)
	if result.Unknown || ctx.Err() != nil {
		cancelDesktopAIQueuedTasks(&record, now)
		record.Status = DesktopAISessionIdle
	}
	record.Tasks[taskIndex].UpdatedAt = now
	record.UpdatedAt = now
	if err := s.saveSession(record); err != nil {
		return record, err
	}
	s.emitAISessionSnapshot(record)
	return record, nil
}

func (s *DesktopAIService) executeDesktopAITool(ctx context.Context, toolName string, args map[string]any) (desktopAIToolResult, error) {
	switch toolName {
	case aiworkspace.CreateTool:
		return createDesktopArtifact(args)
	case "list_servers":
		return s.executeDesktopAIListServers(ctx, args)
	case "get_server_info":
		return s.executeDesktopAIGetServerInfo(ctx, args)
	case "execute_command":
		return s.executeDesktopAICommand(ctx, args)
	case "list_directory":
		return s.executeDesktopAIListDirectory(ctx, args)
	case "read_file":
		return s.executeDesktopAIReadFile(ctx, args)
	case "write_file":
		return s.executeDesktopAIWriteFile(ctx, args)
	case "create_directory":
		return s.executeDesktopAICreateDirectory(ctx, args)
	case "delete_file":
		return s.executeDesktopAIDeleteFile(ctx, args)
	case "get_system_info":
		return s.executeDesktopAIGetSystemInfo(ctx, args)
	default:
		return desktopAIToolResult{Content: fmt.Sprintf("未知工具: %s", toolName), IsError: true}, nil
	}
}

func (s *DesktopAIService) executeDesktopAIListServers(ctx context.Context, _ map[string]any) (desktopAIToolResult, error) {
	if s.serverService == nil {
		return desktopAIToolError("服务器服务不可用"), nil
	}
	if err := ctx.Err(); err != nil {
		return desktopAIToolResult{}, err
	}
	result, err := s.serverService.List(protocol.ServerListRequest{Page: 1, Limit: 100})
	if err != nil {
		return desktopAIToolError("获取服务器列表失败: " + err.Error()), nil
	}
	payload := make([]map[string]any, 0, len(result.Data))
	for _, server := range result.Data {
		payload = append(payload, map[string]any{
			"id":             server.ID,
			"name":           desktopAIFirstNonEmpty(server.Name, server.Host),
			"host":           server.Host,
			"port":           server.Port,
			"username":       server.Username,
			"auth_method":    server.AuthMethod,
			"connected":      server.Connected,
			"group":          server.Group,
			"tags":           server.Tags,
			"description":    server.Description,
			"os":             server.OS,
			"last_connected": server.LastConnected,
		})
	}
	return desktopAIToolJSON(fmt.Sprintf("找到 %d 台服务器", len(payload)), payload), nil
}

func (s *DesktopAIService) executeDesktopAIGetServerInfo(ctx context.Context, args map[string]any) (desktopAIToolResult, error) {
	if s.serverService == nil {
		return desktopAIToolError("服务器服务不可用"), nil
	}
	serverID := desktopAIStringArg(args, "server_id")
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return desktopAIToolError("server_id is required"), nil
	}
	if err := ctx.Err(); err != nil {
		return desktopAIToolResult{}, err
	}
	server, err := s.serverService.GetById(serverID)
	if err != nil {
		return desktopAIToolError("获取服务器信息失败: " + err.Error()), nil
	}
	payload := map[string]any{
		"id":              server.ID,
		"name":            server.Name,
		"host":            server.Host,
		"port":            server.Port,
		"username":        server.Username,
		"auth_method":     server.AuthMethod,
		"connected":       server.Connected,
		"group":           server.Group,
		"tags":            server.Tags,
		"description":     server.Description,
		"os":              server.OS,
		"last_connected":  server.LastConnected,
		"has_password":    server.HasPassword,
		"has_private_key": server.HasPrivateKey,
	}
	return desktopAIToolJSON("服务器信息", payload), nil
}

func (s *DesktopAIService) executeDesktopAICommand(ctx context.Context, args map[string]any) (desktopAIToolResult, error) {
	if s.serverService == nil {
		return desktopAIToolError("服务器服务不可用"), nil
	}
	serverID := desktopAIStringArg(args, "server_id")
	command := desktopAIStringArg(args, "command")
	if serverID == "" || command == "" {
		return desktopAIToolError("server_id and command are required"), nil
	}
	timeoutSeconds := desktopAIIntArg(args, "timeout", 60)
	if timeoutSeconds <= 0 {
		timeoutSeconds = 60
	}
	if timeoutSeconds > 120 {
		timeoutSeconds = 120
	}
	select {
	case <-ctx.Done():
		return desktopAIToolResult{Cancelled: true, Content: "操作未开始，已取消。"}, nil
	default:
	}
	result, err := s.serverService.executeCommandContext(ctx, DesktopServerCommandInput{
		ServerID:  serverID,
		Command:   command,
		TimeoutMs: timeoutSeconds * 1000,
	})
	if err != nil {
		return desktopAIToolError("执行命令失败: " + err.Error()), nil
	}
	output := aitooloutput.Truncate(aitooloutput.Sanitize(result.Output), aitooloutput.StoredTextBytes)
	payload := map[string]any{
		"server_id":    result.ServerID,
		"command":      result.Command,
		"exit_code":    result.ExitCode,
		"outcome":      result.Outcome,
		"error":        result.Error,
		"duration_ms":  result.DurationMs,
		"started_at":   result.StartedAt,
		"completed_at": result.CompletedAt,
		"output":       output,
	}
	title := "命令执行成功"
	switch result.Outcome {
	case "unknown":
		title = "命令结果未知；先只读核对，不能直接重试"
	case "canceled":
		title = "命令未开始，已取消"
	case "failed":
		title = "命令执行失败"
	}
	toolResult := desktopAIToolJSON(title, payload)
	toolResult.Unknown = result.Outcome == "unknown"
	toolResult.Cancelled = result.Outcome == "canceled"
	toolResult.IsError = result.Outcome == "failed"
	toolResult.CommandOutput = output
	return toolResult, nil
}

func (s *DesktopAIService) executeDesktopAIListDirectory(ctx context.Context, args map[string]any) (desktopAIToolResult, error) {
	if s.sftpService == nil {
		return desktopAIToolError("SFTP 服务不可用"), nil
	}
	serverID := desktopAIStringArg(args, "server_id")
	remotePath := strings.TrimSpace(desktopAIStringArg(args, "path"))
	if remotePath == "" || remotePath == "~" {
		remotePath = "."
	}
	if serverID == "" {
		return desktopAIToolError("server_id is required"), nil
	}
	result, err := s.sftpService.ListDirectoryContext(ctx, DesktopSFTPPathInput{ServerID: serverID, Path: remotePath})
	if err != nil {
		return desktopAIToolError("列出目录失败: " + err.Error()), nil
	}
	files := make([]map[string]any, 0, len(result.Files))
	for _, file := range result.Files {
		files = append(files, map[string]any{
			"name":        file.Name,
			"path":        file.Path,
			"size":        file.Size,
			"is_dir":      file.IsDir,
			"is_link":     file.IsLink,
			"permission":  file.Permission,
			"modified_at": file.ModTime,
			"link_target": file.LinkTarget,
		})
	}
	payload := map[string]any{
		"path":     result.Path,
		"parent":   result.Parent,
		"files":    files,
		"total":    len(files),
		"can_read": result.CanRead,
	}
	return desktopAIToolJSON("目录列表", payload), nil
}

func (s *DesktopAIService) executeDesktopAIReadFile(ctx context.Context, args map[string]any) (desktopAIToolResult, error) {
	if s.sftpService == nil {
		return desktopAIToolError("SFTP 服务不可用"), nil
	}
	serverID := desktopAIStringArg(args, "server_id")
	remotePath := desktopAIStringArg(args, "path")
	if serverID == "" || remotePath == "" {
		return desktopAIToolError("server_id and path are required"), nil
	}
	maxLines := desktopAIIntArg(args, "max_lines", 100)
	if maxLines <= 0 {
		maxLines = 100
	}
	if maxLines > 500 {
		maxLines = 500
	}
	content, err := s.sftpService.ReadFileContext(ctx, DesktopSFTPPathInput{ServerID: serverID, Path: remotePath})
	if err != nil {
		return desktopAIToolError("读取文件失败: " + err.Error()), nil
	}
	lines := strings.Split(aitooloutput.Sanitize(content), "\n")
	truncated := false
	if len(lines) > maxLines {
		lines = lines[:maxLines]
		truncated = true
	}
	output := strings.Join(lines, "\n")
	if truncated {
		output += fmt.Sprintf("\n\n... (文件已截断，仅显示前 %d 行)", maxLines)
	}
	output = aitooloutput.Truncate(output, aitooloutput.StoredTextBytes)
	result := desktopAIToolResult{Content: fmt.Sprintf("文件内容 (%s):\n```\n%s\n```", remotePath, output)}
	if file, err := aiworkspace.NewFile(remotePath, content, "utf8"); err == nil {
		file.Kind, file.Path, file.ServerID = "read", remotePath, serverID
		result.Artifact = file
	}
	return result, nil
}

func (s *DesktopAIService) executeDesktopAIWriteFile(ctx context.Context, args map[string]any) (desktopAIToolResult, error) {
	if s.sftpService == nil {
		return desktopAIToolError("SFTP 服务不可用"), nil
	}
	serverID := desktopAIStringArg(args, "server_id")
	remotePath := desktopAIStringArg(args, "path")
	content := desktopAIContentArg(args, "content")
	if serverID == "" || remotePath == "" {
		return desktopAIToolError("server_id and path are required"), nil
	}
	prepared := aiworkspace.PreparedFile(ctx)
	before, readErr := s.sftpService.ReadFileContext(ctx, DesktopSFTPPathInput{ServerID: serverID, Path: remotePath})
	exists := !errors.Is(readErr, os.ErrNotExist)
	if readErr != nil && exists {
		return desktopAIToolResult{}, readErr
	}
	if err := prepared.CheckBaseline(before, exists); err != nil {
		return desktopAIToolResult{}, err
	}
	if prepared.Content != content || prepared.Path != remotePath || prepared.ServerID != serverID {
		return desktopAIToolResult{}, errors.New("prepared file does not match this operation")
	}

	info, err := s.sftpService.WriteFileContext(ctx, DesktopSFTPWriteFileInput{ServerID: serverID, Path: remotePath, Content: content})
	if err != nil {
		result := desktopAIFileMutationError("写入文件", info, err)
		if info.Operation != nil && info.Operation.Status == "succeeded" {
			result.Artifact = prepared
		}
		return result, nil
	}
	actual, err := s.sftpService.ReadFileContext(ctx, DesktopSFTPPathInput{ServerID: serverID, Path: remotePath})
	if err != nil {
		result := desktopAIToolJSON("文件已写入，后续核对未完成；不要把核对失败当成写入失败并重复执行", map[string]any{"file": info, "verification_error": err.Error()})
		result.Artifact = prepared
		return result, nil
	}
	if actual != content {
		result := desktopAIToolJSON("写入请求已成功，但后续读取内容不一致；重新读取并核对变化，不自动重复写入", info)
		result.Artifact = prepared
		return result, nil
	}
	result := desktopAIToolJSON("文件已写入", info)
	result.Artifact = prepared
	return result, nil
}

func (s *DesktopAIService) executeDesktopAICreateDirectory(ctx context.Context, args map[string]any) (desktopAIToolResult, error) {
	if s.sftpService == nil {
		return desktopAIToolError("SFTP 服务不可用"), nil
	}
	serverID := desktopAIStringArg(args, "server_id")
	remotePath := desktopAIStringArg(args, "path")
	if serverID == "" || remotePath == "" {
		return desktopAIToolError("server_id and path are required"), nil
	}
	info, err := s.sftpService.CreateDirectoryContext(ctx, DesktopSFTPPathInput{ServerID: serverID, Path: remotePath})
	if err != nil {
		return desktopAIFileMutationError("创建目录", info, err), nil
	}
	return desktopAIToolJSON("目录已创建", info), nil
}

func (s *DesktopAIService) executeDesktopAIDeleteFile(ctx context.Context, args map[string]any) (desktopAIToolResult, error) {
	if s.sftpService == nil {
		return desktopAIToolError("SFTP 服务不可用"), nil
	}
	serverID := desktopAIStringArg(args, "server_id")
	remotePath := desktopAIStringArg(args, "path")
	if serverID == "" || remotePath == "" {
		return desktopAIToolError("server_id and path are required"), nil
	}
	info, err := s.sftpService.DeleteContext(ctx, DesktopSFTPPathInput{ServerID: serverID, Path: remotePath})
	if err != nil {
		return desktopAIFileMutationError("删除", info, err), nil
	}
	return desktopAIToolJSON("文件或目录已删除", info), nil
}

func (s *DesktopAIService) executeDesktopAIGetSystemInfo(ctx context.Context, args map[string]any) (desktopAIToolResult, error) {
	if s.monitorService == nil {
		return desktopAIToolError("监控服务不可用"), nil
	}
	serverID := desktopAIStringArg(args, "server_id")
	if serverID == "" {
		return desktopAIToolError("server_id is required"), nil
	}
	snapshot, err := s.monitorService.CollectContext(ctx, DesktopMonitorCollectInput{ServerID: serverID, TimeoutMs: 30000})
	if err != nil {
		return desktopAIToolError("获取系统信息失败: " + err.Error()), nil
	}
	payload := map[string]any{
		"system_info":    snapshot.SystemInfo,
		"cpu":            snapshot.CPU,
		"memory":         snapshot.Memory,
		"network":        snapshot.Network,
		"disks":          snapshot.Disks,
		"docker":         snapshot.Docker,
		"ssh_latency_ms": snapshot.SSHLatency,
		"collected_at":   snapshot.CollectedAt,
	}
	return desktopAIToolJSON("系统信息", payload), nil
}

func normalizeDesktopAIListParams(params DesktopAIListSessionsParams) DesktopAIListSessionsParams {
	if params.Page < 1 {
		params.Page = 1
	}
	if params.Limit < 1 {
		params.Limit = 30
	}
	if params.Limit > 100 {
		params.Limit = 100
	}
	params.Q = aichatui.NormalizeSessionSearch(params.Q)
	params.ScopeKind = strings.ToLower(strings.TrimSpace(params.ScopeKind))
	params.TerminalSessionID = strings.TrimSpace(params.TerminalSessionID)
	params.ServerID = strings.TrimSpace(params.ServerID)
	if params.ScopeKind == "" && (params.TerminalSessionID != "" || params.ServerID != "") {
		params.ScopeKind = "terminal"
	}
	if !strings.EqualFold(params.ScopeKind, "terminal") {
		params.ScopeKind = ""
		params.TerminalSessionID = ""
		params.ServerID = ""
	}
	return params
}

func buildDesktopAIWhere(params DesktopAIListSessionsParams) (string, []any) {
	params = normalizeDesktopAIListParams(params)
	clauses := []string{"message_count > 0"}
	args := make([]any, 0)

	if params.ScopeKind != "" {
		clauses = append(clauses, "scope_kind = ?")
		args = append(args, params.ScopeKind)
	}
	if params.TerminalSessionID != "" {
		clauses = append(clauses, "scope_terminal_session_id = ?")
		args = append(args, params.TerminalSessionID)
	}
	if params.ServerID != "" {
		clauses = append(clauses, "scope_server_id = ?")
		args = append(args, params.ServerID)
	}

	if params.Q != "" {
		like := aichatui.SessionSearchPattern(params.Q)
		clauses = append(clauses, "(title_folded LIKE ? ESCAPE '!' OR search_folded LIKE ? ESCAPE '!')")
		args = append(args, like, like)
	}
	return strings.Join(clauses, " AND "), args
}

func normalizeDesktopAISessionScope(scope *DesktopAISessionScope) *DesktopAISessionScope {
	if scope == nil {
		return nil
	}

	normalized := &DesktopAISessionScope{
		Kind:              strings.ToLower(strings.TrimSpace(scope.Kind)),
		TerminalSessionID: strings.TrimSpace(scope.TerminalSessionID),
		ServerID:          strings.TrimSpace(scope.ServerID),
		ServerName:        strings.TrimSpace(scope.ServerName),
		Host:              strings.TrimSpace(scope.Host),
		Port:              scope.Port,
		Username:          strings.TrimSpace(scope.Username),
	}

	switch normalized.Kind {
	case "terminal":
		return normalized
	default:
		if normalized.TerminalSessionID != "" || normalized.ServerID != "" {
			normalized.Kind = "terminal"
			return normalized
		}
		return nil
	}
}

func (record desktopAISessionRecord) toView() DesktopAISessionView {
	var title string
	if record.CustomTitle {
		title = record.Title
	}
	return DesktopAISessionView{
		Title:            title,
		ID:               record.ID,
		Model:            record.Model,
		PermissionMode:   normalizeDesktopAIPermission(record.PermissionMode),
		Scope:            record.Scope,
		Status:           record.Status,
		CreatedAt:        record.CreatedAt,
		UpdatedAt:        record.UpdatedAt,
		MessageCount:     len(record.Messages),
		TaskCount:        len(record.Tasks),
		DefaultTransport: "ai_sdk_ui",
	}
}

func desktopAIAllToolSpecs() []desktopAIToolSpec {
	return []desktopAIToolSpec{
		{Name: aiworkspace.CreateTool, DisplayName: "生成文件", Description: aiworkspace.CreateDescription,
			Parameters: aiworkspace.CreateParameters(), ConfirmStrategy: desktopAIConfirmNone,
			SupportedModes: []DesktopAIPermissionMode{DesktopAIPermissionReadonly, DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged}},
		{
			Name: aitooloutput.ReadResultTool, DisplayName: "查看执行结果", Description: aitooloutput.ReadResultDescription,
			Parameters: aitooloutput.ReadResultParameters(), ConfirmStrategy: desktopAIConfirmNone,
			SupportedModes: []DesktopAIPermissionMode{DesktopAIPermissionReadonly, DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged},
		},
		{
			Name:            "list_servers",
			DisplayName:     "列出服务器",
			Description:     "列出本地保存的所有服务器。返回服务器列表，包含 ID、名称、主机地址、状态等信息。",
			Parameters:      map[string]interface{}{"type": "object", "properties": map[string]interface{}{}, "required": []string{}},
			ConfirmStrategy: desktopAIConfirmNone,
			SupportedModes:  []DesktopAIPermissionMode{DesktopAIPermissionReadonly, DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged},
		},
		{
			Name:        "get_server_info",
			DisplayName: "获取服务器信息",
			Description: "获取指定服务器的详细信息，包括主机地址、端口、用户名、状态、操作系统等。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{"type": "string", "description": "服务器 ID"},
				},
				"required": []string{"server_id"},
			},
			ConfirmStrategy: desktopAIConfirmNone,
			SupportedModes:  []DesktopAIPermissionMode{DesktopAIPermissionReadonly, DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged},
		},
		{
			Name:        "execute_command",
			DisplayName: "执行命令",
			Description: "在指定服务器上执行 Shell 命令。返回命令输出结果。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{"type": "string", "description": "要执行命令的服务器 ID"},
					"command":   map[string]interface{}{"type": "string", "description": "要执行的 Shell 命令"},
					"timeout":   map[string]interface{}{"type": "integer", "description": "命令执行超时时间（秒），默认 60，最大 300", "default": 60},
				},
				"required": []string{"server_id", "command"},
			},
			Dangerous:       true,
			ConfirmStrategy: desktopAIConfirmUser,
			SupportedModes:  []DesktopAIPermissionMode{DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged},
		},
		{
			Name:        "list_directory",
			DisplayName: "列出目录",
			Description: "列出服务器上指定目录的内容，包括文件和子目录。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{"type": "string", "description": "服务器 ID"},
					"path":      map[string]interface{}{"type": "string", "description": "目录路径，默认 /", "default": "/"},
				},
				"required": []string{"server_id"},
			},
			ConfirmStrategy: desktopAIConfirmNone,
			SupportedModes:  []DesktopAIPermissionMode{DesktopAIPermissionReadonly, DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged},
		},
		{
			Name:        "read_file",
			DisplayName: "读取文件",
			Description: "读取服务器上指定文本文件的内容。超大文件会拒绝读取，长内容会按行截断。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{"type": "string", "description": "服务器 ID"},
					"path":      map[string]interface{}{"type": "string", "description": "文件路径"},
					"max_lines": map[string]interface{}{"type": "integer", "description": "最大读取行数，默认 100，最大 500", "default": 100},
				},
				"required": []string{"server_id", "path"},
			},
			ConfirmStrategy: desktopAIConfirmNone,
			SupportedModes:  []DesktopAIPermissionMode{DesktopAIPermissionReadonly, DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged},
		},
		{
			Name:        "write_file",
			DisplayName: "写入文件",
			Description: "向服务器写入最多 2 MiB 的 UTF-8 文本。修改文件优先使用此工具：记录真实原文件和提议内容供用户查看对比，执行前核对原内容，变化时停止写入。会话文件使用 create_artifact。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{"type": "string", "description": "服务器 ID"},
					"path":      map[string]interface{}{"type": "string", "description": "文件路径"},
					"content":   map[string]interface{}{"type": "string", "description": "要写入的内容"},
				},
				"required": []string{"server_id", "path", "content"},
			},
			Dangerous:       true,
			ConfirmStrategy: desktopAIConfirmUser,
			SupportedModes:  []DesktopAIPermissionMode{DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged},
		},
		{
			Name:        "create_directory",
			DisplayName: "创建目录",
			Description: "在服务器上创建目录。支持递归创建。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{"type": "string", "description": "服务器 ID"},
					"path":      map[string]interface{}{"type": "string", "description": "目录路径"},
				},
				"required": []string{"server_id", "path"},
			},
			ConfirmStrategy: desktopAIConfirmNone,
			SupportedModes:  []DesktopAIPermissionMode{DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged},
		},
		{
			Name:        "delete_file",
			DisplayName: "删除文件",
			Description: "删除服务器上的文件或目录。目录会被递归删除。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{"type": "string", "description": "服务器 ID"},
					"path":      map[string]interface{}{"type": "string", "description": "文件或目录路径"},
				},
				"required": []string{"server_id", "path"},
			},
			Dangerous:       true,
			ConfirmStrategy: desktopAIConfirmUser,
			SupportedModes:  []DesktopAIPermissionMode{DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged},
		},
		{
			Name:        "get_system_info",
			DisplayName: "系统信息",
			Description: "获取服务器的系统信息，包括 CPU、内存、磁盘、网络和 Docker 概况。",
			Parameters: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"server_id": map[string]interface{}{"type": "string", "description": "服务器 ID"},
				},
				"required": []string{"server_id"},
			},
			ConfirmStrategy: desktopAIConfirmNone,
			SupportedModes:  []DesktopAIPermissionMode{DesktopAIPermissionReadonly, DesktopAIPermissionBalanced, DesktopAIPermissionPrivileged},
		},
	}
}

func desktopAIVisibleToolSpecs(permission DesktopAIPermissionMode, scope *DesktopAISessionScope) []desktopAIToolSpec {
	mode := normalizeDesktopAIPermission(permission)
	normalizedScope := normalizeDesktopAISessionScope(scope)
	result := make([]desktopAIToolSpec, 0)
	for _, tool := range desktopAIAllToolSpecs() {
		if !desktopAIToolSupportsMode(tool, mode) {
			continue
		}
		if normalizedScope != nil && normalizedScope.Kind == "terminal" && normalizedScope.ServerID != "" {
			if tool.Name == "list_servers" {
				continue
			}
			if desktopAIToolHasServerIDParameter(tool) {
				tool.Parameters = desktopAIPinServerIDParameter(tool.Parameters, normalizedScope.ServerID)
			}
		}
		result = append(result, tool)
	}
	return result
}

func desktopAIToolSpecByName(permission DesktopAIPermissionMode, scope *DesktopAISessionScope, name string) (desktopAIToolSpec, bool) {
	for _, tool := range desktopAIVisibleToolSpecs(permission, scope) {
		if tool.Name == name {
			return tool, true
		}
	}
	return desktopAIToolSpec{}, false
}

func desktopAIToolSupportsMode(tool desktopAIToolSpec, mode DesktopAIPermissionMode) bool {
	if len(tool.SupportedModes) == 0 {
		return true
	}
	for _, supported := range tool.SupportedModes {
		if supported == mode {
			return true
		}
	}
	return false
}

func desktopAIToolHasServerIDParameter(tool desktopAIToolSpec) bool {
	properties, ok := tool.Parameters["properties"].(map[string]interface{})
	if !ok {
		return false
	}
	_, ok = properties["server_id"]
	return ok
}

func desktopAIPinServerIDParameter(parameters map[string]interface{}, serverID string) map[string]interface{} {
	next := desktopAIShallowCopyMap(parameters)
	properties, ok := next["properties"].(map[string]interface{})
	if !ok {
		return next
	}
	nextProperties := desktopAIShallowCopyMap(properties)
	serverIDParam, _ := nextProperties["server_id"].(map[string]interface{})
	nextServerIDParam := desktopAIShallowCopyMap(serverIDParam)
	nextServerIDParam["const"] = serverID
	nextServerIDParam["default"] = serverID
	nextServerIDParam["description"] = "当前终端会话服务器 ID。必须使用该值，除非用户明确要求切换目标。"
	nextProperties["server_id"] = nextServerIDParam
	next["properties"] = nextProperties
	return next
}

func desktopAIShallowCopyMap(input map[string]interface{}) map[string]interface{} {
	next := make(map[string]interface{}, len(input))
	for key, value := range input {
		next[key] = value
	}
	return next
}

func (s *DesktopAIService) emitAISessionSnapshot(record desktopAISessionRecord) {
	view := record.toView()
	s.emitAISessionEvent(DesktopAISessionEvent{
		SessionID: record.ID,
		Type:      "session",
		Session:   &view,
	})
}

func (s *DesktopAIService) emitAISessionEvent(event DesktopAISessionEvent) {
	s.mu.Lock()
	request := s.activeRequests[event.SessionID]
	failed := request != nil && request.StorageErr != nil
	s.mu.Unlock()
	if failed && event.Type != "error" {
		return
	}
	app := application.Get()
	if app == nil || app.Event == nil {
		return
	}

	bounded, send, err := desktopAIWireEvent(event)
	if err != nil {
		bounded = DesktopAISessionEvent{SessionID: event.SessionID, Type: "error", Error: "AI 实时更新无法传递，请重新读取会话历史。"}
	}
	if err != nil || send {
		app.Event.Emit(desktopAISessionEvent, bounded)
	}
}

func toAichatUIMessages(messages []DesktopAIMessageView) []aichatui.MessageView {
	result := make([]aichatui.MessageView, 0, len(messages))
	for _, message := range messages {
		attachments := make([]aichatui.AttachmentView, 0, len(message.Attachments))
		for _, attachment := range message.Attachments {
			attachments = append(attachments, aichatui.AttachmentView{
				ID: attachment.ID, Name: attachment.Name, MediaType: attachment.MediaType, Data: attachment.Data, Size: attachment.Size,
			})
		}
		result = append(result, aichatui.MessageView{
			ID: message.ID, Role: message.Role, Content: message.Content, Reasoning: message.Reasoning, ServerReferences: message.ServerReferences, ExternalContent: message.ExternalContent,
			Attachments: attachments, Usage: desktopAIUsageView(message.Usage),
			ProviderMetadata: desktopAIProviderMetadataView(message.ProviderMetadata), CreatedAt: parseDesktopAITime(message.CreatedAt),
			StoppedAt: parseDesktopAIStoppedAt(message.StoppedAt),
		})
	}
	return result
}

func desktopAIAttachmentViews(attachments []DesktopAIImageAttachment) []aichatui.AttachmentView {
	result := make([]aichatui.AttachmentView, 0, len(attachments))
	for _, attachment := range attachments {
		result = append(result, aichatui.AttachmentView{
			ID: attachment.ID, Name: attachment.Name, MediaType: attachment.MediaType, Data: attachment.Data, Size: attachment.Size,
		})
	}
	return result
}

func desktopAIUsageView(usage *DesktopAIUsage) *aichatui.UsageView {
	if usage == nil {
		return nil
	}
	return &aichatui.UsageView{
		InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens, CachedTokens: usage.CachedTokens,
		CacheWriteTokens: usage.CacheWriteTokens, ReasoningTokens: usage.ReasoningTokens, TotalTokens: usage.TotalTokens,
	}
}

func desktopAIProviderMetadataView(metadata *DesktopAIProviderMetadata) *aichatui.ProviderMetadata {
	if metadata == nil {
		return nil
	}
	return &aichatui.ProviderMetadata{
		Provider: metadata.Provider, API: metadata.API, Endpoint: metadata.Endpoint, RequestID: metadata.RequestID,
		ResponseID: metadata.ResponseID, Model: metadata.Model, FinishReason: metadata.FinishReason,
		ServiceTier: metadata.ServiceTier, EstimatedCostMicros: metadata.EstimatedCostMicros, CostEstimateKind: metadata.CostEstimateKind,
	}
}

func desktopAIProviderAttachments(attachments []DesktopAIImageAttachment) []aiprovider.Attachment {
	result := make([]aiprovider.Attachment, 0, len(attachments))
	for _, attachment := range attachments {
		result = append(result, aiprovider.Attachment{
			ID: attachment.ID, Name: attachment.Name, MediaType: attachment.MediaType, Data: attachment.Data, Size: attachment.Size,
		})
	}
	return result
}

func desktopAIUsage(usage *aiprovider.Usage) *DesktopAIUsage {
	if usage == nil {
		return nil
	}
	return &DesktopAIUsage{
		InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens, CachedTokens: usage.CachedTokens,
		CacheWriteTokens: usage.CacheWriteTokens, ReasoningTokens: usage.ReasoningTokens, TotalTokens: usage.TotalTokens,
	}
}

func desktopAIProviderMetadata(metadata *aiprovider.ProviderMetadata) *DesktopAIProviderMetadata {
	if metadata == nil {
		return nil
	}
	return &DesktopAIProviderMetadata{
		Provider: metadata.Provider, API: metadata.API, Endpoint: metadata.Endpoint, RequestID: metadata.RequestID,
		ResponseID: metadata.ResponseID, Model: metadata.Model, FinishReason: metadata.FinishReason,
		ServiceTier: metadata.ServiceTier, EstimatedCostMicros: metadata.EstimatedCostMicros, CostEstimateKind: metadata.CostEstimateKind,
	}
}

func toAichatUITasks(tasks []DesktopAITaskView) []aichatui.TaskView {
	result := make([]aichatui.TaskView, 0, len(tasks))
	for _, task := range tasks {
		result = append(result, aichatui.TaskView{
			File: task.File, Artifact: task.Artifact, CommandOutput: task.CommandOutput,
			ID:                   task.ID,
			AssistantMessageID:   task.AssistantMessageID,
			ToolCallID:           task.ToolCallID,
			ToolName:             task.ToolName,
			ToolDisplayName:      task.ToolDisplayName,
			Summary:              task.Summary,
			Status:               aichatui.TaskStatus(task.Status),
			Dangerous:            task.Dangerous,
			RequiresConfirmation: task.RequiresConfirmation,
			Arguments:            task.Arguments,
			Result:               task.Result,
			Error:                task.Error,
			CreatedAt:            parseDesktopAITime(task.CreatedAt),
			UpdatedAt:            parseDesktopAITime(task.UpdatedAt),
		})
	}
	return result
}

func parseDesktopAITime(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err == nil {
		return parsed
	}
	parsed, err = time.Parse(time.RFC3339, value)
	if err == nil {
		return parsed
	}
	return time.Time{}
}

func desktopAISystemPrompt(permission DesktopAIPermissionMode) string {
	return "You are EasySSH Desktop AI assistant. Help the user manage SSH servers, write scripts, analyze logs, and reason about terminal workflows. Be concise, practical, and ask for confirmation before suggesting destructive commands. Current permission rule: " + aipermission.Rule(string(permission))
}

func defaultDesktopAISessionTitle(messages []DesktopAIMessageView) string {
	for _, message := range messages {
		if message.Role == "user" && strings.TrimSpace(message.Content) != "" {
			return aichatui.SessionTitleFromContent(message.Content)
		}
	}
	return ""
}

func normalizeDesktopAIPermission(permission DesktopAIPermissionMode) DesktopAIPermissionMode {
	return DesktopAIPermissionMode(aipermission.NormalizeMode(string(permission)))
}

func decodeDesktopAIScope(value string) *DesktopAISessionScope {
	value = strings.TrimSpace(value)
	if value == "" || value == "{}" || value == "null" {
		return nil
	}
	var scope DesktopAISessionScope
	if err := json.Unmarshal([]byte(value), &scope); err != nil {
		return nil
	}
	if scope.Kind == "" {
		return nil
	}
	return normalizeDesktopAISessionScope(&scope)
}

func truncateDesktopAIMessages(messages []DesktopAIMessageView, end int) []DesktopAIMessageView {
	if end < 0 {
		end = 0
	}
	if end > len(messages) {
		end = len(messages)
	}
	return append([]DesktopAIMessageView(nil), messages[:end]...)
}

func truncateDesktopAITasks(tasks []DesktopAITaskView, messages []DesktopAIMessageView) []DesktopAITaskView {
	if len(tasks) == 0 {
		return []DesktopAITaskView{}
	}

	keepMessageIDs := make(map[string]struct{}, len(messages))
	for _, message := range messages {
		keepMessageIDs[message.ID] = struct{}{}
	}

	result := make([]DesktopAITaskView, 0, len(tasks))
	for _, task := range tasks {
		if _, ok := keepMessageIDs[task.AssistantMessageID]; ok {
			result = append(result, task)
		}
	}
	return result
}

func desktopAIScopeToolCall(scope *DesktopAISessionScope, toolCall aiprovider.ToolCall) aiprovider.ToolCall {
	normalizedScope := normalizeDesktopAISessionScope(scope)
	if normalizedScope == nil || normalizedScope.Kind != "terminal" || normalizedScope.ServerID == "" {
		return toolCall
	}

	args := desktopAIDecodeArguments(toolCall.Arguments)
	if _, ok := args["server_id"]; !ok {
		return toolCall
	}
	args["server_id"] = normalizedScope.ServerID
	toolCall.Arguments = desktopAIEncodeArguments(args)
	return toolCall
}

func desktopAIEnforceScopedArguments(scope *DesktopAISessionScope, spec desktopAIToolSpec, args map[string]any) map[string]any {
	normalizedScope := normalizeDesktopAISessionScope(scope)
	if normalizedScope == nil || normalizedScope.Kind != "terminal" || normalizedScope.ServerID == "" || !desktopAIToolHasServerIDParameter(spec) {
		return args
	}

	next := make(map[string]any, len(args)+1)
	for key, value := range args {
		next[key] = value
	}
	next["server_id"] = normalizedScope.ServerID
	return next
}

func desktopAIValidateServerReference(record desktopAISessionRecord, spec desktopAIToolSpec, args map[string]any) string {
	if !desktopAIToolHasServerIDParameter(spec) {
		return ""
	}
	var refs []aichatui.ServerReference
	for index := len(record.Messages) - 1; index >= 0; index-- {
		if record.Messages[index].Role == "user" {
			refs = record.Messages[index].ServerReferences
			break
		}
	}
	if len(refs) <= 1 {
		return ""
	}
	allowed := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		allowed[ref.ServerID] = struct{}{}
	}
	serverID := desktopAIStringArg(args, "server_id")
	if serverID == "" {
		return "多服务器引用时，工具必须明确提供正文中引用的 server_id。"
	}
	if _, ok := allowed[serverID]; !ok {
		return fmt.Sprintf("工具目标 server_id=%s 不在本条消息引用的服务器范围内。请按正文中的 @服务器重新绑定目标。", serverID)
	}
	return ""
}

func desktopAIRequiresConfirmation(permission DesktopAIPermissionMode, spec desktopAIToolSpec) bool {
	ordinary := spec.ConfirmStrategy == desktopAIConfirmUser
	return aipermission.RequiresConfirmation(string(permission), ordinary)
}

func desktopAIDecodeArguments(raw json.RawMessage) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}

	var args map[string]any
	if err := json.Unmarshal(raw, &args); err != nil {
		return map[string]any{"_raw": string(raw)}
	}
	if args == nil {
		return map[string]any{}
	}
	return args
}

func desktopAISummarizeTask(toolName string, args map[string]any) string {
	for _, key := range []string{"command", "path", "server_id"} {
		if value, ok := args[key]; ok {
			text := fmt.Sprint(value)
			runes := []rune(text)
			if len(runes) > 48 {
				text = string(runes[:48]) + "..."
			}
			return text
		}
	}
	return toolName
}

func desktopAIFindTaskIndex(tasks []DesktopAITaskView, taskID string) int {
	for index, task := range tasks {
		if task.ID == taskID {
			return index
		}
	}
	return -1
}

func desktopAIHasPendingConfirmation(tasks []DesktopAITaskView) bool {
	for _, task := range tasks {
		if task.Status == DesktopAITaskWaitingConfirm {
			return true
		}
	}
	return false
}

func cancelDesktopAIActiveTasks(record *desktopAISessionRecord, now string) {
	for index := range record.Tasks {
		if record.Tasks[index].Status != DesktopAITaskQueued && record.Tasks[index].Status != DesktopAITaskRunning && record.Tasks[index].Status != DesktopAITaskWaitingConfirm {
			continue
		}
		if record.Tasks[index].Status == DesktopAITaskRunning {
			record.Tasks[index].Status = DesktopAITaskUnknown
			record.Tasks[index].Error = "执行中断，远端结果未知；先核对，不能直接重试。"
			record.Tasks[index].UpdatedAt = now
			continue
		}
		record.Tasks[index].Status = DesktopAITaskCancelled
		record.Tasks[index].Result = "操作未开始，已取消。"
		record.Tasks[index].Error = ""
		record.Tasks[index].UpdatedAt = now
	}
}

func parseDesktopAIStoppedAt(value string) *time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return nil
	}
	return &parsed
}

func markDesktopAIRunStopped(record *desktopAISessionRecord, now string) {
	for index := len(record.Messages) - 1; index >= 0; index-- {
		if record.Messages[index].Role == "user" {
			break
		}
		if record.Messages[index].Role == "assistant" {
			if record.Messages[index].StoppedAt == "" {
				record.Messages[index].StoppedAt = now
			}
			return
		}
	}
	record.Messages = append(record.Messages, DesktopAIMessageView{ID: newDesktopAIID("msg"), Role: "assistant", CreatedAt: now, StoppedAt: now})
}

func desktopAIStringArg(args map[string]any, key string) string {
	value, ok := args[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func desktopAIContentArg(args map[string]any, key string) string {
	value, ok := args[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func desktopAIIntArg(args map[string]any, key string, fallback int) int {
	value, ok := args[key]
	if !ok || value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		number, err := typed.Int64()
		if err == nil {
			return int(number)
		}
	case string:
		var parsed int
		if _, err := fmt.Sscanf(strings.TrimSpace(typed), "%d", &parsed); err == nil {
			return parsed
		}
	}
	return fallback
}

func desktopAIFileMutationError(action string, info DesktopSFTPFileInfo, err error) desktopAIToolResult {
	title := action + "未完成"
	if info.Operation != nil && info.Operation.Status == "succeeded" {
		// The remote operation is already confirmed. A local persistence error
		// must not turn it into a failed tool and encourage repeating the effect.
		return desktopAIToolJSON(action+"已完成，但本机任务记录未能保存；不要重复执行", map[string]any{"file": info, "record_error": err.Error()})
	}
	if info.Operation != nil && info.Operation.Status == "unknown" {
		title = action + "结果未知，远端可能已经变更；先只读核对，不能直接重试"
	}
	result := desktopAIToolJSON(title, map[string]any{"operation": info.Operation, "error": err.Error()})
	result.Unknown = info.Operation != nil && info.Operation.Status == "unknown"
	result.Cancelled = info.Operation != nil && info.Operation.Status == "canceled"
	result.IsError = !result.Unknown && !result.Cancelled
	return result
}

func desktopAIToolError(message string) desktopAIToolResult {
	return desktopAIToolResult{Content: message, IsError: true}
}

func desktopAIToolJSON(title string, value any) desktopAIToolResult {
	return desktopAIToolResult{Content: strings.TrimSpace(title) + ":\n" + desktopAIJSON(value)}
}

func desktopAIJSON(value any) string {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(data)
}

func desktopAIToolSystemPrompt(permission DesktopAIPermissionMode, tools []desktopAIToolSpec, scope *DesktopAISessionScope) string {
	var sb strings.Builder
	sb.WriteString("你是 EasySSH Desktop 的本地服务器管理助手，可以帮助个人用户管理和操作本机保存的 SSH 服务器。\n\n")
	sb.WriteString("重要规则：\n")
	sb.WriteString("1. 当用户请求需要执行操作时，你应该直接调用相应工具，不要先用文字询问是否允许。\n")
	sb.WriteString("2. 工具权限与危险操作确认由系统负责，你需要专注于理解需求、正确调用工具、基于结果给出结论。\n")
	sb.WriteString("3. 如果需要多个步骤，请按顺序执行，并始终基于上一步结果推进。\n")
	sb.WriteString("4. 获取工具结果后，必须引用关键数据给出结论，不要只给模板化建议。\n")
	sb.WriteString("5. 不要重复粘贴大段原始输出，优先提炼关键发现与下一步行动。\n")
	sb.WriteString("6. 当前权限规则：")
	sb.WriteString(aipermission.Rule(string(normalizeDesktopAIPermission(permission))))
	normalizedScope := normalizeDesktopAISessionScope(scope)
	if normalizedScope != nil && normalizedScope.Kind == "terminal" {
		sb.WriteString("\n")
		sb.WriteString("7. 当前会话范围：你正在嵌入一个终端页签中，默认面向当前终端连接的服务器。")
		if normalizedScope.ServerID != "" {
			sb.WriteString("除非用户明确要求切换目标，否则工具调用必须使用当前服务器 server_id=")
			sb.WriteString(normalizedScope.ServerID)
			sb.WriteString("。")
		} else {
			sb.WriteString("如果缺少当前服务器 ID，请先说明无法定位目标服务器。")
		}
	}
	sb.WriteString("\n\n")
	if normalizedScope != nil && normalizedScope.Kind == "terminal" {
		sb.WriteString("当前终端上下文：\n")
		sb.WriteString(desktopAIFormatTerminalScope(normalizedScope))
		sb.WriteString("\n\n")
	}
	sb.WriteString("本会话可用工具：\n")
	for _, tool := range tools {
		sb.WriteString("- ")
		sb.WriteString(tool.Name)
		sb.WriteString(": ")
		sb.WriteString(tool.Description)
		sb.WriteString("\n")
	}
	return sb.String()
}

func desktopAIFormatTerminalScope(scope *DesktopAISessionScope) string {
	if scope == nil {
		return "- 未提供当前终端目标信息"
	}
	lines := make([]string, 0, 4)
	if scope.TerminalSessionID != "" {
		lines = append(lines, "- terminal_session_id: "+scope.TerminalSessionID)
	}
	if scope.ServerID != "" {
		lines = append(lines, "- server_id: "+scope.ServerID)
	}
	if scope.ServerName != "" {
		lines = append(lines, "- server_name: "+scope.ServerName)
	}
	if scope.Username != "" || scope.Host != "" || scope.Port > 0 {
		target := scope.Username
		if scope.Host != "" {
			if target != "" {
				target += "@"
			}
			target += scope.Host
		}
		if scope.Port > 0 {
			target += fmt.Sprintf(":%d", scope.Port)
		}
		lines = append(lines, "- connection: "+target)
	}
	if len(lines) == 0 {
		return "- 未提供当前终端目标信息"
	}
	return strings.Join(lines, "\n")
}

func desktopAIFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func mustDesktopAIJSON(value any) string {
	if value == nil {
		return "null"
	}
	data, err := json.Marshal(value)
	if err != nil {
		return "null"
	}
	return string(data)
}

func newDesktopAIID(prefix string) string {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	}
	return fmt.Sprintf("%s-%s", prefix, hex.EncodeToString(bytes[:]))
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
