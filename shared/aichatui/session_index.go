package aichatui

import (
	"errors"
	"strings"
)

// SessionSearchIndex is derived from visible text only. Binary attachments,
// provider messages, tool payloads and JSON field names are not search content.
// Text is newest first, so a search preview starts at the latest matching text.
type SessionSearchIndex struct {
	Text    string
	Folded  string
	Preview string
}

const MaxSessionSearchBytes = 512

var ErrSessionSearchTooLong = errors.New("ai_search_too_long")

func NormalizeSessionSearch(query string) string {
	return strings.ToLower(strings.Join(strings.Fields(query), " "))
}
func BuildSessionSearchIndex(messages []MessageView) SessionSearchIndex {
	var text strings.Builder
	preview := ""
	for i := len(messages) - 1; i >= 0; i-- {
		message := messages[i]
		if message.Role != "user" && message.Role != "assistant" {
			continue
		}
		content := strings.Join(strings.Fields(message.Content), " ")
		if content == "" {
			continue
		}
		if preview == "" {
			preview = sessionSearchExcerpt(content, 0)
		}
		if text.Len() > 0 {
			text.WriteString("\n\n")
		}
		text.WriteString(content)
	}
	value := text.String()
	return SessionSearchIndex{Text: value, Folded: strings.ToLower(value), Preview: preview}
}

// SessionSearchPattern treats SQL wildcard characters as literal search text.
func SessionSearchPattern(query string) string {
	return "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(NormalizeSessionSearch(query)) + "%"
}
