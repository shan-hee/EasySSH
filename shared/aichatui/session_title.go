package aichatui

import "strings"

// SessionTitleFromContent derives an automatic title from a user message.
func SessionTitleFromContent(content string) string {
	title := strings.TrimSpace(content)
	count := 0
	for offset := range title {
		if count == 40 {
			return title[:offset] + "…"
		}
		count++
	}
	return title
}

// SessionDisplayTitle keeps custom names separate from a title derived from the
// first nonempty user message; lists do not need the complete provider history.
func SessionDisplayTitle(custom string, messages []MessageView, fallback string) (string, bool) {
	if title := strings.TrimSpace(custom); title != "" {
		return title, true
	}
	for _, message := range messages {
		if message.Role == "user" {
			if title := SessionTitleFromContent(message.Content); title != "" {
				return title, false
			}
		}
	}
	return fallback, false
}
