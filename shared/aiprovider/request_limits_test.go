package aiprovider

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func expectProviderCode(t *testing.T, err error, code string) {
	t.Helper()
	var problem *ProviderError
	if !errors.As(err, &problem) || problem.Code != code || problem.Retryable {
		t.Fatalf("expected non-retryable %s, got %v", code, err)
	}
}
func TestRequestLimitStopsBeforeProviderDispatch(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	_, err := NewFactory().StreamTurn(context.Background(), Config{Provider: "openai", Endpoint: server.URL + "/v1", APIKey: "key"}, TurnRequest{Model: "model", Messages: []Message{{Role: "user", Content: strings.Repeat("x", MaxRequestTextBytes+1)}}}, nil)
	expectProviderCode(t, err, "ai_context_limit")
	if calls.Load() != 0 {
		t.Fatal("oversized context reached provider")
	}
}
func TestRequestBudgetCountsToolArgumentsAndMessageCount(t *testing.T) {
	request := TurnRequest{Messages: []Message{{Content: strings.Repeat("x", MaxRequestTextBytes)}}}
	if err := validateRequestSize(request); err != nil {
		t.Fatal(err)
	}
	request.Messages[0].ToolCalls = []ToolCall{{ID: "call"}}
	expectProviderCode(t, validateRequestSize(request), "ai_context_limit")
	request = TurnRequest{Messages: make([]Message, MaxRequestMessages)}
	if err := validateRequestSize(request); err != nil {
		t.Fatal(err)
	}
	request.Messages = append(request.Messages, Message{})
	expectProviderCode(t, validateRequestSize(request), "ai_context_limit")
	request = TurnRequest{Tools: []ToolSpec{{Parameters: map[string]interface{}{"description": strings.Repeat("x", MaxToolSchemaBytes+1)}}}}
	expectProviderCode(t, validateRequestSize(request), "ai_request_limit")
}
func TestAttachmentEncodedLimitPrecedesDecodingAndDoesNotTrustDeclaredSize(t *testing.T) {
	err := ValidateAttachments([]Attachment{{Name: "image", MediaType: "image/png", Size: 1, Data: strings.Repeat("A", base64.StdEncoding.EncodedLen(MaxImageBytes)+4)}})
	if err == nil || !strings.Contains(err.Error(), "超出") {
		t.Fatalf("unbounded encoded attachment accepted: %v", err)
	}
	valid := Attachment{MediaType: "image/png", Data: base64.StdEncoding.EncodeToString([]byte("x")), Size: 1}
	if err := ValidateAttachments([]Attachment{valid}); err != nil {
		t.Fatal(err)
	}
	valid.Size = 2
	if err := ValidateAttachments([]Attachment{valid}); err == nil {
		t.Fatal("mismatched declared size accepted")
	}
}
func TestModelBudgetCountsDuplicatesAndRejectsOversizedIDs(t *testing.T) {
	budget := modelListBudget{}
	for i := 0; i < MaxModels; i++ {
		if err := budget.add("model"); err != nil {
			t.Fatal(err)
		}
	}
	if len(budget.items) != 1 {
		t.Fatal("model IDs were not deduplicated")
	}
	expectProviderCode(t, budget.add("model"), "ai_model_list_limit")
	budget = modelListBudget{}
	expectProviderCode(t, budget.add(strings.Repeat("a", MaxModelIDBytes+1)), "invalid_model_list")
}

type requestLimitTransportFunc func(*http.Request) (*http.Response, error)

func (f requestLimitTransportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestSerializedRequestLimitRejectsBeforeNetwork(t *testing.T) {
	calls := 0
	transport := responseBudgetTransport{base: requestLimitTransportFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("{}")), Header: make(http.Header)}, nil
	})}
	request, _ := http.NewRequest(http.MethodPost, "https://provider.example", strings.NewReader("body"))
	request.ContentLength = maxHTTPRequestBytes + 1
	_, err := transport.RoundTrip(request)
	expectProviderCode(t, err, "ai_request_limit")
	if calls != 0 {
		t.Fatal("oversized serialized request dispatched")
	}
	request, _ = http.NewRequest(http.MethodPost, "https://provider.example", io.NopCloser(strings.NewReader("body")))
	request.ContentLength = -1
	response, err := transport.RoundTrip(request)
	if err != nil || calls != 1 {
		t.Fatalf("bounded unknown length request: %v calls=%d", err, calls)
	}
	_ = response.Body.Close()
}
func TestAIClientDoesNotForwardCredentialsThroughRedirect(t *testing.T) {
	var forwarded atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded.Add(1); w.WriteHeader(http.StatusOK) }))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", destination.URL)
		w.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	request, _ := http.NewRequest(http.MethodPost, source.URL, strings.NewReader("body"))
	request.Header.Set("x-api-key", "private-key")
	_, err := boundedHTTPClient().Do(request)
	expectProviderCode(t, err, "provider_redirect_rejected")
	if forwarded.Load() != 0 {
		t.Fatal("AI request followed redirect")
	}
}
