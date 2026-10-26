package aichatui

import "strings"

// SessionTitleFromContent derives an automatic title from a user message.
func SessionTitleFromContent(content string) string {
	title := strings.TrimSpace(content)
	if runes := []rune(title); len(runes) > 40 {
		return string(runes[:40]) + "…"
	}
	return title
}
