package aiprovider

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	openaioption "github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/responses"
	"github.com/openai/openai-go/v3/shared"
)

func streamOpenAIResponses(ctx context.Context, config Config, req TurnRequest, onEvent func(Event) error) (TurnResult, error) {
	client := newOpenAIClient(config)
	params := responses.ResponseNewParams{
		Model:             shared.ResponsesModel(req.Model),
		Input:             responses.ResponseNewParamsInputUnion{OfInputItemList: openAIResponseItems(req.Messages)},
		ParallelToolCalls: param.NewOpt(true),
		Store:             param.NewOpt(false),
	}
	if len(req.Tools) > 0 {
		params.Tools = openAIResponseTools(req.Tools)
	}

	var rawResponse *http.Response
	stream := client.Responses.NewStreaming(ctx, params, openaioption.WithResponseInto(&rawResponse))
	defer stream.Close()

	var contentBuilder strings.Builder
	var reasoningBuilder strings.Builder
	var usage Usage
	metadata := ProviderMetadata{Provider: "openai-response", API: "responses", Endpoint: providerEndpoint(config), Model: req.Model}
	metadata.RequestID = responseRequestID(rawResponse)
	toolCalls := make([]ToolCall, 0)
	seenCalls := make(map[string]bool)

	for stream.Next() {
		event := stream.Current()
		switch event.Type {
		case "response.created", "response.in_progress":
			if event.Response.ID != "" {
				metadata.ResponseID = event.Response.ID
			}
		case "response.output_text.delta":
			contentBuilder.WriteString(event.Delta)
			if err := onEvent(Event{Type: EventTextDelta, Delta: event.Delta, ItemID: event.ItemID, OutputIndex: event.OutputIndex}); err != nil {
				return TurnResult{}, err
			}
		case "response.reasoning_summary_text.delta", "response.reasoning_text.delta":
			reasoningBuilder.WriteString(event.Delta)
			if err := onEvent(Event{Type: EventReasoningDelta, Delta: event.Delta, ItemID: event.ItemID, OutputIndex: event.OutputIndex}); err != nil {
				return TurnResult{}, err
			}
		case "response.output_item.added":
			if event.Item.Type == "function_call" {
				call := ToolCall{ID: event.Item.CallID, Name: event.Item.Name}
				if err := onEvent(Event{Type: EventToolCallStarted, ToolCall: &call, ItemID: event.Item.ID, OutputIndex: event.OutputIndex}); err != nil {
					return TurnResult{}, err
				}
			}
		case "response.function_call_arguments.delta":
			call := ToolCall{ID: event.ItemID, Arguments: json.RawMessage(event.Delta)}
			if err := onEvent(Event{Type: EventToolCallArgumentsDelta, Delta: event.Delta, ToolCall: &call, ItemID: event.ItemID, OutputIndex: event.OutputIndex}); err != nil {
				return TurnResult{}, err
			}
		case "response.output_item.done":
			if event.Item.Type == "function_call" && !seenCalls[event.Item.CallID] {
				call := ToolCall{
					ID:        event.Item.CallID,
					Name:      event.Item.Name,
					Arguments: json.RawMessage(event.Item.Arguments.OfString),
				}
				seenCalls[call.ID] = true
				toolCalls = append(toolCalls, call)
				callCopy := call
				if err := onEvent(Event{Type: EventToolCallCompleted, ToolCall: &callCopy, ItemID: event.Item.ID, OutputIndex: event.OutputIndex}); err != nil {
					return TurnResult{}, err
				}
			}
		case "response.completed":
			metadata.ResponseID = event.Response.ID
			metadata.Model = string(event.Response.Model)
			metadata.FinishReason = string(event.Response.Status)
			metadata.ServiceTier = string(event.Response.ServiceTier)
			usage = openAIResponseUsage(event.Response.Usage)
			usageCopy := usage
			if err := onEvent(Event{Type: EventUsageUpdated, Usage: &usageCopy}); err != nil {
				return TurnResult{}, err
			}
		case "response.incomplete":
			metadata.ResponseID = event.Response.ID
			metadata.Model = string(event.Response.Model)
			metadata.FinishReason = firstNonEmpty(event.Response.IncompleteDetails.Reason, string(event.Response.Status), "incomplete")
			metadata.ServiceTier = string(event.Response.ServiceTier)
			usage = openAIResponseUsage(event.Response.Usage)
			usageCopy := usage
			if err := onEvent(Event{Type: EventUsageUpdated, Usage: &usageCopy}); err != nil {
				return TurnResult{}, err
			}
		case "response.failed":
			code := firstNonEmpty(string(event.Response.Error.Code), event.Code, "response_failed")
			message := firstNonEmpty(event.Response.Error.Message, event.Message, "OpenAI Responses API 响应失败")
			return TurnResult{}, &ProviderError{
				Code: code, Message: message, Provider: "openai-response", RequestID: metadata.RequestID,
				Retryable: code == "server_error" || code == "rate_limit_exceeded",
			}
		case "error":
			message := strings.TrimSpace(event.Message)
			if message == "" {
				message = "OpenAI Responses API 响应失败"
			}
			return TurnResult{}, &ProviderError{
				Code: firstNonEmpty(event.Code, "response_error"), Message: message,
				Provider: "openai-response", RequestID: metadata.RequestID, Retryable: false,
			}
		}
	}
	if err := stream.Err(); err != nil {
		return TurnResult{}, wrapOpenAIError("openai-response", err)
	}

	metadataCopy := metadata
	if err := onEvent(Event{Type: EventResponseCompleted, Usage: &usage, Metadata: &metadataCopy}); err != nil {
		return TurnResult{}, err
	}
	return TurnResult{
		Content: contentBuilder.String(), Reasoning: reasoningBuilder.String(), ToolCalls: toolCalls, Usage: usage, Metadata: metadata,
	}, nil
}

