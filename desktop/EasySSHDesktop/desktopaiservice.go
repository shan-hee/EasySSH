package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/shared/aichatui"
	sharedaiconfig "github.com/easyssh/shared/aiconfig"
	"github.com/easyssh/shared/aipermission"
	"github.com/easyssh/shared/aiprovider"
	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

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
	DesktopAITaskCancelled      DesktopAITaskStatus = "cancelled"
)

type desktopAIConfirmStrategy string

const (
	desktopAIConfirmNone desktopAIConfirmStrategy = "none"
	desktopAIConfirmUser desktopAIConfirmStrategy = "user"
)

type DesktopAIConfigStatus struct {
	Configured bool     `json:"configured"`
	Provider   string   `json:"provider,omitempty"`
	Model      string   `json:"model,omitempty"`
	Models     []string `json:"models,omitempty"`
	HasKey     bool     `json:"has_key"`
	Message    string   `json:"message,omitempty"`
}

type DesktopUserAIConfig struct {
	UseSystemConfig bool   `json:"use_system_config"`
	CustomEnabled   bool   `json:"custom_enabled"`
	CustomProvider  string `json:"custom_provider"`
	CustomEndpoint  string `json:"custom_endpoint"`
	CustomModels    string `json:"custom_models"`
	HasAPIKey       bool   `json:"has_api_key"`
}

type DesktopSaveUserAIConfigRequest struct {
	UseSystemConfig bool   `json:"use_system_config"`
	CustomEnabled   bool   `json:"custom_enabled"`
	CustomProvider  string `json:"custom_provider"`
	CustomAPIKey    string `json:"custom_api_key"`
	CustomEndpoint  string `json:"custom_endpoint"`
	CustomModels    string `json:"custom_models"`
}

type DesktopAIModelsProbeRequest struct {
	CustomProvider string `json:"custom_provider"`
	CustomAPIKey   string `json:"custom_api_key,omitempty"`
	CustomEndpoint string `json:"custom_endpoint,omitempty"`
}

type DesktopAIModelsProbeResponse struct {
	Available bool     `json:"available"`
	Models    []string `json:"models"`
	Message   string   `json:"message,omitempty"`
}

type DesktopAISessionScope struct {
	Kind              string `json:"kind,omitempty"`
	TerminalSessionID string `json:"terminal_session_id,omitempty"`
	ServerID          string `json:"server_id,omitempty"`
	ServerName        string `json:"server_name,omitempty"`
	Host              string `json:"host,omitempty"`
	Port              int    `json:"port,omitempty"`
	Username          string `json:"username,omitempty"`
}

type DesktopAIToolView struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name,omitempty"`
	Description string `json:"description"`
	Dangerous   bool   `json:"dangerous"`
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
	ID               string                     `json:"id"`
	Role             string                     `json:"role"`
	Content          string                     `json:"content"`
	Reasoning        string                     `json:"reasoning,omitempty"`
	Attachments      []DesktopAIImageAttachment `json:"attachments,omitempty"`
	Usage            *DesktopAIUsage            `json:"usage,omitempty"`
	ProviderMetadata *DesktopAIProviderMetadata `json:"provider_metadata,omitempty"`
	CreatedAt        string                     `json:"created_at"`
}

type DesktopAITaskView struct {
	ID                   string              `json:"id"`
	AssistantMessageID   string              `json:"assistant_message_id,omitempty"`
	ToolCallID           string              `json:"tool_call_id"`
	ToolName             string              `json:"tool_name"`
	ToolDisplayName      string              `json:"tool_display_name,omitempty"`
	Summary              string              `json:"summary,omitempty"`
	Status               DesktopAITaskStatus `json:"status"`
	Dangerous            bool                `json:"dangerous"`
	RequiresConfirmation bool                `json:"requires_confirmation"`
	Arguments            map[string]any      `json:"arguments,omitempty"`
	Result               string              `json:"result,omitempty"`
	Error                string              `json:"error,omitempty"`
	CreatedAt            string              `json:"created_at"`
	UpdatedAt            string              `json:"updated_at"`
	CustomTitle          bool                `json:"custom_title,omitempty"`
}

type DesktopAISessionView struct {
	ID               string                  `json:"id"`
	Model            string                  `json:"model"`
	PermissionMode   DesktopAIPermissionMode `json:"permission_mode"`
	Scope            *DesktopAISessionScope  `json:"scope,omitempty"`
	Status           DesktopAISessionStatus  `json:"status"`
	CreatedAt        string                  `json:"created_at"`
	UpdatedAt        string                  `json:"updated_at"`
	Messages         []DesktopAIMessageView  `json:"messages"`
	Tasks            []DesktopAITaskView     `json:"tasks"`
	UIMessages       []aichatui.UIMessage    `json:"ui_messages"`
	AvailableTools   []DesktopAIToolView     `json:"available_tools"`
	DefaultTransport string                  `json:"default_transport"`
}

type DesktopAISessionListItem struct {
	ID             string                  `json:"id"`
	Model          string                  `json:"model"`
	PermissionMode DesktopAIPermissionMode `json:"permission_mode"`
	Status         DesktopAISessionStatus  `json:"status"`
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
	SessionID      string                     `json:"session_id"`
	Content        string                     `json:"content"`
	Context        string                     `json:"context,omitempty"`
	Model          string                     `json:"model,omitempty"`
	PermissionMode DesktopAIPermissionMode    `json:"permission_mode,omitempty"`
	Scope          *DesktopAISessionScope     `json:"scope,omitempty"`
	Attachments    []DesktopAIImageAttachment `json:"attachments,omitempty"`
}

type DesktopAIUpdateMessageInput struct {
	SessionID string `json:"session_id"`
	MessageID string `json:"message_id"`
	Content   string `json:"content"`
}

type DesktopAIRegenerateMessageInput struct {
	SessionID      string                  `json:"session_id"`
	MessageID      string                  `json:"message_id"`
	Context        string                  `json:"context,omitempty"`
	Model          string                  `json:"model,omitempty"`
	PermissionMode DesktopAIPermissionMode `json:"permission_mode,omitempty"`
	Scope          *DesktopAISessionScope  `json:"scope,omitempty"`
}

type DesktopAIConfirmTaskInput struct {
	SessionID string `json:"session_id"`
	TaskID    string `json:"task_id"`
	Decision  string `json:"decision"`
}

