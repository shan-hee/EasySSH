package rest

import "testing"

func TestEndpointForLogRemovesCredentialsAndQuery(t *testing.T) {
	t.Parallel()

	got := endpointForLog("https://user:secret@example.com/v1?api_key=secret#fragment")
	if got != "https://example.com/v1" {
		t.Fatalf("unexpected sanitized endpoint: %q", got)
	}
}
