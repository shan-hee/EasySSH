package sftputil

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestCancellationStopIsIdempotentAfterOwnershipTransfer(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var calls atomic.Int32
	stop := CloseOnCancel(ctx, func() error { calls.Add(1); return nil })
	stop()
	done := make(chan struct{})
	go func() { stop(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("second stop waited for a callback that cannot run")
	}
	cancel()
	if calls.Load() != 0 {
		t.Fatal("transferred resource closed by old context")
	}
}

func TestCancellationStopWaitsForStartedClose(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started, release := make(chan struct{}), make(chan struct{})
	stop := CloseOnCancel(ctx, func() error { close(started); <-release; return nil })
	cancel()
	<-started
	done := make(chan struct{})
	go func() { stop(); stop(); close(done) }()
	select {
	case <-done:
		t.Fatal("resource transferred while close was still running")
	default:
	}
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("stop did not finish after close")
	}
}