func openAIResponseItems(messages []Message) responses.ResponseInputParam {
	items := make(responses.ResponseInputParam, 0, len(messages))
	for _, message := range messages {
		switch message.Role {
		case "system", "user", "assistant":
			if strings.TrimSpace(message.Content) != "" || len(message.Attachments) > 0 {
				content := responses.EasyInputMessageContentUnionParam{OfString: param.NewOpt(message.Content)}
				if len(message.Attachments) > 0 {
					parts := make(responses.ResponseInputMessageContentListParam, 0, len(message.Attachments)+1)
					if message.Content != "" {
						parts = append(parts, responses.ResponseInputContentUnionParam{OfInputText: &responses.ResponseInputTextParam{Text: message.Content}})
					}
					for _, attachment := range message.Attachments {
						parts = append(parts, responses.ResponseInputContentUnionParam{OfInputImage: &responses.ResponseInputImageParam{
							Detail:   responses.ResponseInputImageDetailAuto,
							ImageURL: param.NewOpt(attachment.DataURL()),
						}})
					}
					content = responses.EasyInputMessageContentUnionParam{OfInputItemContentList: parts}
				}
				items = append(items, responses.ResponseInputItemUnionParam{OfMessage: &responses.EasyInputMessageParam{
					Role: responses.EasyInputMessageRole(message.Role), Content: content,
				}})
			}
			if message.Role == "assistant" {
				for _, call := range message.ToolCalls {
					items = append(items, responses.ResponseInputItemUnionParam{OfFunctionCall: &responses.ResponseFunctionToolCallParam{
						CallID: call.ID, Name: call.Name, Arguments: string(call.Arguments),
					}})
				}
			}
		case "tool":
			items = append(items, responses.ResponseInputItemUnionParam{OfFunctionCallOutput: &responses.ResponseInputItemFunctionCallOutputParam{
				CallID: message.ToolCallID,
				Output: responses.ResponseInputItemFunctionCallOutputOutputUnionParam{OfString: param.NewOpt(message.Content)},
			}})
		}
	}
	return items
}

func openAIResponseTools(tools []ToolSpec) []responses.ToolUnionParam {
	result := make([]responses.ToolUnionParam, 0, len(tools))
	for _, tool := range tools {
		result = append(result, responses.ToolUnionParam{OfFunction: &responses.FunctionToolParam{
			Name: tool.Name, Description: param.NewOpt(tool.Description), Parameters: tool.Parameters, Strict: param.NewOpt(false),
		}})
	}
	return result
}

func openAIResponseUsage(value responses.ResponseUsage) Usage {
	return Usage{
		InputTokens: value.InputTokens, OutputTokens: value.OutputTokens,
		CachedTokens: value.InputTokensDetails.CachedTokens, CacheWriteTokens: value.InputTokensDetails.CacheWriteTokens,
		ReasoningTokens: value.OutputTokensDetails.ReasoningTokens, TotalTokens: value.TotalTokens,
	}
}
