package provider

import (
	"context"
	"encoding/json"

	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/shared/aiprovider"
)

type Config = aiprovider.Config
type EventType = aiprovider.EventType
type Event = aiprovider.Event
type Attachment = aiprovider.Attachment
type Usage = aiprovider.Usage
type ProviderMetadata = aiprovider.ProviderMetadata
type ProviderError = aiprovider.ProviderError
type Limits = aiprovider.Limits

func DefaultLimits() Limits { return aiprovider.DefaultLimits() }

func NormalizeLimits(limits Limits) Limits { return aiprovider.NormalizeLimits(limits) }

func ValidateAttachments(attachments []Attachment) error {
	return aiprovider.ValidateAttachments(attachments)
}

const (
	EventTextDelta              EventType = aiprovider.EventTextDelta
	EventReasoningDelta         EventType = aiprovider.EventReasoningDelta
	EventToolCallStarted        EventType = aiprovider.EventToolCallStarted
	EventToolCallArgumentsDelta EventType = aiprovider.EventToolCallArgumentsDelta
	EventToolCallCompleted      EventType = aiprovider.EventToolCallCompleted
	EventUsageUpdated           EventType = aiprovider.EventUsageUpdated
	EventResponseCompleted      EventType = aiprovider.EventResponseCompleted
)

type Message struct {
	Role        string
	Content     string
	Attachments []aiprovider.Attachment
	ToolCalls   []registry.ToolCall
	ToolCallID  string
}

type Factory struct {
	inner *aiprovider.Factory
}

type TurnRequest struct {
	Messages []Message
	Model    string
	Tools    []registry.ToolSpec
}

type TurnResult struct {
	Content   string
	Reasoning string
	ToolCalls []registry.ToolCall
	Usage     aiprovider.Usage
	Metadata  aiprovider.ProviderMetadata
}

func NewFactory() *Factory {
	return &Factory{inner: aiprovider.NewFactory()}
}

func (f *Factory) StreamTurn(ctx context.Context, config Config, req TurnRequest, onEvent func(Event) error) (TurnResult, error) {
	if f == nil || f.inner == nil {
		f = NewFactory()
	}
	result, err := f.inner.StreamTurn(ctx, config, toSharedTurnRequest(req), onEvent)
	return fromSharedTurnResult(result), err
}

func toSharedTurnRequest(req TurnRequest) aiprovider.TurnRequest {
	return aiprovider.TurnRequest{
		Messages: toSharedMessages(req.Messages),
		Model:    req.Model,
		Tools:    toSharedToolSpecs(req.Tools),
	}
}

func toSharedMessages(messages []Message) []aiprovider.Message {
	if len(messages) == 0 {
		return nil
	}
	result := make([]aiprovider.Message, 0, len(messages))
	for _, message := range messages {
		result = append(result, aiprovider.Message{
			Role:        message.Role,
			Content:     message.Content,
			Attachments: append([]aiprovider.Attachment(nil), message.Attachments...),
			ToolCalls:   toSharedToolCalls(message.ToolCalls),
			ToolCallID:  message.ToolCallID,
		})
	}
	return result
}

func toSharedToolCalls(toolCalls []registry.ToolCall) []aiprovider.ToolCall {
	if len(toolCalls) == 0 {
		return nil
	}
	result := make([]aiprovider.ToolCall, 0, len(toolCalls))
	for _, toolCall := range toolCalls {
		result = append(result, aiprovider.ToolCall{
			ID:        toolCall.ID,
			Name:      toolCall.Name,
			Arguments: json.RawMessage(toolCall.Arguments),
		})
	}
	return result
}

func toSharedToolSpecs(tools []registry.ToolSpec) []aiprovider.ToolSpec {
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

func fromSharedTurnResult(result aiprovider.TurnResult) TurnResult {
	return TurnResult{
		Content:   result.Content,
		Reasoning: result.Reasoning,
		ToolCalls: fromSharedToolCalls(result.ToolCalls),
		Usage:     result.Usage,
		Metadata:  result.Metadata,
	}
}

func fromSharedToolCalls(toolCalls []aiprovider.ToolCall) []registry.ToolCall {
	if len(toolCalls) == 0 {
		return nil
	}
	result := make([]registry.ToolCall, 0, len(toolCalls))
	for _, toolCall := range toolCalls {
		result = append(result, registry.ToolCall{
			ID:        toolCall.ID,
			Name:      toolCall.Name,
			Arguments: json.RawMessage(toolCall.Arguments),
		})
	}
	return result
}
