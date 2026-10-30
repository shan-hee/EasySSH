package runtime

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/resultstore"
	"time"

	"github.com/google/uuid"
)

func (m *Manager) WithSyncSession(owner uuid.UUID, id string, fn func() error) error {
	if err := m.beginOperation(); err != nil {
		return err
	}
	defer m.endOperation()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	actor := protocol.Actor{Kind: protocol.Owner, ID: owner.String(), SessionID: "sync-import"}
	s, unlock := m.lockSessionStorage(id)
	defer unlock()
	if s != nil {
		if !sameConversationActor(s.actor, actor) {
			return ErrSessionNotFound
		}
		if s.processing || s.activeToolRuns > 0 {
			if s.storageErr != nil {
				return s.storageErr
			}
			return ErrSessionBusy
		}
		if s.storageErr != nil {
			m.discardSessionLocked(s)
			s = nil
		} else if s.status == SessionStatusWaitingConfirmation {
			return ErrSessionBusy
		}
	}
	if s == nil && m.store != nil {
		snapshot, err := m.store.Get(ctx, actor, id)
		if err != nil && !errors.Is(err, ErrSessionNotFound) {
			return err
		}
		if err == nil {
			if snapshot.Status == SessionStatusWaitingConfirmation {
				return ErrSessionBusy
			}
			// A persisted running session without a runtime has no active run
			// after restart. Apply the same recovery as opening that session,
			// under m.mu so a new run cannot start before the exchange finishes.
			if normalizeRestoredSnapshot(snapshot) {
				if err := persistSnapshot(ctx, m.store, *snapshot); err != nil {
					return err
				}
			}
		}
	}
	// Flush the in-memory revision while holding the same lock as edits. An
	// editor may have released m.mu just before its asynchronous store write.
	if s != nil && !s.closed && m.store != nil {
		if err := persistSnapshot(ctx, m.store, m.snapshotForPersistenceLocked(s)); err != nil {
			s.storageErr, s.halted = resultstore.ErrUnavailable, true
			if errors.Is(err, ErrSnapshotConflict) {
				s.storageErr = ErrSnapshotConflict
			}
			return err
		}
	}
	// The callback owns a transaction and may commit a newer version or delete
	// this conversation. Invalidate the already-flushed cache even on error:
	// an uncertain commit must not leave an editable stale runtime behind.
	err := fn()
	if s != nil {
		m.discardSessionLocked(s)
	}
	return err
}
