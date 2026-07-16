package aiprovider

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"
	"strings"

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
	provider := aiconfig.NormalizeProvider(config.Provider)
	if strings.TrimSpace(config.APIKey) == "" {
		return nil, NewLimitError("api_key_required", "AI API key is required")
	}

	modelSet := make(map[string]struct{})
	switch provider {
	case "anthropic":
		client := newAnthropicClient(config)
		pager := client.Models.ListAutoPaging(ctx, anthropic.ModelListParams{})
		for pager.Next() {
			id := strings.TrimSpace(pager.Current().ID)
			if id != "" {
				modelSet[id] = struct{}{}
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
			id := strings.TrimSpace(model.ID)
			if id != "" {
				modelSet[id] = struct{}{}
			}
		}
	default:
		return nil, NewLimitError("invalid_provider", "invalid AI provider")
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
	if err := validateTurnRequest(config, req); err != nil {
		return TurnResult{}, err
	}

	provider := aiconfig.NormalizeProvider(config.Provider)
	config.Provider = provider
	config.Limits = NormalizeLimits(config.Limits)
	if req.MaxOutputTokens <= 0 || req.MaxOutputTokens > config.Limits.MaxOutputTokens {
		req.MaxOutputTokens = config.Limits.MaxOutputTokens
	}

	requestCtx, cancel := context.WithTimeout(ctx, config.Limits.RequestTimeout)
	defer cancel()
	eventHandler := func(event Event) error {
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
		result, err = streamOpenAIChat(requestCtx, config, req, eventHandler)
	case "openai-response":
		result, err = streamOpenAIResponses(requestCtx, config, req, eventHandler)
	case "gemini":
		result, err = streamOpenAIChat(requestCtx, config, req, eventHandler)
	case "anthropic":
		result, err = streamAnthropic(requestCtx, config, req, eventHandler)
	default:
		err = NewLimitError("invalid_provider", "invalid AI provider")
	}
	if err != nil {
		if errors.Is(requestCtx.Err(), context.DeadlineExceeded) {
			return TurnResult{}, &ProviderError{Code: "request_timeout", Message: "AI 单次请求超时", Provider: provider, Retryable: true, Cause: requestCtx.Err()}
		}
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
	if strings.TrimSpace(config.APIKey) == "" {
		return NewLimitError("api_key_required", "AI API key is required")
	}
	if strings.TrimSpace(req.Model) == "" {
		return NewLimitError("model_required", "AI model is required")
	}
	var totalImageBytes int64
	for _, message := range req.Messages {
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
		openaioption.WithRequestTimeout(NormalizeLimits(config.Limits).RequestTimeout),
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
		anthropicoption.WithRequestTimeout(NormalizeLimits(config.Limits).RequestTimeout),
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
