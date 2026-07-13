package aiprovider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strings"

	"github.com/easyssh/shared/aiconfig"
	"github.com/liushuangls/go-anthropic/v2"
	openai "github.com/sashabaranov/go-openai"
)

type Config struct {
	Provider string
	APIKey   string
	Endpoint string
	Model    string
	Models   []string
}

type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type ToolSpec struct {
	Name        string                 `json:"name"`
	DisplayName string                 `json:"display_name,omitempty"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters"`
	Dangerous   bool                   `json:"dangerous"`
}

type Message struct {
	Role       string
	Content    string
	ToolCalls  []ToolCall
	ToolCallID string
}

type EventType string

const (
	EventTextDelta EventType = "text_delta"
)

type Event struct {
	Type  EventType
	Delta string
}

type TurnRequest struct {
	Messages []Message
	Model    string
	Tools    []ToolSpec
}

type TurnResult struct {
	Content   string
	ToolCalls []ToolCall
}

type Factory struct{}

func NewFactory() *Factory {
	return &Factory{}
}

var ErrModelListingUnsupported = errors.New("AI provider does not support automatic model listing")

func (f *Factory) ListModels(ctx context.Context, config Config) ([]string, error) {
	provider := aiconfig.NormalizeProvider(config.Provider)
	if provider == "anthropic" {
		return nil, ErrModelListingUnsupported
	}
	if !aiconfig.IsOpenAICompatibleProvider(provider) {
		return nil, errors.New("invalid AI provider")
	}
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, errors.New("AI API key is required")
	}

	response, err := createOpenAIClient(Config{
		Provider: provider,
		APIKey:   strings.TrimSpace(config.APIKey),
		Endpoint: strings.TrimSpace(config.Endpoint),
	}).ListModels(ctx)
	if err != nil {
		return nil, wrapOpenAIProviderError("failed to fetch AI models", err)
	}

	modelSet := make(map[string]struct{}, len(response.Models))
	for _, model := range response.Models {
		id := strings.TrimSpace(model.ID)
		if id != "" {
			modelSet[id] = struct{}{}
		}
	}

	models := make([]string, 0, len(modelSet))
	for model := range modelSet {
		models = append(models, model)
	}
	sort.Strings(models)
	return models, nil
}

func (f *Factory) StreamTurn(ctx context.Context, config Config, req TurnRequest, onEvent func(Event) error) (TurnResult, error) {
	if onEvent == nil {
		onEvent = func(Event) error { return nil }
	}

	provider := aiconfig.NormalizeProvider(config.Provider)
	config.Provider = provider

	switch {
	case aiconfig.IsOpenAICompatibleProvider(provider):
		return streamOpenAIWithTools(ctx, config, req, onEvent)
	case provider == "anthropic":
		return streamAnthropicWithTools(ctx, config, req, onEvent)
	default:
		return TurnResult{}, errors.New("invalid AI provider")
	}
}

func openAIEndpointHint(err error) error {
	if err == nil {
		return nil
	}

	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "404 page not found") || strings.Contains(lower, "invalid character 'p' after top-level value") {
		return errors.New("AI Endpoint 可能配置错误：请填写 OpenAI 兼容根地址（例如 https://api.openai.com/v1、http://localhost:11434/v1，或 Gemini 的 https://generativelanguage.googleapis.com/v1beta/openai），不要填写 EasySSH 的 /api/v1/ai/... 路径")
	}

	return nil
}

func wrapOpenAIProviderError(prefix string, err error) error {
	if err == nil {
		return nil
	}

	if hint := openAIEndpointHint(err); hint != nil {
		return errors.Join(errors.New(prefix), err, hint)
	}

	return errors.Join(errors.New(prefix), err)
}

func createOpenAIClient(config Config) *openai.Client {
	cfg := openai.DefaultConfig(config.APIKey)
	baseURL := aiconfig.NormalizeOpenAIBaseURL(config.Provider, config.Endpoint)
	if baseURL != "" {
		cfg.BaseURL = baseURL
	} else if aiconfig.NormalizeProvider(config.Provider) == "gemini" {
		cfg.BaseURL = "https://generativelanguage.googleapis.com/v1beta/openai"
	}
	return openai.NewClientWithConfig(cfg)
}

