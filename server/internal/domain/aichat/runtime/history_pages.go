package runtime

import (
	"context"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/protocol"
)

func (m *Manager) GetOverview(ctx context.Context, id string) (*protocol.AISessionOverview, error) {
	if err := m.beginOperation(); err != nil {
		return nil, err
	}
	defer m.endOperation()
	s, err := m.getOrRestoreSession(ctx, id)
	if err != nil {
		return nil, err
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	return &protocol.AISessionOverview{Actor: s.actor, Title: s.title, ID: s.id, Model: s.model, PermissionMode: s.permissionMode, Scope: s.scope, Status: s.status, CreatedAt: s.createdAt, UpdatedAt: s.updatedAt, MessageCount: len(s.messageViews), TaskCount: len(s.taskOrder), AvailableTools: buildToolViews(m.visibleToolsForSessionLocked(s)), DefaultTransport: TransportAISDKUI}, nil
}
func (m *Manager) History(ctx context.Context, id string, input protocol.AIHistoryInput) (protocol.AIHistoryPage, error) {
	input, err := aiwire.NormalizeHistoryInput(input)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	if err := m.beginOperation(); err != nil {
		return protocol.AIHistoryPage{}, err
	}
	defer m.endOperation()
	actor, err := access.RequireAIActor(ctx)
	if err != nil {
		return protocol.AIHistoryPage{}, err
	}
	m.mu.RLock()
	s := m.sessions[id]
	if s != nil && !sameConversationActor(s.actor, actor) {
		m.mu.RUnlock()
		return protocol.AIHistoryPage{}, ErrSessionNotFound
	}
	if s != nil && s.storageErr != nil {
		m.mu.RUnlock()
		// Only a failed runtime needs full recovery. Ordinary history never
		// restores a conversation or allocates model context into the cache.
		if _, err := m.getOrRestoreSession(ctx, id); err != nil {
			return protocol.AIHistoryPage{}, err
		}
		m.mu.RLock()
		s = m.sessions[id]
		if s != nil && !sameConversationActor(s.actor, actor) {
			m.mu.RUnlock()
			return protocol.AIHistoryPage{}, ErrSessionNotFound
		}
	}
	if s == nil || m.store != nil {
		store := m.store
		m.mu.RUnlock()
		if store == nil {
			return protocol.AIHistoryPage{}, ErrSessionNotFound
		}
		return store.History(ctx, actor, id, input)
	}
	defer m.mu.RUnlock()
	ids := s.taskOrder
	read := func(i int) (any, error) {
		task := s.tasks[ids[i]]
		if task == nil {
			return nil, ErrTaskNotFound
		}
		return task.view.Public(), nil
	}
	if input.Kind == "messages" {
		ids = make([]string, len(s.messageViews))
		for i, message := range s.messageViews {
			ids[i] = message.ID
		}
		read = func(i int) (any, error) { return s.messageViews[i], nil }
	}
	return aiwire.BuildHistoryPage(s.id, s.updatedAt, input, ids, read)
}
