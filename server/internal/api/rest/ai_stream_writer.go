package rest

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"
)

const aiStreamWriteTimeout = 10 * time.Second

// Deadline changes are serialized with cancellation: a concurrent write must
// never extend a deadline after the source request or access lease has ended.
type aiStreamWriter struct {
	writer     http.ResponseWriter
	controller *http.ResponseController
	ctx        context.Context
	mu         sync.Mutex
}

func newAIStreamWriter(ctx context.Context, writer http.ResponseWriter) (*aiStreamWriter, func()) {
	stream := &aiStreamWriter{writer: writer, controller: http.NewResponseController(writer), ctx: ctx}
	finished := make(chan struct{})
	stop := context.AfterFunc(ctx, func() {
		defer close(finished)
		stream.mu.Lock()
		defer stream.mu.Unlock()
		_ = stream.controller.SetWriteDeadline(time.Now())
	})
	return stream, func() {
		if !stop() {
			<-finished
		}
		_ = stream.controller.SetWriteDeadline(time.Time{})
	}
}
func (w *aiStreamWriter) Header() http.Header    { return w.writer.Header() }
func (w *aiStreamWriter) WriteHeader(status int) { w.writer.WriteHeader(status) }
func (w *aiStreamWriter) prepare() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.ctx.Err(); err != nil {
		return err
	}
	err := w.controller.SetWriteDeadline(time.Now().Add(aiStreamWriteTimeout))
	// In-memory recorders do not implement deadlines. Production net/http
	// writers do; errors from their actual writes and flushes still propagate.
	if errors.Is(err, http.ErrNotSupported) {
		return nil
	}
	return err
}
func (w *aiStreamWriter) Write(data []byte) (int, error) {
	if err := w.prepare(); err != nil {
		return 0, err
	}
	return w.writer.Write(data)
}
func (w *aiStreamWriter) FlushError() error {
	if err := w.prepare(); err != nil {
		return err
	}
	// Gin exposes Flush without an error result. Commit its pending header,
	// then flush the underlying writer so a broken connection is observable.
	if buffered, ok := w.writer.(interface {
		WriteHeaderNow()
		Unwrap() http.ResponseWriter
	}); ok {
		buffered.WriteHeaderNow()
		return http.NewResponseController(buffered.Unwrap()).Flush()
	}
	return w.controller.Flush()
}
func (w *aiStreamWriter) Flush() { _ = w.FlushError() }