func convertToOpenAIMessages(messages []Message) []openai.ChatCompletionMessage {
	result := make([]openai.ChatCompletionMessage, 0, len(messages))

	for _, msg := range messages {
		oaiMsg := openai.ChatCompletionMessage{
			Role:    msg.Role,
			Content: msg.Content,
		}

		if msg.Role == "assistant" && len(msg.ToolCalls) > 0 {
			oaiMsg.ToolCalls = make([]openai.ToolCall, len(msg.ToolCalls))
			for i, tc := range msg.ToolCalls {
				oaiMsg.ToolCalls[i] = openai.ToolCall{
					ID:   tc.ID,
					Type: openai.ToolTypeFunction,
					Function: openai.FunctionCall{
						Name:      tc.Name,
						Arguments: string(tc.Arguments),
					},
				}
			}
		}

		if msg.Role == "tool" {
			oaiMsg.ToolCallID = msg.ToolCallID
		}

		result = append(result, oaiMsg)
	}

	return result
}

func getOpenAITools(tools []ToolSpec) []openai.Tool {
	result := make([]openai.Tool, len(tools))
	for i, tool := range tools {
		paramsJSON, _ := json.Marshal(tool.Parameters)
		result[i] = openai.Tool{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        tool.Name,
				Description: tool.Description,
				Parameters:  json.RawMessage(paramsJSON),
			},
		}
	}
	return result
}

func streamOpenAIWithTools(ctx context.Context, config Config, req TurnRequest, onEvent func(Event) error) (TurnResult, error) {
	client := createOpenAIClient(config)

	streamReq := openai.ChatCompletionRequest{
		Model:    req.Model,
		Messages: convertToOpenAIMessages(req.Messages),
	}
	if len(req.Tools) > 0 {
		streamReq.Tools = getOpenAITools(req.Tools)
	}

	stream, err := client.CreateChatCompletionStream(ctx, streamReq)
	if err != nil {
		return TurnResult{}, wrapOpenAIProviderError("failed to create OpenAI stream", err)
	}
	defer stream.Close()

	var contentBuilder strings.Builder
	toolCallsMap := make(map[int]*ToolCall)
	toolCallIDToIndex := make(map[string]int)
	nextToolCallIndex := 0

	buildToolCalls := func() []ToolCall {
		if len(toolCallsMap) == 0 {
			return nil
		}

		indexes := make([]int, 0, len(toolCallsMap))
		for idx := range toolCallsMap {
			indexes = append(indexes, idx)
		}
		sort.Ints(indexes)

		result := make([]ToolCall, 0, len(indexes))
		for _, idx := range indexes {
			result = append(result, *toolCallsMap[idx])
		}
		return result
	}

	for {
		response, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return TurnResult{
				Content:   contentBuilder.String(),
				ToolCalls: buildToolCalls(),
			}, nil
		}
		if err != nil {
			return TurnResult{}, wrapOpenAIProviderError("OpenAI stream error", err)
		}

		if len(response.Choices) == 0 {
			continue
		}

		choice := response.Choices[0]
		if choice.Delta.Content != "" {
			contentBuilder.WriteString(choice.Delta.Content)
			if err := onEvent(Event{Type: EventTextDelta, Delta: choice.Delta.Content}); err != nil {
				return TurnResult{}, err
			}
		}

		for _, tc := range choice.Delta.ToolCalls {
			idx := -1
			if tc.Index != nil {
				idx = *tc.Index
			} else if tc.ID != "" {
				if existingIdx, ok := toolCallIDToIndex[tc.ID]; ok {
					idx = existingIdx
				}
			}
			if idx < 0 {
				idx = nextToolCallIndex
				nextToolCallIndex++
			}
			if tc.ID != "" {
				toolCallIDToIndex[tc.ID] = idx
			}
			if idx >= nextToolCallIndex {
				nextToolCallIndex = idx + 1
			}

			if _, exists := toolCallsMap[idx]; !exists {
				toolCallsMap[idx] = &ToolCall{
					ID:        tc.ID,
					Name:      tc.Function.Name,
					Arguments: json.RawMessage(tc.Function.Arguments),
				}
				continue
			}

			existing := toolCallsMap[idx]
			if tc.ID != "" {
				existing.ID = tc.ID
			}
			if tc.Function.Name != "" {
				existing.Name = tc.Function.Name
			}
			if tc.Function.Arguments != "" {
				existing.Arguments = json.RawMessage(string(existing.Arguments) + tc.Function.Arguments)
			}
		}

		if choice.FinishReason == openai.FinishReasonToolCalls || choice.FinishReason == openai.FinishReasonStop {
			return TurnResult{
				Content:   contentBuilder.String(),
				ToolCalls: buildToolCalls(),
			}, nil
		}
	}
}

