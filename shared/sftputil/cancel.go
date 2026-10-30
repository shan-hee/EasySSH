package sftputil

import (
	"context"
	"sync"
)

// CloseOnCancel closes the caller-owned channel or transport on cancellation.
// The returned idempotent function waits for an already-started callback before
// ownership can be transferred or the channel can return to a pool.
func CloseOnCancel(ctx context.Context, closeChannel func() error) func() {
	done := make(chan struct{})
	stop := context.AfterFunc(ctx, func() {
		defer close(done)
		_ = closeChannel()
	})
	var once sync.Once
	return func() {
		once.Do(func() {
			if !stop() {
				<-done
			}
		})
	}
}
