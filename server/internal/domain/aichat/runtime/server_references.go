package runtime

import (
	"context"
	"fmt"

	"github.com/easyssh/shared/aichatui"
	"github.com/google/uuid"
)

func (m *Manager) SetServerReferenceResolver(resolve func(context.Context, uuid.UUID, []aichatui.ServerReference) ([]aichatui.ServerReference, error)) {
	m.serverReferenceResolver = resolve
}

func (m *Manager) resolveServerReferences(ctx context.Context, userID uuid.UUID, refs []aichatui.ServerReference) ([]aichatui.ServerReference, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	if m.serverReferenceResolver == nil {
		return nil, fmt.Errorf("服务器引用解析服务不可用")
	}
	return m.serverReferenceResolver(ctx, userID, refs)
}

func (m *Manager) refreshRunServerReferences(ctx context.Context, s *session, runID string) error {
	m.mu.RLock()
	index := -1
	for i := len(s.messageViews) - 1; i >= 0; i-- {
		if s.messageViews[i].Role == "user" {
			index = i
			break
		}
	}
	var refs []aichatui.ServerReference
	if index >= 0 {
		refs = append(refs, s.messageViews[index].ServerReferences...)
	}
	m.mu.RUnlock()
	if len(refs) == 0 {
		return nil
	}
	resolved, err := m.resolveServerReferences(ctx, s.userID, refs)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if s.closed || s.currentRunID != runID {
		return context.Canceled
	}
	s.messageViews[index].ServerReferences = resolved
	s.updateProviderMessageContentForVisibleMessage(index+1, aichatui.ContentWithServerReferences(s.messageViews[index].Content, resolved))
	if len(resolved) == 1 {
		ref := resolved[0]
		s.scope = SessionScope{Kind: "terminal", ServerID: ref.ServerID, ServerName: ref.Name, Host: ref.Host, Port: ref.Port, Username: ref.Username}
	} else {
		s.scope = SessionScope{}
	}
	return nil
}
