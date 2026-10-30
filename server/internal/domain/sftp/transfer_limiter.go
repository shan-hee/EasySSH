package sftp

import (
	"context"
	"sync"

	"github.com/easyssh/server/internal/access"
)

// TransferLimiter is shared by all file-transfer entry points in this instance.
// It limits executing transfers, independently of visitor connection quotas.
type TransferLimiter struct {
	mu            sync.Mutex
	active, limit int
	changed       chan struct{}
}

func NewTransferLimiter(limit int) *TransferLimiter {
	return &TransferLimiter{limit: max(1, limit), changed: make(chan struct{})}
}

func (l *TransferLimiter) SetLimit(limit int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.limit = max(1, limit)
	l.notify()
}

func (l *TransferLimiter) notify() { close(l.changed); l.changed = make(chan struct{}) }

// Acquire returns an idempotent release. Interactive streams do not queue a
// body in memory; persisted background jobs may wait with their execution ctx.
func (l *TransferLimiter) Acquire(ctx context.Context, wait bool) (func(), error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		l.mu.Lock()
		if l.active < l.limit {
			l.active++
			l.mu.Unlock()
			var once sync.Once
			return func() { once.Do(func() { l.mu.Lock(); l.active--; l.notify(); l.mu.Unlock() }) }, nil
		}
		changed := l.changed
		l.mu.Unlock()
		if !wait {
			return nil, access.ErrCapacity
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-changed:
		}
	}
}
