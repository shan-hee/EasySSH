package notification

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

type capturedWebhook struct {
	signature string
	payload   []byte
}

func captureWebhook(t *testing.T, method, secret string) capturedWebhook {
	t.Helper()
	var captured capturedWebhook
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.signature = r.Header.Get(WebhookSignatureHeader)
		if r.Method == http.MethodGet {
			captured.payload = []byte(r.URL.Query().Get("data"))
		} else {
			captured.payload, _ = io.ReadAll(r.Body)
		}
	}))
	defer server.Close()
	sender, err := NewWebhookService(&WebhookConfig{URL: server.URL, Secret: secret, Method: method})
	if err != nil {
		t.Fatal(err)
	}
	if err := sender.SendNotification(context.Background(), "task.failed", map[string]interface{}{"event_id": "n-1"}); err != nil {
		t.Fatal(err)
	}
	return captured
}

func TestWebhookSignsExactPayloadBytes(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodGet} {
		captured := captureWebhook(t, method, "s3cret")
		mac := hmac.New(sha256.New, []byte("s3cret"))
		mac.Write(captured.payload)
		if want := "sha256=" + hex.EncodeToString(mac.Sum(nil)); captured.signature != want {
			t.Fatalf("%s signature = %q, want %q", method, captured.signature, want)
		}
		var payload map[string]interface{}
		if err := json.Unmarshal(captured.payload, &payload); err != nil {
			t.Fatalf("%s payload is not JSON: %v", method, err)
		}
		if _, ok := payload["signature"]; ok || payload["event"] != "task.failed" {
			t.Fatalf("%s payload = %s", method, captured.payload)
		}
	}
}

func TestWebhookWithoutSecretIsUnsigned(t *testing.T) {
	if captured := captureWebhook(t, http.MethodPost, ""); captured.signature != "" {
		t.Fatalf("unexpected signature %q", captured.signature)
	}
}
