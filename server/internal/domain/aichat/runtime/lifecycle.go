package runtime

import (
	"context"
	"errors"
	"time"

	"github.com/easyssh/shared/aiprovider"
)

var ErrManagerStopped = errors.New("ai_runtime_stopped")

const maxRuntimeOperations = 128

// Admission and the transition to stopping share m.mu. No positive Add can
// occur after Wait starts from zero; a handler owns its slot until dispatch.
func (m *Manager) beginOperation() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stopping {
		return ErrManagerStopped
	}
	if m.requests >= maxRuntimeOperations {
		return ErrSessionBusy
	}
	m.requests++
	m.operations.Add(1)
	return nil
}

func (m *Manager) endOperation() {
	m.mu.Lock()
	m.requests--
	m.mu.Unlock()
	m.operations.Done()
}

func (m *Manager) reserveRunsLocked(count int) error {
	if m.stopping {
		return ErrManagerStopped
	}
	if m.activeRuns+count > maxRuntimeOperations {
		return ErrSessionBusy
	}
	m.activeRuns += count
	m.operations.Add(count)
	return nil
}

func (m *Manager) finishRun() {
	m.mu.Lock()
	m.activeRuns--
	m.mu.Unlock()
	m.operations.Done()
}

func (m *Manager) newRunContext(parent context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), aiprovider.AutomaticRunTimeout)
	stop := context.AfterFunc(m.lifetime, cancel)
	if m.lifetime.Err() != nil {
		cancel()
	}
	return ctx, func() { stop(); cancel() }
}

// Stop stops admission immediately, cancels execution, and waits for actual
// results before the final persistence pass. A timed-out caller may call Stop
// again; it never starts another shutdown or repeats a remote operation.
func (m *Manager) Stop(ctx context.Context) error {
	m.stopOnce.Do(func() {
		m.mu.Lock()
		m.stopping = true
		m.cancelLifetime()
		for _, s := range m.sessions {
			s.halted = true
			if s.currentRun != nil {
				s.currentRun()
			}
			if s.toolRunCancel != nil {
				s.toolRunCancel()
			}
		}
		m.mu.Unlock()
		go m.finishShutdown()
	})
	select {
	case <-m.stopped:
		return m.stopErr
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *Manager) finishShutdown() {
	m.maintenance.Wait()
	m.operations.Wait()
	m.mu.Lock()
	snapshots := make([]SessionSnapshot, 0, len(m.sessions))
	for _, s := range m.sessions {
		if s.closed {
			continue
		}
		if s.storageErr != nil {
			m.stopErr = errors.Join(m.stopErr, s.storageErr)
			continue
		}
		if s.hasPendingConfirmation() {
			m.cancelActiveTasksLocked(s, time.Now())
			s.status, s.updatedAt = SessionStatusIdle, time.Now()
		}
		snapshots = append(snapshots, m.snapshotForPersistenceLocked(s))
	}
	m.mu.Unlock()
	for _, snapshot := range snapshots {
		if err := m.saveSnapshot(context.Background(), snapshot); err != nil {
			m.stopErr = errors.Join(m.stopErr, err)
		}
	}
	m.mu.Lock()
	for _, s := range m.sessions {
		for id, ch := range s.subscribers {
			delete(s.subscribers, id)
			close(ch)
		}
	}
	m.mu.Unlock()
	close(m.stopped)
}
