package aiprovider

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	anthropicoption "github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/param"
)

func streamAnthropic(ctx context.Context, config Config, req TurnRequest, onEvent func(Event) error) (TurnResult, error) {
	client := newAnthropicClient(config)
	modelInfo, err := client.Models.Get(ctx, req.Model, anthropic.ModelGetParams{})
	if err != nil {
		return TurnResult{}, wrapAnthropicError(err)
	}
	messages, system, err := anthropicMessages(req.Messages)
	if err != nil {
		return TurnResult{}, err
	}
	params := anthropic.MessageNewParams{
		Model:     anthropic.Model(req.Model),
		MaxTokens: modelInfo.MaxTokens,
		Messages:  messages,
		System:    system,
	}
	if len(req.Tools) > 0 {
		params.Tools, err = anthropicTools(req.Tools)
		if err != nil {
			return TurnResult{}, err
		}
	}

	var rawResponse *http.Response
	stream := client.Messages.NewStreaming(ctx, params, anthropicoption.WithResponseInto(&rawResponse))
	defer stream.Close()

	var accumulated anthropic.Message
	var contentBuilder strings.Builder
	var reasoningBuilder strings.Builder
	for stream.Next() {
		event := stream.Current()
		if err := accumulated.Accumulate(event); err != nil {
			return TurnResult{}, &ProviderError{Code: "invalid_stream", Message: err.Error(), Provider: "anthropic", Retryable: false, Cause: err}
		}
		switch event.Type {
		case "content_block_start":
			if event.ContentBlock.Type == "tool_use" {
				call := ToolCall{ID: event.ContentBlock.ID, Name: event.ContentBlock.Name}
				if err := onEvent(Event{Type: EventToolCallStarted, ToolCall: &call, OutputIndex: event.Index}); err != nil {
					return TurnResult{}, err
				}
			}
		case "content_block_delta":
			switch event.Delta.Type {
			case "text_delta":
				contentBuilder.WriteString(event.Delta.Text)
				if err := onEvent(Event{Type: EventTextDelta, Delta: event.Delta.Text, OutputIndex: event.Index}); err != nil {
					return TurnResult{}, err
				}
			case "thinking_delta":
				reasoningBuilder.WriteString(event.Delta.Thinking)
				if err := onEvent(Event{Type: EventReasoningDelta, Delta: event.Delta.Thinking, OutputIndex: event.Index}); err != nil {
					return TurnResult{}, err
				}
			case "input_json_delta":
				if err := onEvent(Event{Type: EventToolCallArgumentsDelta, Delta: event.Delta.PartialJSON, OutputIndex: event.Index}); err != nil {
					return TurnResult{}, err
				}
			}
		}
	}
	if err := stream.Err(); err != nil {
		return TurnResult{}, wrapAnthropicError(err)
	}

	toolCalls := make([]ToolCall, 0)
	for index, block := range accumulated.Content {
		if block.Type != "tool_use" {
			continue
		}
		call := ToolCall{ID: block.ID, Name: block.Name, Arguments: json.RawMessage(block.Input)}
		toolCalls = append(toolCalls, call)
		callCopy := call
		if err := onEvent(Event{Type: EventToolCallCompleted, ToolCall: &callCopy, OutputIndex: int64(index)}); err != nil {
			return TurnResult{}, err
		}
	}

	usage := Usage{
		InputTokens: accumulated.Usage.InputTokens, OutputTokens: accumulated.Usage.OutputTokens,
		CachedTokens: accumulated.Usage.CacheReadInputTokens, CacheWriteTokens: accumulated.Usage.CacheCreationInputTokens,
		ReasoningTokens: accumulated.Usage.OutputTokensDetails.ThinkingTokens,
		TotalTokens:     accumulated.Usage.InputTokens + accumulated.Usage.OutputTokens,
	}
	metadata := ProviderMetadata{
		Provider: "anthropic", API: "messages", Endpoint: providerEndpoint(config), ResponseID: accumulated.ID,
		Model: string(accumulated.Model), FinishReason: string(accumulated.StopReason), ServiceTier: string(accumulated.Usage.ServiceTier),
	}
	metadata.RequestID = responseRequestID(rawResponse)
	if err := onEvent(Event{Type: EventUsageUpdated, Usage: &usage}); err != nil {
		return TurnResult{}, err
	}
	metadataCopy := metadata
	if err := onEvent(Event{Type: EventResponseCompleted, Usage: &usage, Metadata: &metadataCopy}); err != nil {
		return TurnResult{}, err
	}
	return TurnResult{Content: contentBuilder.String(), Reasoning: reasoningBuilder.String(), ToolCalls: toolCalls, Usage: usage, Metadata: metadata}, nil
}

func anthropicMessages(messages []Message) ([]anthropic.MessageParam, []anthropic.TextBlockParam, error) {
	result := make([]anthropic.MessageParam, 0, len(messages))
	var system []anthropic.TextBlockParam
	for _, message := range messages {
		switch message.Role {
		case "system":
			system = append(system, anthropic.TextBlockParam{Text: message.Content})
		case "user":
			blocks := make([]anthropic.ContentBlockParamUnion, 0, len(message.Attachments)+1)
			if strings.TrimSpace(message.Content) != "" {
				blocks = append(blocks, anthropic.NewTextBlock(message.Content))
			}
			for _, attachment := range message.Attachments {
				blocks = append(blocks, anthropic.NewImageBlockBase64(attachment.MediaType, attachment.Data))
			}
			result = append(result, anthropic.NewUserMessage(blocks...))
		case "assistant":
			blocks := make([]anthropic.ContentBlockParamUnion, 0, len(message.ToolCalls)+1)
			if strings.TrimSpace(message.Content) != "" {
				blocks = append(blocks, anthropic.NewTextBlock(message.Content))
			}
			for _, call := range message.ToolCalls {
				var input any
				if err := json.Unmarshal(call.Arguments, &input); err != nil {
					return nil, nil, &ProviderError{Code: "invalid_tool_arguments", Message: err.Error(), Provider: "anthropic", Retryable: false, Cause: err}
				}
				blocks = append(blocks, anthropic.NewToolUseBlock(call.ID, input, call.Name))
			}
			result = append(result, anthropic.NewAssistantMessage(blocks...))
		case "tool":
			result = append(result, anthropic.NewUserMessage(anthropic.NewToolResultBlock(message.ToolCallID, message.Content, false)))
		}
	}
	return result, system, nil
}

func anthropicTools(tools []ToolSpec) ([]anthropic.ToolUnionParam, error) {
	result := make([]anthropic.ToolUnionParam, 0, len(tools))
	for _, tool := range tools {
		raw, err := json.Marshal(tool.Parameters)
		if err != nil {
			return nil, err
		}
		var schema anthropic.ToolInputSchemaParam
		if err := json.Unmarshal(raw, &schema); err != nil {
			return nil, err
		}
		result = append(result, anthropic.ToolUnionParam{OfTool: &anthropic.ToolParam{
			Name: tool.Name, Description: param.NewOpt(tool.Description), InputSchema: schema,
		}})
	}
	return result, nil
}
