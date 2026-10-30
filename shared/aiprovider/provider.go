package aiprovider

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	anthropicoption "github.com/anthropics/anthropic-sdk-go/option"
	"github.com/easyssh/shared/aiconfig"
	"github.com/openai/openai-go/v3"
	openaioption "github.com/openai/openai-go/v3/option"
)

type Factory struct{}

func NewFactory() *Factory { return &Factory{} }

const (
	compatibleProviderUserAgent = "EasySSH/1.0"
	costEstimateKindUpperBound  = "conservative_upper_bound"
)

func (f *Factory) ListModels(ctx context.Context, config Config) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	provider := aiconfig.NormalizeProvider(config.Provider)
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, NewLimitError("api_key_required", "AI API key is required")
	}

	budget := modelListBudget{}
	switch provider {
	case "anthropic":
		client := newAnthropicClient(config)
		pager := client.Models.ListAutoPaging(ctx, anthropic.ModelListParams{})
		for pager.Next() {
			if err := budget.add(pager.Current().ID); err != nil {
				return nil, err
			}
		}
		if err := pager.Err(); err != nil {
			return nil, wrapAnthropicError(err)
		}
	case "openai", "openai-response", "gemini":
		client := newOpenAIClient(config)
		page, err := client.Models.List(ctx)
		if err != nil {
			return nil, wrapOpenAIError(provider, err)
		}
		for _, model := range page.Data {
			if err := budget.add(model.ID); err != nil {
				return nil, err
			}
		}
	default:
		return nil, NewLimitError("invalid_provider", "invalid AI provider")
	}

	models := make([]string, 0, len(budget.items))
	for model := range budget.items {
		models = append(models, model)
	}
	sort.Strings(models)
	return models, nil
}

func (f *Factory) StreamTurn(ctx context.Context, config Config, req TurnRequest, onEvent func(Event) error) (TurnResult, error) {
	ctx, cancel := context.WithTimeout(ctx, RequestTimeout)
	defer cancel()
	if onEvent == nil {
		onEvent = func(Event) error { return nil }
	}
	if err := validateTurnRequest(config, req); err != nil {
		return TurnResult{}, err
	}
	req.Messages = prepareToolContext(req.Messages)
	if err := validateRequestSize(req); err != nil {
		return TurnResult{}, err
	}

	provider := aiconfig.NormalizeProvider(config.Provider)
	config.Provider = provider
	budget := responseBudget{}
	eventHandler := func(event Event) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := budget.accept(event); err != nil {
			return err
		}
		if event.Type == EventResponseCompleted && event.Metadata != nil && event.Usage != nil {
			metadata := metadataWithCostEstimate(*event.Metadata, *event.Usage, config.Pricing)
			event.Metadata = &metadata
		}
		return onEvent(event)
	}

	var result TurnResult
	var err error
	switch provider {
	case "openai":
		result, err = streamOpenAIChat(ctx, config, req, eventHandler)
	case "openai-response":
		result, err = streamOpenAIResponses(ctx, config, req, eventHandler)
	case "gemini":
		result, err = streamOpenAIChat(ctx, config, req, eventHandler)
	case "anthropic":
		result, err = streamAnthropic(ctx, config, req, eventHandler)
	default:
		err = NewLimitError("invalid_provider", "invalid AI provider")
	}
	if err != nil {
		return TurnResult{}, err
	}

	if err := validateTurnResult(result); err != nil {
		return TurnResult{}, err
	}
	result.Metadata = metadataWithCostEstimate(result.Metadata, result.Usage, config.Pricing)
	return result, nil
}

func metadataWithCostEstimate(metadata ProviderMetadata, usage Usage, pricing Pricing) ProviderMetadata {
	metadata.EstimatedCostMicros = EstimateCostMicros(usage, pricing)
	metadata.CostEstimateKind = costEstimateKindUpperBound
	return metadata
}

