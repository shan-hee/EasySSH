package aiprovider

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProviderLimitStopsStreamBeforeOversizedTextReachesConsumer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, content := range []string{"observed prefix", strings.Repeat("x", MaxResponseBytes)} {
			chunk, _ := json.Marshal(map[string]any{"id": "response", "choices": []any{map[string]any{"index": 0, "delta": map[string]string{"content": content}}}})
			_, _ = fmt.Fprintf(w, "data: %s\n\n", chunk)
		}
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer server.Close()
	var observed strings.Builder
	result, err := NewFactory().StreamTurn(context.Background(), Config{Provider: "openai", Endpoint: server.URL + "/v1", APIKey: "test-key"}, TurnRequest{Model: "test-model"}, func(event Event) error {
		if event.Type == EventTextDelta {
			observed.WriteString(event.Delta)
		}
		return nil
	})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.Code != "ai_output_limit" || providerErr.Retryable {
		t.Fatalf("expected non-retryable output limit, got %v", err)
	}
	if observed.String() != "observed prefix" || len(result.ToolCalls) != 0 {
		t.Fatal("oversized output reached consumer or returned executable calls")
	}
}

func TestHTTPResponseLimitCountsDecompressedBytes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Encoding", "gzip")
		writer := gzip.NewWriter(w)
		defer writer.Close()
		_, _ = io.Copy(writer, strings.NewReader(strings.Repeat("x", maxHTTPResponseBytes+1)))
	}))
	defer server.Close()
	response, err := boundedHTTPClient().Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	count, err := io.Copy(io.Discard, response.Body)
	var providerErr *ProviderError
	if count != maxHTTPResponseBytes || !errors.As(err, &providerErr) || providerErr.Code != "ai_output_limit" {
		t.Fatalf("decompressed response was not bounded: bytes=%d error=%v", count, err)
	}
}

func TestFinalToolPayloadWithoutDeltasStillHasOutputLimit(t *testing.T) {
	budget := responseBudget{}
	err := budget.accept(Event{Type: EventToolCallCompleted, ToolCall: &ToolCall{ID: "call", Arguments: json.RawMessage(strings.Repeat("x", MaxResponseBytes+1))}})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.Code != "ai_output_limit" {
		t.Fatalf("unbounded completed arguments: %v", err)
	}
	budget = responseBudget{}
	for i := 0; i < MaxToolCallsPerResponse; i++ {
		if err := budget.accept(Event{Type: EventToolCallStarted}); err != nil {
			t.Fatal(err)
		}
	}
	err = budget.accept(Event{Type: EventToolCallStarted})
	if !errors.As(err, &providerErr) || providerErr.Code != "ai_tool_call_limit" {
		t.Fatalf("unbounded tool fan-out: %v", err)
	}
}