type DesktopAISessionEvent struct {
	SessionID string                `json:"session_id"`
	Type      string                `json:"type"`
	Session   *DesktopAISessionView `json:"session,omitempty"`
	UIMessage *aichatui.UIMessage   `json:"ui_message,omitempty"`
	Error     string                `json:"error,omitempty"`
}

type desktopAIConfigRecord struct {
	UseSystemConfig bool
	CustomEnabled   bool
	CustomProvider  string
	CustomEndpoint  string
	CustomAPIKey    string
	CustomModels    string
}

type desktopAISessionRecord struct {
	ID             string
	Title          string
	CustomTitle    bool
	Model          string
	PermissionMode DesktopAIPermissionMode
	Scope          *DesktopAISessionScope
	Status         DesktopAISessionStatus
	Messages       []DesktopAIMessageView
	Tasks          []DesktopAITaskView
	CreatedAt      string
	UpdatedAt      string
}

type desktopAIActiveRequest struct {
	ID     string
	Cancel context.CancelFunc
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
	Content string
	IsError bool
}

type desktopAIConfirmedToolRun struct {
	Context   context.Context
	Cancel    context.CancelFunc
	RequestID string
	Active    int
}

type DesktopAIService struct {
	mu             sync.Mutex
	sessionMu      sync.Mutex
	db             *sql.DB
	activeRequests map[string]desktopAIActiveRequest
	confirmedRuns  map[string]*desktopAIConfirmedToolRun
	serverService  *DesktopServerService
	sftpService    *DesktopSFTPService
	monitorService *DesktopMonitorService
}

func NewDesktopAIService(serverService *DesktopServerService, sftpService *DesktopSFTPService, monitorService *DesktopMonitorService) *DesktopAIService {
	return &DesktopAIService{
		activeRequests: map[string]desktopAIActiveRequest{},
		confirmedRuns:  map[string]*desktopAIConfirmedToolRun{},
		serverService:  serverService,
		sftpService:    sftpService,
		monitorService: monitorService,
	}
}

func (s *DesktopAIService) ServiceName() string {
	return "DesktopAIService"
}

func (s *DesktopAIService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	_, err := s.database()
	return err
}

func (s *DesktopAIService) ServiceShutdown() error {
	var cancels []context.CancelFunc
	var confirmedCancels []context.CancelFunc
	var database *sql.DB

	s.mu.Lock()
	for _, active := range s.activeRequests {
		cancels = append(cancels, active.Cancel)
	}
	s.activeRequests = map[string]desktopAIActiveRequest{}
	database = s.db
	s.db = nil
	s.mu.Unlock()
	s.sessionMu.Lock()
	for _, run := range s.confirmedRuns {
		confirmedCancels = append(confirmedCancels, run.Cancel)
	}
	s.confirmedRuns = map[string]*desktopAIConfirmedToolRun{}
	s.sessionMu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
	for _, cancel := range confirmedCancels {
		cancel()
	}

	if database == nil {
		return nil
	}
	return database.Close()
}

func (s *DesktopAIService) GetAIConfig() (DesktopAIConfigStatus, error) {
	config, err := s.loadConfig()
	if err != nil {
		return DesktopAIConfigStatus{}, err
	}

	models := sharedaiconfig.ParseModels(config.CustomModels)
	configured := config.CustomEnabled && strings.TrimSpace(config.CustomAPIKey) != "" && len(models) > 0
	status := DesktopAIConfigStatus{
		Configured: configured,
		Provider:   sharedaiconfig.NormalizeProvider(config.CustomProvider),
		Models:     models,
		HasKey:     strings.TrimSpace(config.CustomAPIKey) != "",
	}
	if len(models) > 0 {
		status.Model = models[0]
	}
	if !configured {
		status.Message = "AI is not configured"
	}
	return status, nil
}

func (s *DesktopAIService) GetUserAIConfig() (DesktopUserAIConfig, error) {
	config, err := s.loadConfig()
	if err != nil {
		return DesktopUserAIConfig{}, err
	}

	return DesktopUserAIConfig{
		UseSystemConfig: false,
		CustomEnabled:   config.CustomEnabled,
		CustomProvider:  sharedaiconfig.NormalizeProvider(config.CustomProvider),
		CustomEndpoint:  config.CustomEndpoint,
		CustomModels:    config.CustomModels,
		HasAPIKey:       strings.TrimSpace(config.CustomAPIKey) != "",
	}, nil
}