func validateTurnRequest(config Config, req TurnRequest) error {
	if err := validateRequestSize(req); err != nil {
		return err
	}
	switch req.ReasoningEffort {
	case "", "low", "medium", "high", "xhigh", "max":
	default:
		return NewLimitError("invalid_reasoning_effort", "Unsupported reasoning effort")
	}
	if strings.TrimSpace(config.APIKey) == "" {
		return NewLimitError("api_key_required", "AI API key is required")
	}
	if strings.TrimSpace(req.Model) == "" {
		return NewLimitError("model_required", "AI model is required")
	}
	return validateContextAttachments(req.Messages)
}

// ValidateContext is used before accepting user edits/new turns. It never
// changes history, invokes a provider or rejects saving already observed results.
func ValidateContext(messages []Message) error {
	if err := validateRequestSize(TurnRequest{Messages: messages}); err != nil {
		return err
	}
	return validateContextAttachments(messages)
}

func validateContextAttachments(messages []Message) error {
	var totalImageBytes int64
	for _, message := range messages {
		imageBytes, err := validateAttachments(message.Attachments)
		if err != nil {
			return &ProviderError{Code: "invalid_attachment", Message: err.Error(), Retryable: false, Cause: err}
		}
		totalImageBytes += imageBytes
		if totalImageBytes > MaxImageTotalBytes {
			err := fmt.Errorf("本次请求的图片总大小超出 %d MB 限制", MaxImageTotalBytes/(1024*1024))
			return &ProviderError{Code: "invalid_attachment", Message: err.Error(), Retryable: false, Cause: err}
		}
	}
	return nil
}

func newOpenAIClient(config Config) openai.Client {
	options := []openaioption.RequestOption{
		openaioption.WithAPIKey(strings.TrimSpace(config.APIKey)),
		openaioption.WithMaxRetries(0),
		openaioption.WithRequestTimeout(0),
		// Bypass the SDK's response-header deadline; cancellation comes from ctx.
		openaioption.WithHTTPClient(boundedHTTPClient()),
	}
	baseURL := aiconfig.NormalizeOpenAIBaseURL(config.Provider, config.Endpoint)
	if baseURL == "" && aiconfig.NormalizeProvider(config.Provider) == "gemini" {
		baseURL = "https://generativelanguage.googleapis.com/v1beta/openai"
	}
	if baseURL != "" {
		options = append(options, openaioption.WithBaseURL(baseURL+"/"))
		if !isOfficialAPIBaseURL(baseURL, "api.openai.com") {
			options = append(options, openaioption.WithHeader("User-Agent", compatibleProviderUserAgent))
		}
	}
	return openai.NewClient(options...)
}

func isOfficialAPIBaseURL(baseURL, hostname string) bool {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Hostname(), hostname)
}

func newAnthropicClient(config Config) anthropic.Client {
	options := []anthropicoption.RequestOption{
		anthropicoption.WithAPIKey(strings.TrimSpace(config.APIKey)),
		anthropicoption.WithMaxRetries(0),
		anthropicoption.WithRequestTimeout(0),
		// Bypass the SDK's response-header deadline; cancellation comes from ctx.
		anthropicoption.WithHTTPClient(boundedHTTPClient()),
	}
	if baseURL := aiconfig.NormalizeAnthropicBaseURL(config.Endpoint); baseURL != "" {
		options = append(options, anthropicoption.WithBaseURL(baseURL+"/"))
		if !isOfficialAPIBaseURL(baseURL, "api.anthropic.com") {
			options = append(options, anthropicoption.WithHeader("User-Agent", compatibleProviderUserAgent))
		}
	}
	return anthropic.NewClient(options...)
}

func providerEndpoint(config Config) string {
	if endpoint := strings.TrimSpace(config.Endpoint); endpoint != "" {
		return endpoint
	}
	switch aiconfig.NormalizeProvider(config.Provider) {
	case "anthropic":
		return "https://api.anthropic.com"
	case "gemini":
		return "https://generativelanguage.googleapis.com/v1beta/openai"
	default:
		return "https://api.openai.com/v1"
	}
}
