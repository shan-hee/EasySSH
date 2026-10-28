package aichatui

import (
	"strings"
	"unicode/utf8"
)

// SessionMatchesSearch searches visible message text, not just the derived title.
func SessionMatchesSearch(title string, messages []MessageView, query string) bool {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" || strings.Contains(strings.ToLower(title), query) {
		return true
	}
	for _, message := range messages {
		if (message.Role == "user" || message.Role == "assistant") && strings.Contains(strings.ToLower(message.Content), query) {
			return true
		}
	}
	return false
}

// SessionSearchPreview returns a bounded excerpt around the newest matching
// message. Without a body match, it previews the latest visible message.
func SessionSearchPreview(messages []MessageView, query string) string {
	query = strings.ToLower(strings.Join(strings.Fields(query), " "))
	var latest string
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		if message.Role != "user" && message.Role != "assistant" {
			continue
		}
		content := strings.Join(strings.Fields(message.Content), " ")
		if content == "" {
			continue
		}
		if query == "" {
			return sessionSearchExcerpt(content, 0)
		}
		if latest == "" {
			latest = content
		}
		lowerContent := strings.ToLower(content)
		if match := strings.Index(lowerContent, query); match >= 0 {
			return sessionSearchExcerpt(content, utf8.RuneCountInString(lowerContent[:match]))
		}
	}
	return sessionSearchExcerpt(latest, 0)
}

func sessionSearchExcerpt(content string, match int) string {
	const limit = 180
	runes := []rune(content)
	start := max(0, match-48)
	end := min(len(runes), start+limit)
	excerpt := string(runes[start:end])
	if start > 0 {
		excerpt = "…" + excerpt
	}
	if end < len(runes) {
		excerpt += "…"
	}
	return excerpt
}