func (s *DesktopAIService) SaveUserAIConfig(input DesktopSaveUserAIConfigRequest) error {
	database, err := s.database()
	if err != nil {
		return err
	}

	current, err := s.loadConfig()
	if err != nil {
		return err
	}

	provider := sharedaiconfig.NormalizeProvider(input.CustomProvider)
	apiKey := strings.TrimSpace(input.CustomAPIKey)
	if apiKey == "" {
		apiKey = current.CustomAPIKey
	}

	models := strings.TrimSpace(input.CustomModels)
	if input.CustomEnabled && models == "" {
		return errors.New("AI models are required")
	}
	if input.CustomEnabled && strings.TrimSpace(apiKey) == "" {
		return errors.New("AI API key is required")
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, err = database.Exec(`
		INSERT INTO desktop_ai_config (id, use_system_config, custom_enabled, custom_provider, custom_endpoint, custom_api_key, custom_models, updated_at)
		VALUES ('local', 0, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			use_system_config = 0,
			custom_enabled = excluded.custom_enabled,
			custom_provider = excluded.custom_provider,
			custom_endpoint = excluded.custom_endpoint,
			custom_api_key = excluded.custom_api_key,
			custom_models = excluded.custom_models,
			updated_at = excluded.updated_at`,
		boolToInt(input.CustomEnabled), provider, strings.TrimSpace(input.CustomEndpoint), apiKey, models, now)
	return err
}

func (s *DesktopAIService) ProbeAIModels(input DesktopAIModelsProbeRequest) (DesktopAIModelsProbeResponse, error) {
	current, err := s.loadConfig()
	if err != nil {
		return DesktopAIModelsProbeResponse{}, err
	}

	provider := strings.TrimSpace(input.CustomProvider)
	apiKey := strings.TrimSpace(input.CustomAPIKey)
	endpoint := strings.TrimSpace(input.CustomEndpoint)
	if provider == "" {
		provider = current.CustomProvider
	}
	if apiKey == "" {
		apiKey = current.CustomAPIKey
	}
	if endpoint == "" {
		endpoint = current.CustomEndpoint
	}
	if provider == "" {
		provider = "openai"
	}

	requestContext, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	models, err := aiprovider.NewFactory().ListModels(requestContext, aiprovider.Config{
		Provider: provider,
		APIKey:   apiKey,
		Endpoint: endpoint,
	})
	if err != nil {
		return DesktopAIModelsProbeResponse{}, err
	}

	return DesktopAIModelsProbeResponse{
		Available: true,
		Models:    models,
		Message:   "Model list fetched successfully",
	}, nil
}

func (s *DesktopAIService) ListSessions(params DesktopAIListSessionsParams) (DesktopAIListSessionsResult, error) {
	database, err := s.database()
	if err != nil {
		return DesktopAIListSessionsResult{}, err
	}

	params = normalizeDesktopAIListParams(params)
	where, args := buildDesktopAIWhere(params)
	querySQL := fmt.Sprintf(`
		SELECT id, title, custom_title, model, permission_mode, scope_json, status, messages_json, tasks_json, created_at, updated_at
		FROM desktop_ai_sessions
		WHERE %s
		ORDER BY updated_at DESC, created_at DESC, id DESC`, where)

	rows, err := database.Query(querySQL, args...)
	if err != nil {
		return DesktopAIListSessionsResult{}, err
	}
	defer rows.Close()

	items := make([]DesktopAISessionListItem, 0)
	total := 0
	offset := (params.Page - 1) * params.Limit
	for rows.Next() {
		var id, title, model, permissionMode, scopeJSON, status, messagesJSON, tasksJSON, createdAt, updatedAt string
		var customTitle int
		if err := rows.Scan(&id, &title, &customTitle, &model, &permissionMode, &scopeJSON, &status, &messagesJSON, &tasksJSON, &createdAt, &updatedAt); err != nil {
			return DesktopAIListSessionsResult{}, err
		}
		if !desktopAIScopeMatches(decodeDesktopAIScope(scopeJSON), params) {
			continue
		}
		sessionStatus := s.activeDesktopAISessionStatus(id, DesktopAISessionStatus(status))
		total++
		if total <= offset {
			continue
		}
		if len(items) >= params.Limit {
			continue
		}
		messages := decodeDesktopAIMessages(messagesJSON)
		tasks := decodeDesktopAITasks(tasksJSON)
		items = append(items, DesktopAISessionListItem{
			ID:             id,
			Model:          model,
			PermissionMode: DesktopAIPermissionMode(permissionMode),
			Status:         sessionStatus,
			Title:          desktopAISessionTitle(title, customTitle == 1, messages),
			CustomTitle:    customTitle == 1,
			MessageCount:   len(messages),
			TaskCount:      len(tasks),
			CreatedAt:      createdAt,
			UpdatedAt:      updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return DesktopAIListSessionsResult{}, err
	}

	return DesktopAIListSessionsResult{Items: items, Total: total}, nil
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
	record, err := s.loadSession(strings.TrimSpace(id))
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
	config, err := s.loadConfig()
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}

	model := strings.TrimSpace(input.Model)
	if model == "" {
		models := sharedaiconfig.ParseModels(config.CustomModels)
		if len(models) > 0 {
			model = models[0]
		}
	}
	if model == "" {
		model = "default"
	}

	permissionMode := normalizeDesktopAIPermission(input.PermissionMode)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	record := desktopAISessionRecord{
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

	view := record.toView()
	return DesktopAICreateSessionResponse{
		SessionID:        view.ID,
		Session:          view,
		DefaultTransport: view.DefaultTransport,
	}, nil
}

func (s *DesktopAIService) SendMessage(ctx context.Context, input DesktopAISendMessageInput) (DesktopAICreateSessionResponse, error) {
	sessionID := strings.TrimSpace(input.SessionID)
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

	record, err := s.loadSession(sessionID)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	if desktopAIHasPendingConfirmation(record.Tasks) {
		return DesktopAICreateSessionResponse{}, errors.New("AI session has pending confirmations")
	}

	config, err := s.loadConfig()
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	model := strings.TrimSpace(input.Model)
	if model == "" {
		model = record.Model
	}
	if model == "" {
		models := sharedaiconfig.ParseModels(config.CustomModels)
		if len(models) > 0 {
			model = models[0]
		}
	}
	if model == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI model is required")
	}
	if strings.TrimSpace(config.CustomAPIKey) == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI API key is required")
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
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
		ID: newDesktopAIID("msg"), Role: "user", Content: content,
		Attachments: append([]DesktopAIImageAttachment(nil), input.Attachments...), CreatedAt: now,
	}
	record.Messages = append(record.Messages, userMessage)
	if record.Title == "" {
		record.Title = makeDesktopAITitle(content)
	}
	return s.completeDesktopAITurn(ctx, record, config, input.Context, model)
}

func (s *DesktopAIService) completeDesktopAITurn(ctx context.Context, record desktopAISessionRecord, config desktopAIConfigRecord, contextText string, model string) (DesktopAICreateSessionResponse, error) {
	sessionID := record.ID
	requestContext, requestID := s.beginAIRequest(ctx, sessionID)
	defer s.finishAIRequest(sessionID, requestID)
	return s.completeDesktopAITurnWithContext(requestContext, record, config, contextText, model)
}

func (s *DesktopAIService) completeDesktopAITurnWithContext(requestContext context.Context, record desktopAISessionRecord, config desktopAIConfigRecord, contextText string, model string) (DesktopAICreateSessionResponse, error) {
	sessionID := record.ID
	limits := aiprovider.DefaultLimits()
	turnContext, cancelTurn := context.WithTimeout(requestContext, limits.TurnTimeout)
	defer cancelTurn()

	if err := s.saveSession(record); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	s.emitAISessionSnapshot(record)

	for {
		assistantMessageID := newDesktopAIID("msg")
		assistantStartedAt := time.Now().UTC().Format(time.RFC3339Nano)
		var assistantContentBuilder strings.Builder
		var assistantReasoningBuilder strings.Builder
		turnResult, err := s.completeChat(turnContext, config, record, contextText, model, func(event aiprovider.Event) error {
			switch event.Type {
			case aiprovider.EventTextDelta:
				assistantContentBuilder.WriteString(event.Delta)
			case aiprovider.EventReasoningDelta:
				assistantReasoningBuilder.WriteString(event.Delta)
			default:
				return nil
			}
			assistantMessage := DesktopAIMessageView{
				ID: assistantMessageID, Role: "assistant", Content: assistantContentBuilder.String(),
				Reasoning: assistantReasoningBuilder.String(), CreatedAt: assistantStartedAt,
			}
			s.emitAISessionEvent(DesktopAISessionEvent{
				SessionID: sessionID,
				Type:      "message",
				UIMessage: desktopAIUIMessagePtr(assistantMessage, true),
			})
			return nil
		})
		completedAt := time.Now().UTC().Format(time.RFC3339Nano)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(turnContext.Err(), context.Canceled) {
				record.Status = DesktopAISessionIdle
				record.UpdatedAt = completedAt
				_ = s.saveSession(record)
				s.emitAISessionSnapshot(record)
				view := record.toView()
				return DesktopAICreateSessionResponse{
					SessionID:        view.ID,
					Session:          view,
					DefaultTransport: view.DefaultTransport,
				}, nil
			}
			if errors.Is(turnContext.Err(), context.DeadlineExceeded) {
				return s.failDesktopAITurn(record, errors.New("AI 对话总执行时间超出限制"))
			}
			return s.failDesktopAITurn(record, err)
		}
		if strings.TrimSpace(turnResult.Content) == "" && len(turnResult.ToolCalls) == 0 {
			return s.failDesktopAITurn(record, errors.New("AI provider returned no text"))
		}

		assistantMessage := DesktopAIMessageView{
			ID: assistantMessageID, Role: "assistant", Content: strings.TrimSpace(turnResult.Content),
			Reasoning: strings.TrimSpace(turnResult.Reasoning), Usage: desktopAIUsage(&turnResult.Usage),
			ProviderMetadata: desktopAIProviderMetadata(&turnResult.Metadata), CreatedAt: completedAt,
		}
		record.Messages = append(record.Messages, assistantMessage)
		record.UpdatedAt = completedAt

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

		tasks, autoTaskIDs, pendingConfirm := s.materializeDesktopAITasks(record, assistantMessageID, turnResult.ToolCalls)
		record.Tasks = append(record.Tasks, tasks...)
		record.Status = DesktopAISessionRunning
		if err := s.saveSession(record); err != nil {
			return DesktopAICreateSessionResponse{}, err
		}
		s.emitAISessionSnapshot(record)

		for _, taskID := range autoTaskIDs {
			var executeErr error
			record, executeErr = s.executeDesktopAITask(turnContext, record, taskID)
			if executeErr != nil {
				return DesktopAICreateSessionResponse{}, executeErr
			}
			if errors.Is(turnContext.Err(), context.DeadlineExceeded) {
				return s.failDesktopAITurn(record, errors.New("AI 对话总执行时间超出限制"))
			}
			if errors.Is(turnContext.Err(), context.Canceled) {
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
			record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
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
	record.Status = DesktopAISessionIdle
	record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	_ = s.saveSession(record)
	s.emitAISessionSnapshot(record)
	return DesktopAICreateSessionResponse{}, turnErr
}

func (s *DesktopAIService) ConfirmTask(ctx context.Context, input DesktopAIConfirmTaskInput) (DesktopAICreateSessionResponse, error) {
	sessionID := strings.TrimSpace(input.SessionID)
	taskID := strings.TrimSpace(input.TaskID)
	decision := strings.ToLower(strings.TrimSpace(input.Decision))
	if sessionID == "" || taskID == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI session id and task id are required")
	}
	if decision != "confirm" && decision != "reject" {
		return DesktopAICreateSessionResponse{}, errors.New("AI task decision must be confirm or reject")
	}

	s.sessionMu.Lock()
	record, err := s.loadSession(sessionID)
	if err != nil {
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, err
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

	now := time.Now().UTC().Format(time.RFC3339Nano)
	run := s.confirmedRuns[sessionID]
	if run == nil {
		turnContext, cancelTurn := context.WithTimeout(context.Background(), aiprovider.DefaultLimits().TurnTimeout)
		requestContext, requestID := s.beginAIRequest(turnContext, sessionID)
		run = &desktopAIConfirmedToolRun{
			Context:   requestContext,
			Cancel:    cancelTurn,
			RequestID: requestID,
		}
		s.confirmedRuns[sessionID] = run
	}

	taskName := record.Tasks[taskIndex].ToolName
	taskArguments := record.Tasks[taskIndex].Arguments
	if decision == "reject" {
		record.Tasks[taskIndex].Status = DesktopAITaskCancelled
		record.Tasks[taskIndex].Result = "用户已拒绝执行该操作。"
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
		run.Active--
		if run.Active == 0 {
			delete(s.confirmedRuns, sessionID)
			run.Cancel()
			s.finishAIRequest(sessionID, run.RequestID)
		}
		s.sessionMu.Unlock()
		return DesktopAICreateSessionResponse{}, err
	}
	view := record.toView()
	s.sessionMu.Unlock()

	s.emitAISessionSnapshot(record)
	go s.resolveDesktopConfirmedTask(sessionID, taskID, decision, taskName, taskArguments, run)

	return DesktopAICreateSessionResponse{
		SessionID:        view.ID,
		Session:          view,
		DefaultTransport: view.DefaultTransport,
	}, nil
}

func (s *DesktopAIService) resolveDesktopConfirmedTask(
	sessionID string,
	taskID string,
	decision string,
	toolName string,
	arguments map[string]any,
	run *desktopAIConfirmedToolRun,
) {
	var result desktopAIToolResult
	var executeErr error
	if decision == "confirm" && run.Context.Err() == nil {
		result, executeErr = s.executeDesktopAITool(run.Context, toolName, arguments)
	}

	s.sessionMu.Lock()
	record, loadErr := s.loadSession(sessionID)
	if loadErr != nil {
		s.finishDesktopConfirmedRunLocked(sessionID, run)
		s.sessionMu.Unlock()
		return
	}
	if s.confirmedRuns[sessionID] != run {
		s.sessionMu.Unlock()
		return
	}

	taskIndex := desktopAIFindTaskIndex(record.Tasks, taskID)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if taskIndex >= 0 && decision == "confirm" && record.Tasks[taskIndex].Status != DesktopAITaskCancelled {
		switch {
		case run.Context.Err() != nil:
			record.Tasks[taskIndex].Status = DesktopAITaskCancelled
			record.Tasks[taskIndex].Result = "操作已取消。"
			record.Tasks[taskIndex].Error = ""
		case executeErr != nil:
			record.Tasks[taskIndex].Status = DesktopAITaskFailed
			record.Tasks[taskIndex].Result = executeErr.Error()
			record.Tasks[taskIndex].Error = executeErr.Error()
		case result.IsError:
			record.Tasks[taskIndex].Status = DesktopAITaskFailed
			record.Tasks[taskIndex].Result = result.Content
			record.Tasks[taskIndex].Error = result.Content
		default:
			record.Tasks[taskIndex].Status = DesktopAITaskSucceeded
			record.Tasks[taskIndex].Result = result.Content
			record.Tasks[taskIndex].Error = ""
		}
		record.Tasks[taskIndex].UpdatedAt = now
	}

	if run.Active > 0 {
		run.Active--
	}
	pendingConfirmation := desktopAIHasPendingConfirmation(record.Tasks)
	if pendingConfirmation {
		record.Status = DesktopAISessionWaitingConfirmation
	} else {
		record.Status = DesktopAISessionRunning
	}
	record.UpdatedAt = now
	_ = s.saveSession(record)
	shouldContinue := run.Active == 0 && !pendingConfirmation && run.Context.Err() == nil
	shouldWait := run.Active == 0 && pendingConfirmation
	if run.Active == 0 {
		delete(s.confirmedRuns, sessionID)
	}
	s.sessionMu.Unlock()

	s.emitAISessionSnapshot(record)
	if shouldWait || run.Context.Err() != nil {
		run.Cancel()
		s.finishAIRequest(sessionID, run.RequestID)
		return
	}
	if !shouldContinue {
		return
	}

	defer run.Cancel()
	defer s.finishAIRequest(sessionID, run.RequestID)
	config, err := s.loadConfig()
	if err != nil {
		s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "error", Error: err.Error()})
		_, _ = s.failDesktopAITurn(record, err)
		return
	}
	model := strings.TrimSpace(record.Model)
	if model == "" {
		models := sharedaiconfig.ParseModels(config.CustomModels)
		if len(models) > 0 {
			model = models[0]
		}
	}
	if model == "" || strings.TrimSpace(config.CustomAPIKey) == "" {
		err = errors.New("AI model and API key are required")
		s.emitAISessionEvent(DesktopAISessionEvent{SessionID: sessionID, Type: "error", Error: err.Error()})
		_, _ = s.failDesktopAITurn(record, err)
		return
	}
	record.Model = model
	if _, err = s.completeDesktopAITurnWithContext(run.Context, record, config, "", model); err != nil {
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
	s.finishAIRequest(sessionID, run.RequestID)
}

func (s *DesktopAIService) cancelDesktopConfirmedRun(sessionID string) {
	s.sessionMu.Lock()
	run := s.confirmedRuns[sessionID]
	delete(s.confirmedRuns, sessionID)
	s.sessionMu.Unlock()
	if run == nil {
		return
	}
	run.Cancel()
	s.finishAIRequest(sessionID, run.RequestID)
}

func (s *DesktopAIService) CancelSession(id string) (map[string]bool, error) {
	id = strings.TrimSpace(id)
	cancelled := s.cancelAIRequest(id)
	s.cancelDesktopConfirmedRun(id)
	record, err := s.loadSession(id)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
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
	sessionID := strings.TrimSpace(input.SessionID)
	messageID := strings.TrimSpace(input.MessageID)
	content := strings.TrimSpace(input.Content)
	if sessionID == "" || messageID == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI session id and message id are required")
	}
	if content == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI message content is required")
	}

	record, err := s.loadSession(sessionID)
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
	record.Messages = truncateDesktopAIMessages(record.Messages, messageIndex+1)
	record.Tasks = truncateDesktopAITasks(record.Tasks, record.Messages)
	record.Status = DesktopAISessionIdle
	record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
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

func (s *DesktopAIService) RegenerateMessage(ctx context.Context, input DesktopAIRegenerateMessageInput) (DesktopAICreateSessionResponse, error) {
	sessionID := strings.TrimSpace(input.SessionID)
	messageID := strings.TrimSpace(input.MessageID)
	if sessionID == "" || messageID == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI session id and message id are required")
	}

	record, err := s.loadSession(sessionID)
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
		return DesktopAICreateSessionResponse{}, errors.New("AI message cannot be regenerated")
	}

	config, err := s.loadConfig()
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	model := strings.TrimSpace(input.Model)
	if model == "" {
		model = record.Model
	}
	if model == "" {
		models := sharedaiconfig.ParseModels(config.CustomModels)
		if len(models) > 0 {
			model = models[0]
		}
	}
	if model == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI model is required")
	}
	if strings.TrimSpace(config.CustomAPIKey) == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI API key is required")
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
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

	return s.completeDesktopAITurn(ctx, record, config, input.Context, model)
}

