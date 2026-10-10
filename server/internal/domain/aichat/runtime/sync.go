package runtime

import (
	"context"
	"time"

	"github.com/google/uuid"
)

func (m *Manager) WithSyncSession(owner uuid.UUID, id string, fn func() error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.sessions[id]
	if s != nil {
		if s.userID != owner {
			return ErrSessionNotFound
		}
		if s.processing || s.activeToolRuns > 0 || s.status == SessionStatusWaitingConfirmation {
			return ErrSessionBusy
		}
	}
	// Flush the in-memory revision while holding the same lock as edits. An
	// editor may have released m.mu just before its asynchronous store write.
	if s != nil && !s.closed && m.store != nil {
		if err := m.store.Save(context.Background(), m.snapshotForPersistenceLocked(s)); err != nil {
			return err
		}
	}
	if err := fn(); err != nil {
		return err
	}
	if s != nil && m.store != nil {
		snapshot, err := m.store.Get(context.Background(), owner, id)
		if err == ErrSessionNotFound {
			s.closed = true
			s.status = SessionStatusClosed
			return nil
		}
		if err != nil {
			return err
		}
		if snapshot.UpdatedAt.After(s.updatedAt) {
			s.closed = false
			s.model = snapshot.Model
			s.title = snapshot.Title
			s.permissionMode = snapshot.PermissionMode
			s.scope = SessionScope{}
			s.pendingContext = ""
			s.status = snapshot.Status
			s.updatedAt = snapshot.UpdatedAt
			s.messages = snapshot.Messages
			s.messageViews = snapshot.MessageViews
			s.tasks = map[string]*taskState{}
			s.taskOrder = snapshot.TaskOrder
			for _, t := range snapshot.Tasks {
				s.tasks[t.View.ID] = &taskState{toolCall: t.ToolCall, view: t.View}
			}
			view := m.snapshotSessionLocked(s)
			m.emitToSubscribers(cloneSubscribersLocked(s), Event{ID: uuid.NewString(), Type: EventSessionUpdated, SessionID: s.id, CreatedAt: time.Now(), Session: &view})
		}
	}
	return nil
}
