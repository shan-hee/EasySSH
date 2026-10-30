package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/resultstore"
	"github.com/google/uuid"
)

var ErrSnapshotConflict = errors.New("ai_snapshot_conflict")

// Only database persistence is retried. The captured value and execution facts
// are immutable across attempts; providers and tools never run in this callback.
func persistSnapshot(ctx context.Context, store SessionStore, snapshot SessionSnapshot) error {
	if store == nil {
		return nil
	}
	snapshot.runtimeSession = nil
	return resultstore.Write(ctx, func(attempt context.Context) error {
		err := store.Save(attempt, snapshot)
		if errors.Is(err, ErrSnapshotConflict) || errors.Is(err, ErrSessionBusy) || errors.Is(err, access.ErrUnauthenticated) {
			return resultstore.Permanent(err)
		}
		return err
	})
}

// Saves serialize per conversation, and always capture its current state. A
// delayed older caller cannot overwrite results already observed by a sibling.
func (m *Manager) saveSnapshot(ctx context.Context, requested SessionSnapshot) error {
	s, ok := m.getSessionByID(requested.ID)
	if !ok {
		return ErrSessionNotFound
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	m.mu.Lock()
	if m.sessions[s.id] != s || s.closed || requested.runtimeSession != s || !sameConversationActor(s.actor, requested.Actor) {
		m.mu.Unlock()
		return ErrSessionNotFound
	}
	if s.storageErr != nil {
		err := s.storageErr
		m.mu.Unlock()
		return err
	}
	s.saving = true
	defer func() { m.mu.Lock(); s.saving = false; m.mu.Unlock() }()
	snapshot := m.snapshotForPersistenceLocked(s)
	// Own nested messages, tool arguments and file artifacts across the DB write.
	encoded, err := json.Marshal(snapshot)
	store := m.store
	m.mu.Unlock()
	if err == nil {
		var owned SessionSnapshot
		err = json.Unmarshal(encoded, &owned)
		snapshot = owned
	}
	if err == nil {
		err = persistSnapshot(ctx, store, snapshot)
	}
	m.mu.Lock()
	if m.sessions[s.id] != s {
		m.mu.Unlock()
		return ErrSessionNotFound
	}
	if err != nil {
		s.storageErr = resultstore.ErrUnavailable
		if errors.Is(err, ErrSnapshotConflict) {
			s.storageErr = ErrSnapshotConflict
		}
		s.halted = true
		if s.currentRun != nil {
			s.currentRun()
		}
		if s.toolRunCancel != nil {
			s.toolRunCancel()
		}
		now := time.Now()
		m.cancelActiveTasksLocked(s, now)
		if !s.processing && s.activeToolRuns == 0 {
			s.status = SessionStatusIdle
		}
		s.updatedAt = now
		failure := s.storageErr
		code, message := "storage_unavailable", "存储暂时不可用，本轮已停止。"
		if errors.Is(failure, ErrSnapshotConflict) {
			code, message = "ai_snapshot_conflict", "会话已变化，本轮已停止；重新打开后以已保存内容为准。"
		}
		m.mu.Unlock()
		log.Printf("[AI] conversation persistence failed: session=%s error=%v", s.id, err)
		m.emitEvent(s, Event{ID: uuid.NewString(), Type: EventError, SessionID: s.id, CreatedAt: now,
			Error: &ErrorView{Code: code, Message: message, Retryable: false}})
		return failure
	}
	m.mu.Unlock()
	if store != nil {
		m.emitEvent(s, Event{ID: uuid.NewString(), Type: EventHistoryChanged, SessionID: snapshot.ID, CreatedAt: time.Now(), History: &protocol.AIHistoryChange{SessionID: snapshot.ID, UpdatedAt: snapshot.UpdatedAt}})
	}
	return nil
}

// Acquires the stable current session's persistence lock before the manager
// lock, shared by sync and deletion so neither can race an in-flight DB save.
func (m *Manager) lockSessionStorage(id string) (*session, func()) {
	for {
		m.mu.RLock()
		s := m.sessions[id]
		m.mu.RUnlock()
		if s != nil {
			s.persistMu.Lock()
		}
		m.mu.Lock()
		if m.sessions[id] != s {
			m.mu.Unlock()
			if s != nil {
				s.persistMu.Unlock()
			}
			continue
		}
		return s, func() {
			m.mu.Unlock()
			if s != nil {
				s.persistMu.Unlock()
			}
		}
	}
}

// A failed runtime is never a pending-result queue. Once its workers and save
// finish, reopen from the durable intent and normalize interrupted work.
// The caller holds m.mu and the session persistence lock.
func (m *Manager) discardSessionLocked(s *session) {
	s.closed = true
	delete(m.sessions, s.id)
	for id, ch := range s.subscribers {
		delete(s.subscribers, id)
		close(ch)
	}
}

// A request that failed before dispatch has no worker to finish its run.
func (m *Manager) stopUndispatchedRun(s *session, runID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s.currentRunID != runID {
		return
	}
	s.processing, s.status = false, SessionStatusIdle
	s.currentRunID, s.pendingContext = "", ""
	s.currentRun = nil
	s.updatedAt = time.Now()
}
