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
	DesktopAISessionIdle    DesktopAISessionStatus = "idle"
	DesktopAISessionRunning DesktopAISessionStatus = "running"
	DesktopAISessionClosed  DesktopAISessionStatus = "closed"
)

const desktopAISessionEvent = "easyssh:desktop-ai:session-event"

type DesktopAITaskStatus string

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

type DesktopAIMessageView struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
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
	SessionID      string                  `json:"session_id"`
	Content        string                  `json:"content"`
	Context        string                  `json:"context,omitempty"`
	Model          string                  `json:"model,omitempty"`
	PermissionMode DesktopAIPermissionMode `json:"permission_mode,omitempty"`
	Scope          *DesktopAISessionScope  `json:"scope,omitempty"`
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

type DesktopAIService struct {
	mu             sync.Mutex
	db             *sql.DB
	activeRequests map[string]desktopAIActiveRequest
}

func NewDesktopAIService() *DesktopAIService {
	return &DesktopAIService{activeRequests: map[string]desktopAIActiveRequest{}}
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
	var database *sql.DB

	s.mu.Lock()
	for _, active := range s.activeRequests {
		cancels = append(cancels, active.Cancel)
	}
	s.activeRequests = map[string]desktopAIActiveRequest{}
	database = s.db
	s.db = nil
	s.mu.Unlock()

	for _, cancel := range cancels {
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
	if content == "" {
		return DesktopAICreateSessionResponse{}, errors.New("AI message content is required")
	}

	record, err := s.loadSession(sessionID)
	if err != nil {
		return DesktopAICreateSessionResponse{}, err
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
		ID:        newDesktopAIID("msg"),
		Role:      "user",
		Content:   content,
		CreatedAt: now,
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

	if err := s.saveSession(record); err != nil {
		return DesktopAICreateSessionResponse{}, err
	}
	s.emitAISessionSnapshot(record)

	assistantMessageID := newDesktopAIID("msg")
	assistantStartedAt := time.Now().UTC().Format(time.RFC3339Nano)
	var assistantContentBuilder strings.Builder
	assistantContent, err := s.completeChat(requestContext, config, record.Messages, contextText, model, record.PermissionMode, func(delta string) error {
		if delta == "" {
			return nil
		}

		assistantContentBuilder.WriteString(delta)
		assistantMessage := DesktopAIMessageView{
			ID:        assistantMessageID,
			Role:      "assistant",
			Content:   assistantContentBuilder.String(),
			CreatedAt: assistantStartedAt,
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
		record.Status = DesktopAISessionIdle
		record.UpdatedAt = completedAt
		_ = s.saveSession(record)
		s.emitAISessionSnapshot(record)
		if errors.Is(err, context.Canceled) || errors.Is(requestContext.Err(), context.Canceled) {
			view := record.toView()
			return DesktopAICreateSessionResponse{
				SessionID:        view.ID,
				Session:          view,
				DefaultTransport: view.DefaultTransport,
			}, nil
		}
		return DesktopAICreateSessionResponse{}, err
	}

	assistantMessage := DesktopAIMessageView{
		ID:        assistantMessageID,
		Role:      "assistant",
		Content:   strings.TrimSpace(assistantContent),
		CreatedAt: completedAt,
	}
	record.Messages = append(record.Messages, assistantMessage)
	record.Status = DesktopAISessionIdle
	record.UpdatedAt = completedAt
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

func (s *DesktopAIService) CancelSession(id string) (map[string]bool, error) {
	id = strings.TrimSpace(id)
	cancelled := s.cancelAIRequest(id)
	record, err := s.loadSession(id)
	if err != nil {
		return nil, err
	}
	record.Status = DesktopAISessionIdle
	record.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := s.saveSession(record); err != nil {
		return nil, err
	}
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
	database, err := s.database()
	if err != nil {
		return err
	}
	_, err = database.Exec("DELETE FROM desktop_ai_sessions WHERE id = ?", id)
	return err
}

func (s *DesktopAIService) CloseSession(id string) error {
	return s.DeleteSession(id)
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
	uiMessagesJSON := mustDesktopAIJSON(desktopAIUIMessages(record.Messages, record.Tasks))
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

func (s *DesktopAIService) completeChat(ctx context.Context, config desktopAIConfigRecord, messages []DesktopAIMessageView, contextText string, model string, permission DesktopAIPermissionMode, onDelta func(string) error) (string, error) {
	factory := aiprovider.NewFactory()
	result, err := factory.StreamTurn(ctx, aiprovider.Config{
		Provider: config.CustomProvider,
		APIKey:   strings.TrimSpace(config.CustomAPIKey),
		Endpoint: strings.TrimSpace(config.CustomEndpoint),
		Model:    model,
	}, aiprovider.TurnRequest{
		Model:    model,
		Messages: desktopAIProviderMessages(messages, contextText, permission),
	}, func(event aiprovider.Event) error {
		if event.Type == aiprovider.EventTextDelta && onDelta != nil {
			return onDelta(event.Delta)
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(result.Content) == "" {
		return "", errors.New("AI provider returned no text")
	}
	return result.Content, nil
}

func desktopAIProviderMessages(messages []DesktopAIMessageView, contextText string, permission DesktopAIPermissionMode) []aiprovider.Message {
	result := []aiprovider.Message{{
		Role:    "system",
		Content: desktopAISystemPrompt(permission),
	}}
	lastMessageID := ""
	if len(messages) > 0 {
		lastMessageID = messages[len(messages)-1].ID
	}
	contextText = strings.TrimSpace(contextText)

	for _, message := range messages {
		if message.Role != "user" && message.Role != "assistant" {
			continue
		}
		content := message.Content
		if message.ID == lastMessageID && message.Role == "user" && contextText != "" {
			content = content + "\n\n" + contextText
		}
		result = append(result, aiprovider.Message{
			Role:    message.Role,
			Content: content,
		})
	}

	return result
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
		AvailableTools:   []DesktopAIToolView{},
		DefaultTransport: "desktop_local",
	}
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
		result = append(result, aichatui.MessageView{
			ID:        message.ID,
			Role:      message.Role,
			Content:   message.Content,
			CreatedAt: parseDesktopAITime(message.CreatedAt),
		})
	}
	return result
}

func desktopAIUIMessagePtr(message DesktopAIMessageView, streaming bool) *aichatui.UIMessage {
	uiMessage, ok := aichatui.Message(aichatui.MessageView{
		ID:        message.ID,
		Role:      message.Role,
		Content:   message.Content,
		CreatedAt: parseDesktopAITime(message.CreatedAt),
	}, streaming)
	if !ok {
		return nil
	}
	return &uiMessage
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
