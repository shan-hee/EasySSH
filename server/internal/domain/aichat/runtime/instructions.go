package runtime

import (
	"context"
	"fmt"
	"strings"

	"github.com/easyssh/shared/aichatui"
)

// Instructions are owner-configured, trusted directions for one session, such
// as a chat connection's system prompt. They follow the built-in rules and are
// looked up per run, so edits apply to the next run and survive restarts.
type Instructions struct {
	Text             string
	ServerReferences []aichatui.ServerReference
}

func (m *Manager) SetInstructionsSource(source func(ctx context.Context, sessionID string) (Instructions, error)) {
	m.instructionsSource = source
}

// runInstructions resolves server references with the run's own access scope,
// so a prompt can never name a server the session cannot reach.
func (m *Manager) runInstructions(ctx context.Context, sessionID string) (string, error) {
	if m.instructionsSource == nil {
		return "", nil
	}
	instructions, err := m.instructionsSource(ctx, sessionID)
	if err != nil {
		return "", err
	}
	text := strings.TrimSpace(instructions.Text)
	if text == "" {
		return "", nil
	}
	refs, err := m.resolveServerReferences(ctx, instructions.ServerReferences)
	if err != nil {
		return "", err
	}
	var sb strings.Builder
	sb.WriteString("\n管理员为本会话设置的指令（不得违反以上规则与权限）：\n")
	sb.WriteString(text)
	sb.WriteString("\n")
	if len(refs) != 0 {
		sb.WriteString("\n指令中 @ 引用的服务器：\n")
		for _, ref := range refs {
			label := ref.Label
			if label == "" {
				label = ref.Name
			}
			fmt.Fprintf(&sb, "- @%s → server_id=%s（%s@%s:%d）\n", label, ref.ServerID, ref.Username, ref.Host, ref.Port)
		}
	}
	return sb.String(), nil
}