func (s *DesktopAIService) DeleteMessage(sessionID string, messageID string) (DesktopAICreateSessionResponse, error) {
	sessionID = strings.TrimSpace(sessionID)
	messageID = strings.TrimSpace(messageID)
	if sessionID == "" || messageID == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI session id and message id are required")
	}

	record, err := s.loadSession(sessionID)
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
		return DesktopAICreateSessionResponse{}, errors.New("AI message cannot be deleted")
	}

	record.Messages = truncateDesktopAIMessages(record.Messages, messageIndex)
	record.Tasks = truncateDesktopAITasks(record.Tasks, record.Messages)
	record.Status = DesktopAISessionIdle
	record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
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
	record, err := s.loadSession(strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, errors.New("AI session title is required")
	}
	record.Title = title
	record.CustomTitle = true
	record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.saveSession(record); err != nil {
		return nil, err
	}
	return map[string]bool{"updated": true}, nil
}

func (s *DesktopAIService) DeleteSession(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("AI session id is required")
	}
	s.cancelAIRequest(id)
	s.cancelDesktopConfirmedRun(id)
	database, err := s.database()
	if err != nil {
		return err
	}
	_, err = database.Exec("DELETE FROM desktop_ai_sessions WHERE id = ?", id)
	return err
}

func (s *DesktopAIService) CloseSession(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("AI session id is required")
	}

	s.cancelAIRequest(id)
	s.cancelDesktopConfirmedRun(id)
	record, err := s.loadSession(id)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
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

	if err := configureDesktopAIDatabase(database); err != nil {
		database.Close()
		return nil, err
	}

	s.db = database
	return s.db, nil
}

