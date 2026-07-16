package aiprovider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/openai/openai-go/v3"
)

func wrapOpenAIError(provider string, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return &ProviderError{Code: "cancelled", Message: "AI 请求已取消", Provider: provider, Retryable: false, Cause: err}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return &ProviderError{Code: "request_timeout", Message: "AI 单次请求超时", Provider: provider, Retryable: true, Cause: err}
	}

	var apiErr *openai.Error
	if errors.As(err, &apiErr) {
		payloadCode, payloadMessage := providerErrorPayload(apiErr.RawJSON())
		message := firstNonEmpty(apiErr.Message, payloadMessage)
		if message == "" {
			message = fmt.Sprintf("AI provider returned HTTP %d", apiErr.StatusCode)
		}
		return &ProviderError{
			Code:       firstNonEmpty(apiErr.Code, payloadCode, apiErr.Type, "provider_error"),
			Message:    message,
			Provider:   provider,
			StatusCode: apiErr.StatusCode,
			RequestID:  responseRequestID(apiErr.Response),
			Retryable:  retryableStatus(apiErr.StatusCode),
			Cause:      err,
		}
	}
	return &ProviderError{Code: "provider_error", Message: err.Error(), Provider: provider, Retryable: false, Cause: err}
}

func wrapAnthropicError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return &ProviderError{Code: "cancelled", Message: "AI 请求已取消", Provider: "anthropic", Retryable: false, Cause: err}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return &ProviderError{Code: "request_timeout", Message: "AI 单次请求超时", Provider: "anthropic", Retryable: true, Cause: err}
	}

	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		code := string(apiErr.Type())
		if code == "" {
			code = "provider_error"
		}
		return &ProviderError{
			Code:       code,
			Message:    apiErr.Error(),
			Provider:   "anthropic",
			StatusCode: apiErr.StatusCode,
			RequestID:  apiErr.RequestID,
			Retryable:  retryableStatus(apiErr.StatusCode),
			Cause:      err,
		}
	}
	return &ProviderError{Code: "provider_error", Message: err.Error(), Provider: "anthropic", Retryable: false, Cause: err}
}

func responseRequestID(response *http.Response) string {
	if response == nil {
		return ""
	}
	return firstNonEmpty(
		response.Header.Get("x-request-id"),
		response.Header.Get("request-id"),
		response.Header.Get("ah-request-id"),
		response.Header.Get("cf-ray"),
	)
}

func providerErrorPayload(raw string) (string, string) {
	if strings.TrimSpace(raw) == "" {
		return "", ""
	}
	var value any
	if json.Unmarshal([]byte(raw), &value) != nil {
		return "", ""
	}
	return providerErrorValue(value)
}

func providerErrorValue(value any) (string, string) {
	object, ok := value.(map[string]any)
	if !ok {
		return "", ""
	}

	code := stringField(object, "code")
	if code == "" {
		code = stringField(object, "type")
	}
	message := stringField(object, "message")
	if nested, ok := object["error"]; ok {
		if nestedMessage, ok := nested.(string); ok {
			message = firstNonEmpty(message, nestedMessage)
		} else {
			nestedCode, nestedMessage := providerErrorValue(nested)
			code = firstNonEmpty(code, nestedCode)
			message = firstNonEmpty(message, nestedMessage)
		}
	}
	return code, message
}

func stringField(object map[string]any, key string) string {
	value, _ := object[key].(string)
	return strings.TrimSpace(value)
}

func retryableStatus(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
