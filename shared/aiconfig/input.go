package aiconfig

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/easyssh/shared/protocol"
)

var ErrInvalid = errors.New("invalid AI configuration")

// NormalizeInput is shared by both hosts. An omitted key is not permission to
// send an existing secret to a newly selected provider or endpoint.
func NormalizeInput(input protocol.AIConfigInput, current protocol.AIConfigInput) (protocol.AIConfigInput, error) {
	probe, err := ResolveProbe(protocol.AIModelsProbeInput{Provider: input.Provider, Endpoint: input.Endpoint, APIKey: input.APIKey}, current)
	if err != nil {
		return input, err
	}
	input.Provider, input.Endpoint, input.APIKey = probe.Provider, probe.Endpoint, probe.APIKey
	if len(input.Models) > 100 {
		return input, fmt.Errorf("%w: too many models", ErrInvalid)
	}
	models := make([]string, 0, len(input.Models))
	seen := make(map[string]bool, len(input.Models))
	for _, model := range input.Models {
		model = strings.TrimSpace(model)
		if model == "" || len(model) > 256 || !utf8.ValidString(model) || strings.IndexFunc(model, unicode.IsControl) >= 0 {
			return input, fmt.Errorf("%w: invalid model name", ErrInvalid)
		}
		if !seen[model] {
			models = append(models, model)
			seen[model] = true
		}
	}
	input.Models = models
	if input.Enabled && (len(models) == 0 || *input.APIKey == "") {
		return input, fmt.Errorf("%w: enabled AI requires an API key and at least one model", ErrInvalid)
	}
	return input, nil
}

func ResolveProbe(input protocol.AIModelsProbeInput, current protocol.AIConfigInput) (protocol.AIModelsProbeInput, error) {
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	if input.Provider == "" {
		input.Provider = "openai"
	}
	switch input.Provider {
	case "openai", "openai-response", "gemini", "anthropic":
	default:
		return input, fmt.Errorf("%w: unsupported provider", ErrInvalid)
	}
	input.Endpoint = strings.TrimRight(strings.TrimSpace(input.Endpoint), "/")
	if len(input.Endpoint) > 4096 {
		return input, fmt.Errorf("%w: endpoint too long", ErrInvalid)
	}
	if input.Endpoint != "" {
		u, err := url.Parse(input.Endpoint)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return input, fmt.Errorf("%w: endpoint must be an HTTP URL without credentials, query or fragment", ErrInvalid)
		}
	}
	key := ""
	if input.APIKey != nil {
		key = strings.TrimSpace(*input.APIKey)
	} else if current.APIKey != nil && *current.APIKey != "" {
		if input.Provider != NormalizeProvider(current.Provider) || input.Endpoint != strings.TrimRight(strings.TrimSpace(current.Endpoint), "/") {
			return input, fmt.Errorf("%w: provide or explicitly clear the API key when changing its destination", ErrInvalid)
		}
		key = *current.APIKey
	}
	if len(key) > 16384 || !utf8.ValidString(key) || strings.IndexFunc(key, unicode.IsControl) >= 0 {
		return input, fmt.Errorf("%w: invalid API key", ErrInvalid)
	}
	input.APIKey = &key
	return input, nil
}

func Public(input protocol.AIConfigInput) protocol.OwnerAIConfig {
	models := append([]string{}, input.Models...)
	return protocol.OwnerAIConfig{Enabled: input.Enabled, Provider: input.Provider, Endpoint: input.Endpoint, Models: models, HasAPIKey: input.APIKey != nil && *input.APIKey != ""}
}
