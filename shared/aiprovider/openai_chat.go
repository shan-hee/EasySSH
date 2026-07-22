package aiprovider

import (
	"context"
	"net/http"
	"sort"
	"strings"

	"github.com/easyssh/shared/aiconfig"
	"github.com/openai/openai-go/v3"
	openaioption "github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/shared"
)

func streamOpenAIChat(ctx context.Context, config Config, req TurnRequest, onEvent func(Event) error) (TurnResult, error) {
	client := newOpenAIClient(config)
	params := openai.ChatCompletionNewParams{
		Model:             shared.ChatModel(req.Model),
		Messages:          openAIChatMessages(req.Messages),
		ParallelToolCalls: param.NewOpt(true),
		StreamOptions: openai.ChatCompletionStreamOptionsParam{
			IncludeUsage: param.NewOpt(true),
		},
	}
	if len(req.Tools) > 0 {
		params.Tools = openAIChatTools(req.Tools)
	}

	var rawResponse *http.Response
	stream := client.Chat.Completions.NewStreaming(ctx, params, openaioption.WithResponseInto(&rawResponse))
	defer stream.Close()

	var contentBuilder strings.Builder
	toolCalls := make(map[int64]*ToolCall)
	toolCallIndexes := make(map[string]int64)
	var nextToolCallIndex int64
	var lastToolCallIndex int64 = -1
	var usage Usage
	metadata := ProviderMetadata{
		Provider: aiconfig.NormalizeProvider(config.Provider),
		API:      "chat_completions",
		Endpoint: providerEndpoint(config),
		Model:    req.Model,
	}
	metadata.RequestID = responseRequestID(rawResponse)

	for stream.Next() {
		chunk := stream.Current()
		if chunk.ID != "" {
			metadata.ResponseID = chunk.ID
		}
		if chunk.Model != "" {
			metadata.Model = chunk.Model
		}
		if chunk.JSON.Usage.Valid() {
			usage = Usage{
				InputTokens:      chunk.Usage.PromptTokens,
				OutputTokens:     chunk.Usage.CompletionTokens,
				CachedTokens:     chunk.Usage.PromptTokensDetails.CachedTokens,
				CacheWriteTokens: chunk.Usage.PromptTokensDetails.CacheWriteTokens,
				ReasoningTokens:  chunk.Usage.CompletionTokensDetails.ReasoningTokens,
				TotalTokens:      chunk.Usage.TotalTokens,
			}
			usageCopy := usage
			if err := onEvent(Event{Type: EventUsageUpdated, Usage: &usageCopy}); err != nil {
				return TurnResult{}, err
			}
		}

		for _, choice := range chunk.Choices {
			if choice.FinishReason != "" {
				metadata.FinishReason = choice.FinishReason
			}
			if choice.Delta.Content != "" {
				contentBuilder.WriteString(choice.Delta.Content)
				if err := onEvent(Event{Type: EventTextDelta, Delta: choice.Delta.Content}); err != nil {
					return TurnResult{}, err
				}
			}

			for _, delta := range choice.Delta.ToolCalls {
				index := delta.Index
				if !delta.JSON.Index.Valid() {
					if knownIndex, ok := toolCallIndexes[delta.ID]; delta.ID != "" && ok {
						index = knownIndex
					} else if delta.ID != "" {
						index = nextToolCallIndex
						nextToolCallIndex++
					} else if lastToolCallIndex >= 0 {
						index = lastToolCallIndex
					}
				} else if index >= nextToolCallIndex {
					nextToolCallIndex = index + 1
				}
				if delta.ID != "" {
					toolCallIndexes[delta.ID] = index
				}
				lastToolCallIndex = index

				call := toolCalls[index]
				if call == nil {
					call = &ToolCall{}
					toolCalls[index] = call
					if err := onEvent(Event{Type: EventToolCallStarted, ToolCall: &ToolCall{ID: delta.ID, Name: delta.Function.Name}, OutputIndex: index}); err != nil {
						return TurnResult{}, err
					}
				}
				if delta.ID != "" {
					call.ID = delta.ID
				}
				if delta.Function.Name != "" {
					call.Name = delta.Function.Name
				}
				if delta.Function.Arguments != "" {
					call.Arguments = append(call.Arguments, delta.Function.Arguments...)
					callCopy := *call
					if err := onEvent(Event{Type: EventToolCallArgumentsDelta, Delta: delta.Function.Arguments, ToolCall: &callCopy, OutputIndex: index}); err != nil {
						return TurnResult{}, err
					}
				}
			}
		}
	}
	if err := stream.Err(); err != nil {
		return TurnResult{}, wrapOpenAIError(config.Provider, err)
	}

	indexes := make([]int, 0, len(toolCalls))
	for index := range toolCalls {
		indexes = append(indexes, int(index))
	}
	sort.Ints(indexes)
	completedCalls := make([]ToolCall, 0, len(indexes))
	for _, index := range indexes {
		call := *toolCalls[int64(index)]
		completedCalls = append(completedCalls, call)
		callCopy := call
		if err := onEvent(Event{Type: EventToolCallCompleted, ToolCall: &callCopy, OutputIndex: int64(index)}); err != nil {
			return TurnResult{}, err
		}
	}

	metadataCopy := metadata
	if err := onEvent(Event{Type: EventResponseCompleted, Usage: &usage, Metadata: &metadataCopy}); err != nil {
		return TurnResult{}, err
	}
	return TurnResult{Content: contentBuilder.String(), ToolCalls: completedCalls, Usage: usage, Metadata: metadata}, nil
}

func openAIChatMessages(messages []Message) []openai.ChatCompletionMessageParamUnion {
	result := make([]openai.ChatCompletionMessageParamUnion, 0, len(messages))
	for _, message := range messages {
		switch message.Role {
		case "system":
			result = append(result, openai.SystemMessage(message.Content))
		case "user":
			if len(message.Attachments) == 0 {
				result = append(result, openai.UserMessage(message.Content))
				continue
			}
			parts := make([]openai.ChatCompletionContentPartUnionParam, 0, len(message.Attachments)+1)
			if strings.TrimSpace(message.Content) != "" {
				parts = append(parts, openai.TextContentPart(message.Content))
			}
			for _, attachment := range message.Attachments {
				parts = append(parts, openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{
					URL:    attachment.DataURL(),
					Detail: "auto",
				}))
			}
			result = append(result, openai.UserMessage(parts))
		case "assistant":
			assistant := openai.AssistantMessage(message.Content)
			for _, call := range message.ToolCalls {
				assistant.OfAssistant.ToolCalls = append(assistant.OfAssistant.ToolCalls, openai.ChatCompletionMessageToolCallUnionParam{
					OfFunction: &openai.ChatCompletionMessageFunctionToolCallParam{
						ID: call.ID,
						Function: openai.ChatCompletionMessageFunctionToolCallFunctionParam{
							Name: call.Name, Arguments: string(call.Arguments),
						},
					},
				})
			}
			result = append(result, assistant)
		case "tool":
			result = append(result, openai.ToolMessage(message.Content, message.ToolCallID))
		}
	}
	return result
}

func openAIChatTools(tools []ToolSpec) []openai.ChatCompletionToolUnionParam {
	result := make([]openai.ChatCompletionToolUnionParam, 0, len(tools))
	for _, tool := range tools {
		result = append(result, openai.ChatCompletionFunctionTool(shared.FunctionDefinitionParam{
			Name:        tool.Name,
			Description: param.NewOpt(tool.Description),
			Parameters:  shared.FunctionParameters(tool.Parameters),
		}))
	}
	return result
}
