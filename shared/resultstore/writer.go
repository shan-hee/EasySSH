// Package resultstore persists observed results. Storage callbacks must be
// idempotent and must never contain a remote operation or an execution retry.
package resultstore

import (
	"context"
	"errors"
	"fmt"
	"time"
)

var ErrUnavailable = errors.New("result storage unavailable")

type permanentError struct{ error }

func (e permanentError) Unwrap() error { return e.error }

// Permanent stops retries for a violated invariant or an immutable conflict.
func Permanent(err error) error {
	if err == nil {
		return nil
	}
	return permanentError{err}
}

// Write commits an already observed result with bounded exponential backoff.
// Request cancellation must not discard the result of an operation that already
// ran. A persistent outage is reported after 30 seconds; the durable intent is
// then reconciled at startup, never replayed from an in-memory receipt queue.
func Write(request context.Context, save func(context.Context) error) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(request), 30*time.Second)
	defer cancel()
	delay := 100 * time.Millisecond
	var last error
	for {
		if ctx.Err() != nil {
			return fmt.Errorf("%w: %v", ErrUnavailable, last)
		}
		attempt, end := context.WithTimeout(ctx, 5*time.Second)
		last = save(attempt)
		end()
		if last == nil {
			return nil
		}
		var permanent permanentError
		if errors.As(last, &permanent) {
			return permanent.error
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return fmt.Errorf("%w: %v", ErrUnavailable, last)
		case <-timer.C:
		}
		delay = min(delay*2, 3*time.Second)
	}
}
