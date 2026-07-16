package aiprovider

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/openai/openai-go/v3"
)

func TestWrapOpenAIErrorReadsNestedCompatiblePayload(t *testing.T) {
	t.Parallel()

	apiErr := &openai.Error{
		StatusCode: http.StatusForbidden,
		Response: &http.Response{Header: http.Header{
			"Ah-Request-Id": []string{"request-123"},
		}},
	}
	if err := json.Unmarshal([]byte(`{"error":{"type":"Forbidden","message":"Model listing is not allowed"}}`), apiErr); err != nil {
		t.Fatalf("unmarshal nested provider error: %v", err)
	}

	err := wrapOpenAIError("openai", apiErr)
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) {
		t.Fatalf("expected ProviderError, got %T: %v", err, err)
	}
	if providerErr.Code != "Forbidden" {
		t.Fatalf("unexpected code: %q", providerErr.Code)
	}
	if providerErr.Message != "Model listing is not allowed" {
		t.Fatalf("unexpected message: %q", providerErr.Message)
	}
	if providerErr.StatusCode != http.StatusForbidden {
		t.Fatalf("unexpected status: %d", providerErr.StatusCode)
	}
	if providerErr.RequestID != "request-123" {
		t.Fatalf("unexpected request id: %q", providerErr.RequestID)
	}
}