func (s *DesktopAIService) loadConfig() (desktopAIConfigRecord, error) {
	database, err := s.database()
	if err != nil {
		return desktopAIConfigRecord{}, err
	}

	var record desktopAIConfigRecord
	var useSystemConfig, customEnabled int
	err = database.QueryRow(`
		SELECT use_system_config, custom_enabled, custom_provider, custom_endpoint, custom_api_key, custom_models
		FROM desktop_ai_config
		WHERE id = 'local'`).Scan(
		&useSystemConfig,
		&customEnabled,
		&record.CustomProvider,
		&record.CustomEndpoint,
		&record.CustomAPIKey,
		&record.CustomModels,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return desktopAIConfigRecord{
			UseSystemConfig: false,
			CustomEnabled:   false,
			CustomProvider:  "openai",
			CustomEndpoint:  "https://api.openai.com/v1",
			CustomModels:    "",
		}, nil
	}
	if err != nil {
		return desktopAIConfigRecord{}, err
	}
	record.UseSystemConfig = useSystemConfig == 1
	record.CustomEnabled = customEnabled == 1
	record.CustomProvider = sharedaiconfig.NormalizeProvider(record.CustomProvider)
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

	var record desktopAISessionRecord
	var customTitle int
	var permissionMode, status, scopeJSON, messagesJSON, tasksJSON string
	err = database.QueryRow(`
		SELECT id, title, custom_title, model, permission_mode, scope_json, status, messages_json, tasks_json, created_at, updated_at
		FROM desktop_ai_sessions
		WHERE id = ?`, id).Scan(
		&record.ID,
		&record.Title,
		&customTitle,
		&record.Model,
		&permissionMode,
		&scopeJSON,
		&status,
		&messagesJSON,
		&tasksJSON,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return desktopAISessionRecord{}, err
	}
	record.CustomTitle = customTitle == 1
	record.PermissionMode = normalizeDesktopAIPermission(DesktopAIPermissionMode(permissionMode))
	record.Scope = decodeDesktopAIScope(scopeJSON)
	record.Status = s.activeDesktopAISessionStatus(record.ID, DesktopAISessionStatus(status))
	if record.Status == "" {
		record.Status = DesktopAISessionIdle
	}
	record.Messages = decodeDesktopAIMessages(messagesJSON)
	record.Tasks = decodeDesktopAITasks(tasksJSON)
	return record, nil
}

