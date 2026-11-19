package chatbridge

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/easyssh/server/internal/domain/aichat/runtime"
	"github.com/easyssh/shared/aichatui"
	"gorm.io/gorm"
)

const maxSystemPromptRunes = 4000

// The web editor's server mention token, shared with the AI assistant composer.
var promptServerToken = regexp.MustCompile(`:server\[([^\]\n]+)\]\{name=([^}\n]+)\}`)

// parsePrompt turns stored tokens into "@label" text and ID-bound references.
func parsePrompt(prompt string) (string, []aichatui.ServerReference, error) {
	var text strings.Builder
	var refs []aichatui.ServerReference
	last := 0
	for _, match := range promptServerToken.FindAllStringSubmatchIndex(prompt, -1) {
		label, err := url.PathUnescape(prompt[match[2]:match[3]])
		if err != nil {
			return "", nil, invalid("系统提示词中的服务器引用无效")
		}
		id, err := url.PathUnescape(prompt[match[4]:match[5]])
		if err != nil {
			return "", nil, invalid("系统提示词中的服务器引用无效")
		}
		text.WriteString(prompt[last:match[0]])
		refs = append(refs, aichatui.ServerReference{ServerID: id, Label: label, Offset: utf8.RuneCountInString(text.String())})
		text.WriteString("@" + label)
		last = match[1]
	}
	text.WriteString(prompt[last:])
	return text.String(), refs, nil
}

func validatePrompt(prompt string, serverIDs []string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	text, refs, err := parsePrompt(prompt)
	if err != nil {
		return "", err
	}
	if utf8.RuneCountInString(text) > maxSystemPromptRunes {
		return "", invalid("系统提示词最多 4000 字")
	}
	for _, ref := range refs {
		if !slices.Contains(serverIDs, ref.ServerID) {
			return "", invalid("系统提示词引用了未授权的服务器 @" + ref.Label)
		}
	}
	return prompt, nil
}

// SessionInstructions supplies a bound session's system prompt to the Agent
// runtime. Sessions not started from a chat binding have none.
func (s *Service) SessionInstructions(ctx context.Context, sessionID string) (runtime.Instructions, error) {
	var c Connection
	err := s.db.WithContext(ctx).Table("chat_connections AS c").Select("c.*").
		Joins("JOIN chat_bindings AS b ON b.connection_id = c.id").
		Where("b.current_session_id = ? AND b.revoked_at IS NULL", sessionID).Take(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return runtime.Instructions{}, nil
	}
	if err != nil {
		return runtime.Instructions{}, err
	}
	var serverIDs []string
	if err := json.Unmarshal([]byte(c.ServerIDsJSON), &serverIDs); err != nil {
		return runtime.Instructions{}, err
	}
	// Re-validate: the stored prompt must still match the connection's scope.
	prompt, err := validatePrompt(c.SystemPrompt, serverIDs)
	if err != nil {
		return runtime.Instructions{}, err
	}
	text, refs, err := parsePrompt(prompt)
	return runtime.Instructions{Text: text, ServerReferences: refs}, err
}
