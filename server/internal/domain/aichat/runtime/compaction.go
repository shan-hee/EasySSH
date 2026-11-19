package runtime

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/easyssh/server/internal/domain/aichat/provider"
)

// CompactionSettings bound how much history is sent to the model. Older turns
// are replaced by a summary in the request only; stored history is unchanged.
type CompactionSettings struct {
	Enabled          bool
	ContextWindow    int // Tokens the configured model accepts.
	ThresholdPercent int // Compact once the request reaches this share of the window.
	KeepTurns        int // Most recent user turns always sent verbatim.
}

func (m *Manager) SetCompactionSettings(source func(context.Context) (CompactionSettings, error)) {
	m.compactionSettings = source
}

const (
	summaryMessageRunes = 4000
	summaryToolRunes    = 2000
	summaryPrompt       = `你负责压缩服务器运维助手的对话历史。请把给出的历史整理为一份摘要，供助手继续对话时代替原文使用。
要求：
- 保留用户的目标、约束和偏好，以及尚未完成的事项。
- 保留涉及的服务器（名称与 server_id）、执行过的命令或文件操作及其关键结果、错误和结论。
- 保留重要的数值、路径、配置项和版本号，不要编造原文没有的信息。
- 已有摘要中的信息仍然有效时要并入新摘要。
- 使用与对话相同的语言，按要点组织，不超过 1500 字，只输出摘要正文。`
)

// estimateTokens is a conservative count: ASCII text averages about four bytes
// per token, while CJK and other scripts take about one token per character.
func estimateTokens(messages []provider.Message) int {
	total := 0
	count := func(text string) {
		ascii, other := 0, 0
		for _, r := range text {
			if r < utf8.RuneSelf {
				ascii++
			} else {
				other++
			}
		}
		total += ascii/4 + other
	}
	for _, message := range messages {
		total += 4
		count(message.Content)
		for _, call := range message.ToolCalls {
			count(call.Name)
			count(string(call.Arguments))
		}
		total += 1000 * len(message.Attachments)
	}
	return total
}

func historyStartAfterTurns(messages []provider.Message, covered int) int {
	if covered == 0 {
		return 0
	}
	seen := 0
	for index, message := range messages {
		if message.Role == "user" {
			seen++
			if seen == covered+1 {
				return index
			}
		}
	}
	return len(messages)
}

func countUsers(messages []provider.Message) int {
	count := 0
	for _, message := range messages {
		if message.Role == "user" {
			count++
		}
	}
	return count
}

// requestHistory is what the model sees: the summary joins the system prompt,
// followed by the turns it does not cover. Caller holds m.mu.
func (s *session) requestHistory(systemPrompt string, history []provider.Message) []provider.Message {
	if s.contextSummary != "" {
		systemPrompt += "\n\n较早的对话已压缩为以下摘要，请结合摘要和后续原文继续：\n" + s.contextSummary
		history = history[historyStartAfterTurns(history, s.contextSummaryTurns):]
	}
	messages := make([]provider.Message, 0, len(history)+2)
	messages = append(messages, provider.Message{Role: "system", Content: systemPrompt})
	return append(messages, history...)
}

// compactIfNeeded summarizes turns older than the kept tail once the request
// would reach the threshold. It returns false when it stopped the run.
func (m *Manager) compactIfNeeded(ctx context.Context, s *session, runID string, config provider.Config, model, systemPrompt string, charge func() error) bool {
	if m.compactionSettings == nil {
		return true
	}
	settings, err := m.compactionSettings(ctx)
	if err != nil {
		m.failSessionTurn(s, "config_error", err.Error(), runID)
		return false
	}
	if !settings.Enabled || settings.ContextWindow <= 0 {
		return true
	}
	m.mu.RLock()
	request := s.requestHistory(systemPrompt, s.messages)
	tokens := max(estimateTokens(request), s.lastInputTokens)
	previous, covered := s.contextSummary, s.contextSummaryTurns
	target := countUsers(s.messages) - max(settings.KeepTurns, 1)
	var compressed []provider.Message
	if target > covered {
		compressed = append(compressed, s.messages[historyStartAfterTurns(s.messages, covered):historyStartAfterTurns(s.messages, target)]...)
	}
	m.mu.RUnlock()
	if tokens*100 < settings.ContextWindow*settings.ThresholdPercent || len(compressed) == 0 {
		return true
	}
	if err := charge(); err != nil {
		m.failSessionTurn(s, "ai_quota_unavailable", err.Error(), runID)
		return false
	}
	result, err := m.factory.StreamTurn(ctx, config, provider.TurnRequest{Model: model, Messages: []provider.Message{
		{Role: "system", Content: summaryPrompt},
		{Role: "user", Content: summaryInput(previous, compressed)},
	}}, func(provider.Event) error { return nil })
	if err != nil {
		if ctx.Err() != nil {
			m.markInterrupted(s, runID)
			m.completeTurn(s, false, runID)
			return false
		}
		m.failSessionTurn(s, "context_compaction_failed", "上下文压缩失败："+err.Error(), runID)
		return false
	}
	summary := strings.TrimSpace(result.Content)
	if summary == "" {
		m.failSessionTurn(s, "context_compaction_failed", "上下文压缩失败：模型未返回摘要", runID)
		return false
	}
	m.mu.Lock()
	// An edit during summarization changes what the summary would cover.
	if s.currentRunID != runID || s.contextSummaryTurns != covered || s.contextSummary != previous {
		current := s.currentRunID == runID
		m.mu.Unlock()
		return current
	}
	s.contextSummary, s.contextSummaryTurns, s.lastInputTokens = summary, target, 0
	snapshot := m.snapshotForPersistenceLocked(s)
	m.mu.Unlock()
	if err := m.saveSnapshot(ctx, snapshot); err != nil {
		m.failSessionTurn(s, "storage_error", err.Error(), runID)
		return false
	}
	return true
}

func summaryInput(previous string, messages []provider.Message) string {
	var sb strings.Builder
	if previous != "" {
		sb.WriteString("已有摘要：\n")
		sb.WriteString(previous)
		sb.WriteString("\n\n")
	}
	sb.WriteString("需要并入摘要的后续对话：\n")
	clip := func(text string, limit int) string {
		if runes := []rune(text); len(runes) > limit {
			return string(runes[:limit]) + "…（已截断）"
		}
		return text
	}
	for _, message := range messages {
		switch message.Role {
		case "user":
			fmt.Fprintf(&sb, "\n[用户] %s", clip(message.Content, summaryMessageRunes))
			if len(message.Attachments) != 0 {
				fmt.Fprintf(&sb, "（附件 %d 个）", len(message.Attachments))
			}
		case "assistant":
			if message.Content != "" {
				fmt.Fprintf(&sb, "\n[助手] %s", clip(message.Content, summaryMessageRunes))
			}
			for _, call := range message.ToolCalls {
				fmt.Fprintf(&sb, "\n[调用工具 %s] %s", call.Name, clip(string(call.Arguments), summaryToolRunes))
			}
		case "tool":
			fmt.Fprintf(&sb, "\n[工具结果] %s", clip(message.Content, summaryToolRunes))
		}
	}
	return sb.String()
}

// invalidateSummaryFrom drops the summary when a user turn it covers changes.
func (s *session) invalidateSummaryFrom(userTurn int) {
	if userTurn <= s.contextSummaryTurns {
		s.contextSummary, s.contextSummaryTurns = "", 0
	}
	s.lastInputTokens = 0
}