func (s *DesktopAIService) saveSession(record desktopAISessionRecord) error {
	database, err := s.database()
	if err != nil {
		return err
	}
	scopeJSON := mustDesktopAIJSON(record.Scope)
	messagesJSON := mustDesktopAIJSON(record.Messages)
	tasksJSON := mustDesktopAIJSON(record.Tasks)
	uiMessagesJSON := "[]"
	_, err = database.Exec(`
		INSERT INTO desktop_ai_sessions
			(id, title, custom_title, model, permission_mode, scope_json, status, messages_json, tasks_json, ui_messages_json, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			custom_title = excluded.custom_title,
			model = excluded.model,
			permission_mode = excluded.permission_mode,
			scope_json = excluded.scope_json,
			status = excluded.status,
			messages_json = excluded.messages_json,
			tasks_json = excluded.tasks_json,
			ui_messages_json = excluded.ui_messages_json,
			updated_at = excluded.updated_at`,
		record.ID,
		record.Title,
		boolToInt(record.CustomTitle),
		record.Model,
		record.PermissionMode,
		scopeJSON,
		record.Status,
		messagesJSON,
		tasksJSON,
		uiMessagesJSON,
		record.CreatedAt,
		record.UpdatedAt,
	)
	return err
}

func (s *DesktopAIService) beginAIRequest(parent context.Context, sessionID string) (context.Context, string) {
	requestContext, cancel := context.WithCancel(parent)
	requestID := newDesktopAIID("ai-request")

	s.mu.Lock()
	if s.activeRequests == nil {
		s.activeRequests = map[string]desktopAIActiveRequest{}
	}
	if previous, ok := s.activeRequests[sessionID]; ok {
		previous.Cancel()
	}
	s.activeRequests[sessionID] = desktopAIActiveRequest{ID: requestID, Cancel: cancel}
	s.mu.Unlock()

	return requestContext, requestID
}

func (s *DesktopAIService) finishAIRequest(sessionID string, requestID string) {
	s.mu.Lock()
	if active, ok := s.activeRequests[sessionID]; ok && active.ID == requestID {
		delete(s.activeRequests, sessionID)
	}
	s.mu.Unlock()
}

func (s *DesktopAIService) cancelAIRequest(sessionID string) bool {
	s.mu.Lock()
	active, ok := s.activeRequests[sessionID]
	if ok {
		delete(s.activeRequests, sessionID)
	}
	s.mu.Unlock()

	if !ok {
		return false
	}
	active.Cancel()
	return true
}

func (s *DesktopAIService) hasActiveAIRequest(sessionID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.activeRequests[sessionID]
	return ok
}

func (s *DesktopAIService) activeDesktopAISessionStatus(sessionID string, status DesktopAISessionStatus) DesktopAISessionStatus {
	if status == DesktopAISessionRunning && !s.hasActiveAIRequest(sessionID) {
		return DesktopAISessionIdle
	}
	if status == "" {
		return DesktopAISessionIdle
	}
	return status
}

