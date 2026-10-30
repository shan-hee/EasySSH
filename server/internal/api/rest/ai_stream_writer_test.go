package rest

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
	"sync"
	"testing"
	"time"
)

type aiDeadlineTestWriter struct {
	mu              sync.Mutex
	deadline        time.Time
	writes          int
	flushError      error
	deadlineChanged chan struct{}
}

func (w *aiDeadlineTestWriter) Header() http.Header { return http.Header{} }
func (w *aiDeadlineTestWriter) WriteHeader(int)     {}
func (w *aiDeadlineTestWriter) Write(b []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.writes++
	return len(b), nil
}
func (w *aiDeadlineTestWriter) FlushError() error { return w.flushError }
func (w *aiDeadlineTestWriter) SetWriteDeadline(value time.Time) error {
	w.mu.Lock()
	w.deadline = value
	w.mu.Unlock()
	if w.deadlineChanged != nil {
		select {
		case w.deadlineChanged <- struct{}{}:
		default:
		}
	}
	return nil
}

func TestAIStreamDeadlineCancellationAndFlushFailure(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	raw := &aiDeadlineTestWriter{deadlineChanged: make(chan struct{}, 2)}
	writer, stop := newAIStreamWriter(ctx, raw)
	defer stop()
	started := time.Now()
	if _, err := writer.Write([]byte("frame")); err != nil {
		t.Fatal(err)
	}
	raw.mu.Lock()
	deadline := raw.deadline
	raw.mu.Unlock()
	if deadline.Before(started) || deadline.After(time.Now().Add(aiStreamWriteTimeout)) {
		t.Fatal("write is not bounded")
	}
	<-raw.deadlineChanged
	raw.flushError = errors.New("broken pipe")
	if err := writer.FlushError(); !errors.Is(err, raw.flushError) {
		t.Fatal("flush failure ignored")
	}
	<-raw.deadlineChanged
	cancel()
	select {
	case <-raw.deadlineChanged:
	case <-time.After(time.Second):
		t.Fatal("cancellation did not interrupt pending write")
	}
	if _, err := writer.Write([]byte("late frame")); !errors.Is(err, context.Canceled) {
		t.Fatal("write extended canceled request", err)
	}
	raw.mu.Lock()
	defer raw.mu.Unlock()
	if raw.writes != 1 || raw.deadline.After(time.Now()) {
		t.Fatal("canceled stream resumed")
	}
}

func TestAIStreamPropagatesUnderlyingGinFlushError(t *testing.T) {
	expected := errors.New("connection closed")
	raw := &aiDeadlineTestWriter{flushError: expected}
	ctx, _ := gin.CreateTestContext(raw)
	writer, stop := newAIStreamWriter(context.Background(), ctx.Writer)
	defer stop()
	if err := writer.FlushError(); !errors.Is(err, expected) {
		t.Fatalf("Gin hid flush error: %v", err)
	}
}
