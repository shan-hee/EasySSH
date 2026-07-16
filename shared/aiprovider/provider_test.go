package aiprovider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCompatibleOpenAIEndpointUsesEasySSHUserAgent(t *testing.T) {
	t.Parallel()

	var requestPath string
	var userAgent string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestPath = r.URL.Path
		userAgent = r.Header.Get("User-Agent")
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data":   []map[string]any{{"id": "test-model", "object": "model", "owned_by": "test"}},
		}); err != nil {
			return
		}
	}))
	defer server.Close()

	models, err := NewFactory().ListModels(context.Background(), Config{
		Provider: "openai",
		APIKey:   "test-key",
		Endpoint: server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("list models: %v", err)
	}
	if requestPath != "/v1/models" {
		t.Fatalf("unexpected path: %s", requestPath)
	}
	if userAgent != compatibleProviderUserAgent {
		t.Fatalf("unexpected user agent: %q", userAgent)
	}
	if len(models) != 1 || models[0] != "test-model" {
		t.Fatalf("unexpected models: %#v", models)
	}
}

func TestOfficialOpenAIEndpointKeepsSDKUserAgent(t *testing.T) {
	t.Parallel()

	if !isOfficialAPIBaseURL("https://api.openai.com/v1", "api.openai.com") {
		t.Fatal("official OpenAI base URL was not recognized")
	}
	if isOfficialAPIBaseURL("https://ai.ajjj.de/v1", "api.openai.com") {
		t.Fatal("compatible endpoint was incorrectly treated as official OpenAI")
	}
}
