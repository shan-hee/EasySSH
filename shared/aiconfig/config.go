package aiconfig

import "strings"

func NormalizeProvider(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "openai-response":
		return "openai-response"
	case "gemini":
		return "gemini"
	case "anthropic":
		return "anthropic"
	default:
		return "openai"
	}
}

func NormalizeOpenAIBaseURL(provider string, endpoint string) string {
	baseURL := strings.TrimSpace(strings.TrimSuffix(endpoint, "/"))
	if baseURL == "" {
		return ""
	}

	lower := strings.ToLower(baseURL)
	for _, suffix := range []string{"/chat/completions", "/completions", "/responses"} {
		if strings.HasSuffix(lower, suffix) {
			baseURL = baseURL[:len(baseURL)-len(suffix)]
			lower = strings.ToLower(baseURL)
			break
		}
	}

	if NormalizeProvider(provider) == "gemini" {
		return baseURL
	}

	if idx := strings.Index(lower, "/v1/"); idx >= 0 {
		baseURL = baseURL[:idx+3]
		lower = strings.ToLower(baseURL)
	}

	if !strings.HasSuffix(lower, "/v1") {
		baseURL += "/v1"
	}

	return baseURL
}

func NormalizeAnthropicBaseURL(endpoint string) string {
	baseURL := strings.TrimSpace(strings.TrimSuffix(endpoint, "/"))
	if baseURL == "" {
		return ""
	}

	lower := strings.ToLower(baseURL)
	for _, suffix := range []string{"/v1/messages", "/messages", "/v1"} {
		if strings.HasSuffix(lower, suffix) {
			baseURL = baseURL[:len(baseURL)-len(suffix)]
			break
		}
	}

	return baseURL
}

func FirstModel(models []string) string {
	if len(models) == 0 {
		return ""
	}
	return models[0]
}
