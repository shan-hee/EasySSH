package aiprovider

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	MaxImageAttachments = 5
	MaxImageBytes       = 8 * 1024 * 1024
	MaxImageTotalBytes  = 20 * 1024 * 1024
)

type Limits struct {
	RequestTimeout time.Duration
	TurnTimeout    time.Duration
}

func DefaultLimits() Limits {
	return Limits{
		RequestTimeout: 2 * time.Minute,
		TurnTimeout:    10 * time.Minute,
	}
}

func NormalizeLimits(limits Limits) Limits {
	defaults := DefaultLimits()
	if limits.RequestTimeout <= 0 {
		limits.RequestTimeout = defaults.RequestTimeout
	}
	if limits.TurnTimeout <= 0 {
		limits.TurnTimeout = defaults.TurnTimeout
	}
	return limits
}

type Pricing struct {
	InputMicrosPerMillion       int64
	CachedInputMicrosPerMillion int64
	OutputMicrosPerMillion      int64
}

// ConservativePricing is intentionally an upper-bound estimate for unknown models.
// It prevents runaway turns without pretending to be the provider's billing source.
func ConservativePricing() Pricing {
	return Pricing{
		InputMicrosPerMillion:       100_000_000,
		CachedInputMicrosPerMillion: 100_000_000,
		OutputMicrosPerMillion:      200_000_000,
	}
}

type Config struct {
	Provider string
	APIKey   string
	Endpoint string
	Model    string
	Models   []string
	Limits   Limits
	Pricing  Pricing
}

type Attachment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
	Size      int64  `json:"size"`
}

func (a Attachment) DataURL() string {
	return "data:" + a.MediaType + ";base64," + a.Data
}

func ValidateAttachments(attachments []Attachment) error {
	_, err := validateAttachments(attachments)
	return err
}

func validateAttachments(attachments []Attachment) (int64, error) {
	if len(attachments) > MaxImageAttachments {
		return 0, fmt.Errorf("最多支持 %d 张图片", MaxImageAttachments)
	}

	var total int64
	for _, attachment := range attachments {
		mediaType := strings.ToLower(strings.TrimSpace(attachment.MediaType))
		switch mediaType {
		case "image/jpeg", "image/png", "image/gif", "image/webp":
		default:
			return 0, fmt.Errorf("不支持的图片类型: %s", attachment.MediaType)
		}

		decoded, err := base64.StdEncoding.DecodeString(attachment.Data)
		if err != nil {
			return 0, fmt.Errorf("图片 %s 的 Base64 数据无效: %w", attachment.Name, err)
		}
		decodedSize := int64(len(decoded))
		if attachment.Size > 0 && attachment.Size != decodedSize {
			return 0, fmt.Errorf("图片 %s 的声明大小与实际数据不一致", attachment.Name)
		}
		if decodedSize <= 0 || decodedSize > MaxImageBytes {
			return 0, fmt.Errorf("图片 %s 超出 %d MB 限制", attachment.Name, MaxImageBytes/(1024*1024))
		}
		total += decodedSize
	}

	if total > MaxImageTotalBytes {
		return 0, fmt.Errorf("图片总大小超出 %d MB 限制", MaxImageTotalBytes/(1024*1024))
	}
	return total, nil
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
	Role        string       `json:"role"`
	Content     string       `json:"content"`
	Attachments []Attachment `json:"attachments,omitempty"`
	ToolCalls   []ToolCall   `json:"tool_calls,omitempty"`
	ToolCallID  string       `json:"tool_call_id,omitempty"`
}

type Usage struct {
	InputTokens      int64 `json:"input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
	CachedTokens     int64 `json:"cached_tokens,omitempty"`
	CacheWriteTokens int64 `json:"cache_write_tokens,omitempty"`
	ReasoningTokens  int64 `json:"reasoning_tokens,omitempty"`
	TotalTokens      int64 `json:"total_tokens"`
}

func EstimateCostMicros(usage Usage, pricing Pricing) int64 {
	if pricing == (Pricing{}) {
		pricing = ConservativePricing()
	}
	uncached := usage.InputTokens - usage.CachedTokens
	if uncached < 0 {
		uncached = 0
	}
	return uncached*pricing.InputMicrosPerMillion/1_000_000 +
		usage.CachedTokens*pricing.CachedInputMicrosPerMillion/1_000_000 +
		usage.OutputTokens*pricing.OutputMicrosPerMillion/1_000_000
}

type ProviderMetadata struct {
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

type EventType string

const (
	EventTextDelta              EventType = "text_delta"
	EventReasoningDelta         EventType = "reasoning_delta"
	EventToolCallStarted        EventType = "tool_call_started"
	EventToolCallArgumentsDelta EventType = "tool_call_arguments_delta"
	EventToolCallCompleted      EventType = "tool_call_completed"
	EventUsageUpdated           EventType = "usage_updated"
	EventResponseCompleted      EventType = "response_completed"
)

type Event struct {
	Type        EventType         `json:"type"`
	Delta       string            `json:"delta,omitempty"`
	ToolCall    *ToolCall         `json:"tool_call,omitempty"`
	Usage       *Usage            `json:"usage,omitempty"`
	Metadata    *ProviderMetadata `json:"metadata,omitempty"`
	ItemID      string            `json:"item_id,omitempty"`
	OutputIndex int64             `json:"output_index,omitempty"`
}

type TurnRequest struct {
	Messages []Message
	Model    string
	Tools    []ToolSpec
}

type TurnResult struct {
	Content   string
	Reasoning string
	ToolCalls []ToolCall
	Usage     Usage
	Metadata  ProviderMetadata
}

type ProviderError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Provider   string `json:"provider,omitempty"`
	StatusCode int    `json:"status_code,omitempty"`
	RequestID  string `json:"request_id,omitempty"`
	Retryable  bool   `json:"retryable"`
	Cause      error  `json:"-"`
}

func (e *ProviderError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (e *ProviderError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

func NewLimitError(code, message string) error {
	return &ProviderError{Code: code, Message: message, Retryable: false}
}

func IsProviderError(err error) bool {
	var providerErr *ProviderError
	return errors.As(err, &providerErr)
}