func (s *DesktopAIService) completeChat(ctx context.Context, config desktopAIConfigRecord, record desktopAISessionRecord, contextText string, model string, onEvent func(aiprovider.Event) error) (aiprovider.TurnResult, error) {
	factory := aiprovider.NewFactory()
	result, err := factory.StreamTurn(ctx, aiprovider.Config{
		Provider: config.CustomProvider,
		APIKey:   strings.TrimSpace(config.CustomAPIKey),
		Endpoint: strings.TrimSpace(config.CustomEndpoint),
		Model:    model,
		Limits:   aiprovider.DefaultLimits(),
	}, aiprovider.TurnRequest{
		Model:    model,
		Messages: desktopAIProviderMessages(record, contextText),
		Tools:    desktopAIProviderToolSpecs(desktopAIVisibleToolSpecs(record.PermissionMode, record.Scope)),
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
	lastMessageID := ""
	if len(record.Messages) > 0 {
		lastMessageID = record.Messages[len(record.Messages)-1].ID
	}
	contextText = strings.TrimSpace(contextText)

	for _, message := range record.Messages {
		if message.Role != "user" && message.Role != "assistant" {
			continue
		}
		content := message.Content
		if message.ID == lastMessageID && message.Role == "user" && contextText != "" {
			content = content + "\n\n" + contextText
		}
		providerMessage := aiprovider.Message{
			Role: message.Role, Content: content,
			Attachments: desktopAIProviderAttachments(message.Attachments),
		}
		if message.Role == "assistant" {
			providerMessage.ToolCalls = desktopAIProviderToolCalls(record.Tasks, message.ID)
		}
		result = append(result, providerMessage)

		if message.Role == "assistant" {
			result = append(result, desktopAIToolResultMessages(record.Tasks, message.ID)...)
		}
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

func (s *DesktopAIService) materializeDesktopAITasks(record desktopAISessionRecord, assistantMessageID string, toolCalls []aiprovider.ToolCall) ([]DesktopAITaskView, []string, bool) {
	tasks := make([]DesktopAITaskView, 0, len(toolCalls))
	autoTaskIDs := make([]string, 0, len(toolCalls))
	pendingConfirm := false
	for _, toolCall := range toolCalls {
		toolCall = desktopAIScopeToolCall(record.Scope, toolCall)
		args := desktopAIDecodeArguments(toolCall.Arguments)
		spec, ok := desktopAIToolSpecByName(record.PermissionMode, record.Scope, toolCall.Name)
		now := time.Now().UTC().Format(time.RFC3339Nano)
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
		if !ok {
			task.Status = DesktopAITaskFailed
			task.Error = fmt.Sprintf("未知工具: %s", toolCall.Name)
			task.Result = task.Error
			tasks = append(tasks, task)
			continue
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
	taskIndex := desktopAIFindTaskIndex(record.Tasks, taskID)
	if taskIndex < 0 {
		return record, errors.New("AI task not found")
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
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
	record.Tasks[taskIndex].Arguments = desktopAIEnforceScopedArguments(record.Scope, spec, record.Tasks[taskIndex].Arguments)

	record.Tasks[taskIndex].Status = DesktopAITaskRunning
	record.Tasks[taskIndex].UpdatedAt = now
	record.Status = DesktopAISessionRunning
	record.UpdatedAt = now
	if err := s.saveSession(record); err != nil {
		return record, err
	}
	s.emitAISessionSnapshot(record)

	result, err := s.executeDesktopAITool(ctx, record.Tasks[taskIndex].ToolName, record.Tasks[taskIndex].Arguments)
	now = time.Now().UTC().Format(time.RFC3339Nano)
	if ctx.Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		cancelDesktopAIActiveTasks(&record, now)
		record.Status = DesktopAISessionIdle
	} else if err != nil {
		record.Tasks[taskIndex].Status = DesktopAITaskFailed
		record.Tasks[taskIndex].Error = err.Error()
		record.Tasks[taskIndex].Result = err.Error()
	} else if result.IsError {
		record.Tasks[taskIndex].Status = DesktopAITaskFailed
		record.Tasks[taskIndex].Error = result.Content
		record.Tasks[taskIndex].Result = result.Content
	} else {
		record.Tasks[taskIndex].Status = DesktopAITaskSucceeded
		record.Tasks[taskIndex].Result = result.Content
		record.Tasks[taskIndex].Error = ""
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
	result, err := s.serverService.List(DesktopServerListParams{Page: 1, Limit: 100})
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
			"status":         server.Status,
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
		"status":          server.Status,
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
	timeoutSeconds := desktopAIIntArg(args, "timeout", 30)
	if timeoutSeconds <= 0 {
		timeoutSeconds = 30
	}
	if timeoutSeconds > 300 {
		timeoutSeconds = 300
	}
	select {
	case <-ctx.Done():
		return desktopAIToolError("操作已取消"), nil
	default:
	}
	result, err := s.serverService.ExecuteCommandContext(ctx, DesktopServerCommandInput{
		ServerID:  serverID,
		Command:   command,
		TimeoutMs: timeoutSeconds * 1000,
	})
	if err != nil {
		return desktopAIToolError("执行命令失败: " + err.Error()), nil
	}
	output := result.Output
	if len([]rune(output)) > 12000 {
		runes := []rune(output)
		output = string(runes[:12000]) + "\n... (输出已截断)"
	}
	payload := map[string]any{
		"server_id":    result.ServerID,
		"command":      result.Command,
		"exit_code":    result.ExitCode,
		"duration_ms":  result.DurationMs,
		"started_at":   result.StartedAt,
		"completed_at": result.CompletedAt,
		"output":       output,
	}
	if result.ExitCode != 0 {
		failed := desktopAIToolJSON("命令执行失败", payload)
		failed.IsError = true
		return failed, nil
	}
	return desktopAIToolJSON("命令执行成功", payload), nil
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
	lines := strings.Split(content, "\n")
	truncated := false
	if len(lines) > maxLines {
		lines = lines[:maxLines]
		truncated = true
	}
	output := strings.Join(lines, "\n")
	if truncated {
		output += fmt.Sprintf("\n\n... (文件已截断，仅显示前 %d 行)", maxLines)
	}
	return desktopAIToolResult{Content: fmt.Sprintf("文件内容 (%s):\n```\n%s\n```", remotePath, output)}, nil
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
	info, err := s.sftpService.WriteFileContext(ctx, DesktopSFTPWriteFileInput{ServerID: serverID, Path: remotePath, Content: content})
	if err != nil {
		return desktopAIToolError("写入文件失败: " + err.Error()), nil
	}
	return desktopAIToolJSON("文件已写入", info), nil
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
		return desktopAIToolError("创建目录失败: " + err.Error()), nil
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
		return desktopAIToolError("删除失败: " + err.Error()), nil
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

func configureDesktopAIDatabase(database *sql.DB) error {
	database.SetMaxOpenConns(1)
	statements := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
		`CREATE TABLE IF NOT EXISTS desktop_ai_config (
			id TEXT PRIMARY KEY,
			use_system_config INTEGER NOT NULL DEFAULT 0,
			custom_enabled INTEGER NOT NULL DEFAULT 0,
			custom_provider TEXT NOT NULL DEFAULT 'openai',
			custom_endpoint TEXT NOT NULL DEFAULT '',
			custom_api_key TEXT NOT NULL DEFAULT '',
			custom_models TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS desktop_ai_sessions (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL DEFAULT '',
			custom_title INTEGER NOT NULL DEFAULT 0,
			model TEXT NOT NULL DEFAULT '',
			permission_mode TEXT NOT NULL DEFAULT 'balanced',
			scope_json TEXT NOT NULL DEFAULT '{}',
			status TEXT NOT NULL DEFAULT 'idle',
			messages_json TEXT NOT NULL DEFAULT '[]',
			tasks_json TEXT NOT NULL DEFAULT '[]',
			ui_messages_json TEXT NOT NULL DEFAULT '[]',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		"CREATE INDEX IF NOT EXISTS idx_desktop_ai_sessions_updated ON desktop_ai_sessions (updated_at DESC)",
		"CREATE INDEX IF NOT EXISTS idx_desktop_ai_sessions_scope ON desktop_ai_sessions (scope_json)",
	}
	for _, statement := range statements {
		if _, err := database.Exec(statement); err != nil {
			return err
		}
	}
	return database.Ping()
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
	params.Q = strings.TrimSpace(params.Q)
	params.ScopeKind = strings.TrimSpace(params.ScopeKind)
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
	clauses := []string{"1 = 1"}
	args := make([]any, 0)

	if params.Q != "" {
		like := "%" + strings.ToLower(params.Q) + "%"
		clauses = append(clauses, "(LOWER(title) LIKE ? OR LOWER(messages_json) LIKE ?)")
		args = append(args, like, like)
	}
	return strings.Join(clauses, " AND "), args
}

func desktopAIScopeMatches(scope *DesktopAISessionScope, params DesktopAIListSessionsParams) bool {
	params = normalizeDesktopAIListParams(params)
	if params.ScopeKind == "" && params.TerminalSessionID == "" && params.ServerID == "" {
		return true
	}
	scope = normalizeDesktopAISessionScope(scope)
	if scope == nil {
		return false
	}
	if params.ScopeKind != "" && scope.Kind != params.ScopeKind {
		return false
	}
	if params.TerminalSessionID != "" && scope.TerminalSessionID != params.TerminalSessionID {
		return false
	}
	if params.ServerID != "" && scope.ServerID != params.ServerID {
		return false
	}
	return true
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
	uiMessages := desktopAIUIMessages(record.Messages, record.Tasks)
	return DesktopAISessionView{
		ID:               record.ID,
		Model:            record.Model,
		PermissionMode:   normalizeDesktopAIPermission(record.PermissionMode),
		Scope:            record.Scope,
		Status:           record.Status,
		CreatedAt:        record.CreatedAt,
		UpdatedAt:        record.UpdatedAt,
		Messages:         record.Messages,
		Tasks:            record.Tasks,
		UIMessages:       uiMessages,
		AvailableTools:   desktopAIToolViews(desktopAIVisibleToolSpecs(record.PermissionMode, record.Scope)),
		DefaultTransport: "desktop_local",
	}
}

func desktopAIAllToolSpecs() []desktopAIToolSpec {
	return []desktopAIToolSpec{
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
					"timeout":   map[string]interface{}{"type": "integer", "description": "命令执行超时时间（秒），默认 30，最大 300", "default": 30},
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
			Description: "向服务器上的文件写入内容。如果文件存在会被覆盖。",
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

func desktopAIToolViews(tools []desktopAIToolSpec) []DesktopAIToolView {
	result := make([]DesktopAIToolView, 0, len(tools))
	for _, tool := range tools {
		result = append(result, DesktopAIToolView{
			Name:        tool.Name,
			DisplayName: tool.DisplayName,
			Description: tool.Description,
			Dangerous:   tool.Dangerous,
		})
	}
	return result
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
	app := application.Get()
	if app == nil || app.Event == nil {
		return
	}

	app.Event.Emit(desktopAISessionEvent, event)
}

func desktopAIUIMessages(messages []DesktopAIMessageView, tasks []DesktopAITaskView) []aichatui.UIMessage {
	return aichatui.BuildMessages(
		toAichatUIMessages(messages),
		toAichatUITasks(tasks),
	)
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
			ID: message.ID, Role: message.Role, Content: message.Content, Reasoning: message.Reasoning,
			Attachments: attachments, Usage: desktopAIUsageView(message.Usage),
			ProviderMetadata: desktopAIProviderMetadataView(message.ProviderMetadata), CreatedAt: parseDesktopAITime(message.CreatedAt),
		})
	}
	return result
}

func desktopAIUIMessagePtr(message DesktopAIMessageView, streaming bool) *aichatui.UIMessage {
	uiMessage, ok := aichatui.Message(aichatui.MessageView{
		ID: message.ID, Role: message.Role, Content: message.Content, Reasoning: message.Reasoning,
		Attachments: desktopAIAttachmentViews(message.Attachments), Usage: desktopAIUsageView(message.Usage),
		ProviderMetadata: desktopAIProviderMetadataView(message.ProviderMetadata), CreatedAt: parseDesktopAITime(message.CreatedAt),
	}, streaming)
	if !ok {
		return nil
	}
	return &uiMessage
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

func desktopAISessionTitle(title string, custom bool, messages []DesktopAIMessageView) string {
	if strings.TrimSpace(title) != "" {
		return strings.TrimSpace(title)
	}
	if custom {
		return "AI session"
	}
	for _, message := range messages {
		if message.Role == "user" && strings.TrimSpace(message.Content) != "" {
			return makeDesktopAITitle(message.Content)
		}
	}
	return "New session"
}

func defaultDesktopAISessionTitle(messages []DesktopAIMessageView) string {
	for _, message := range messages {
		if message.Role == "user" && strings.TrimSpace(message.Content) != "" {
			return makeDesktopAITitle(message.Content)
		}
	}
	return ""
}

func makeDesktopAITitle(content string) string {
	title := strings.Join(strings.Fields(content), " ")
	if len([]rune(title)) > 36 {
		runes := []rune(title)
		title = string(runes[:36])
	}
	if strings.TrimSpace(title) == "" {
		return "New session"
	}
	return title
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

func decodeDesktopAIMessages(value string) []DesktopAIMessageView {
	var result []DesktopAIMessageView
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return []DesktopAIMessageView{}
	}
	return result
}

func decodeDesktopAITasks(value string) []DesktopAITaskView {
	var result []DesktopAITaskView
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return []DesktopAITaskView{}
	}
	return result
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

func desktopAIRequiresConfirmation(permission DesktopAIPermissionMode, spec desktopAIToolSpec) bool {
	return normalizeDesktopAIPermission(permission) != DesktopAIPermissionPrivileged && spec.ConfirmStrategy == desktopAIConfirmUser
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
		if record.Tasks[index].Status != DesktopAITaskQueued && record.Tasks[index].Status != DesktopAITaskRunning {
			continue
		}
		record.Tasks[index].Status = DesktopAITaskCancelled
		record.Tasks[index].Result = "操作已取消。"
		record.Tasks[index].Error = ""
		record.Tasks[index].UpdatedAt = now
	}
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