func createAnthropicClient(config Config) *anthropic.Client {
	opts := []anthropic.ClientOption{}
	if baseURL := aiconfig.NormalizeAnthropicBaseURL(config.Endpoint); baseURL != "" {
		opts = append(opts, anthropic.WithBaseURL(baseURL))
	}
	return anthropic.NewClient(config.APIKey, opts...)
}

func ConvertToAnthropicMessages(messages []Message) ([]anthropic.Message, string) {
	result := make([]anthropic.Message, 0, len(messages))
	var systemPrompt string

	for _, msg := range messages {
		if msg.Role == "system" {
			systemPrompt = msg.Content
			continue
		}

		if msg.Role == "tool" {
			result = append(result, anthropic.Message{
				Role: anthropic.RoleUser,
				Content: []anthropic.MessageContent{
					anthropic.NewToolResultMessageContent(msg.ToolCallID, msg.Content, false),
				},
			})
			continue
		}

		if msg.Role == "assistant" && len(msg.ToolCalls) > 0 {
			contents := make([]anthropic.MessageContent, 0, len(msg.ToolCalls)+1)
			if msg.Content != "" {
				contents = append(contents, anthropic.NewTextMessageContent(msg.Content))
			}
			for _, tc := range msg.ToolCalls {
				contents = append(contents, anthropic.NewToolUseMessageContent(tc.ID, tc.Name, tc.Arguments))
			}
			result = append(result, anthropic.Message{
				Role:    anthropic.ChatRole(msg.Role),
				Content: contents,
			})
			continue
		}

		result = append(result, anthropic.Message{
			Role: anthropic.ChatRole(msg.Role),
			Content: []anthropic.MessageContent{
				anthropic.NewTextMessageContent(msg.Content),
			},
		})
	}

	return result, systemPrompt
}

func getAnthropicTools(tools []ToolSpec) []anthropic.ToolDefinition {
	result := make([]anthropic.ToolDefinition, len(tools))
	for i, tool := range tools {
		result[i] = anthropic.ToolDefinition{
			Name:        tool.Name,
			Description: tool.Description,
			InputSchema: tool.Parameters,
		}
	}
	return result
}

func streamAnthropicWithTools(ctx context.Context, config Config, req TurnRequest, onEvent func(Event) error) (TurnResult, error) {
	client := createAnthropicClient(config)

	anthropicMessages, systemPrompt := ConvertToAnthropicMessages(req.Messages)

	var callbackErr error
	var toolCalls []ToolCall
	var currentToolCall *ToolCall
	var inputBuilder strings.Builder
	var contentBuilder strings.Builder

	streamReq := anthropic.MessagesStreamRequest{
		MessagesRequest: anthropic.MessagesRequest{
			Model:     anthropic.Model(req.Model),
			Messages:  anthropicMessages,
			MaxTokens: 4096,
			System:    systemPrompt,
		},
		OnContentBlockStart: func(data anthropic.MessagesEventContentBlockStartData) {
			if data.ContentBlock.Type == anthropic.MessagesContentTypeToolUse {
				currentToolCall = &ToolCall{
					ID:   data.ContentBlock.ID,
					Name: data.ContentBlock.Name,
				}
				inputBuilder.Reset()
			}
		},
		OnContentBlockDelta: func(data anthropic.MessagesEventContentBlockDeltaData) {
			if data.Delta.Text != nil {
				contentBuilder.WriteString(*data.Delta.Text)
				if err := onEvent(Event{Type: EventTextDelta, Delta: *data.Delta.Text}); err != nil {
					callbackErr = err
				}
			}
			if data.Delta.PartialJson != nil {
				inputBuilder.WriteString(*data.Delta.PartialJson)
			}
		},
		OnContentBlockStop: func(data anthropic.MessagesEventContentBlockStopData, content anthropic.MessageContent) {
			if currentToolCall == nil || currentToolCall.ID == "" {
				return
			}
			currentToolCall.Arguments = json.RawMessage(inputBuilder.String())
			toolCalls = append(toolCalls, *currentToolCall)
			currentToolCall = nil
		},
	}

	if len(req.Tools) > 0 {
		streamReq.MessagesRequest.Tools = getAnthropicTools(req.Tools)
	}

	_, err := client.CreateMessagesStream(ctx, streamReq)
	if err != nil {
		return TurnResult{}, errors.Join(errors.New("Anthropic stream error"), err)
	}

	if callbackErr != nil {
		return TurnResult{}, callbackErr
	}

	return TurnResult{
		Content:   contentBuilder.String(),
		ToolCalls: toolCalls,
	}, nil
}
