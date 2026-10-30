package aiconfig

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/easyssh/shared/protocol"
)

func TestOmittedAIKeyCannotFollowDestinationChange(t *testing.T) {
	key := "existing-secret"
	current := protocol.AIConfigInput{Enabled: true, Provider: "openai", Endpoint: "https://first.example/v1", APIKey: &key, Models: []string{"model"}}
	for _, probe := range []protocol.AIModelsProbeInput{
		{Provider: "openai", Endpoint: "https://second.example/v1"},
		{Provider: "anthropic", Endpoint: current.Endpoint},
		{Provider: "openai", Endpoint: ""},
	} {
		if _, err := ResolveProbe(probe, current); !errors.Is(err, ErrInvalid) {
			t.Fatalf("saved key followed changed destination: %v", err)
		}
	}
	probe, err := ResolveProbe(protocol.AIModelsProbeInput{Provider: current.Provider, Endpoint: current.Endpoint + "/"}, current)
	if err != nil || probe.APIKey == nil || *probe.APIKey != key {
		t.Fatalf("same destination lost saved key: %v", err)
	}
	empty := ""
	probe, err = ResolveProbe(protocol.AIModelsProbeInput{Provider: "openai", Endpoint: "https://second.example/v1", APIKey: &empty}, current)
	if err != nil || *probe.APIKey != "" {
		t.Fatalf("explicit clear restored previous key: %v", err)
	}
}

func TestAIConfigPublicResponseAndExplicitClear(t *testing.T) {
	key := "private-key"
	current := protocol.AIConfigInput{Enabled: true, Provider: "openai", APIKey: &key, Models: []string{"a"}}
	input := current
	input.APIKey = nil
	input.Models = []string{" a ", "a", "b"}
	normalized, err := NormalizeInput(input, current)
	if err != nil || len(normalized.Models) != 2 {
		t.Fatalf("invalid normalization: %+v %v", normalized.Models, err)
	}
	encoded, err := json.Marshal(Public(normalized))
	if err != nil || strings.Contains(string(encoded), key) || strings.Contains(string(encoded), `"api_key"`) {
		t.Fatalf("public response contains secret: %v", err)
	}
	empty := ""
	input.APIKey = &empty
	if _, err := NormalizeInput(input, current); !errors.Is(err, ErrInvalid) {
		t.Fatalf("enabled config accepted missing key: %v", err)
	}
	input.Enabled = false
	cleared, err := NormalizeInput(input, current)
	if err != nil || *cleared.APIKey != "" || Public(cleared).HasAPIKey {
		t.Fatalf("clear did not remove key: %v", err)
	}
}
