package sftputil

import "context"

// CloseOnCancel closes only the borrowed SFTP channel. The returned function
// waits for an already-started callback before the channel can return to a pool.
func CloseOnCancel(ctx context.Context, closeChannel func() error) func() {
	done := make(chan struct{})
	stop := context.AfterFunc(ctx, func() {
		defer close(done)
		_ = closeChannel()
	})
	return func() {
		if !stop() {
			<-done
		}
	}
}
