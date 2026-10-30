package access

import (
	"context"
	"errors"
	"io"
	"sync"
)

// ByteAllocator reserves quota across sessions. A nil settlement means that
// this direction has no quota; the caller then stops metering this stream.
// A settlement retains consumed bytes and refunds only the unused reservation.
type ByteAllocator interface {
	CheckBytes(context.Context, Scope, Requirement, int64) error
	ReserveBytes(context.Context, Scope, Requirement, int) (int, func(int) error, error)
}

// CheckBytes rejects work that already exceeds the current budget. It is only
// an admission check: actual delivery still reserves bytes to arbitrate races.
func (s Scope) CheckBytes(ctx context.Context, req Requirement, amount int64) error {
	if amount < 0 {
		return ErrForbidden
	}
	if err := s.Check(ctx, req); err != nil {
		return err
	}
	if s.IsOwner() {
		return nil
	}
	return s.authorizer.CheckBytes(ctx, s, req, amount)
}

const ByteReservationSize = 4 << 20

type byteMeter struct {
	mu        sync.Mutex
	ctx       context.Context
	scope     Scope
	req       Requirement
	allocator ByteAllocator
	started   bool
	unlimited bool
	reserved  int
	consumed  int
	settle    func(int) error
	closed    bool
	closeErr  error
}

func (m *byteMeter) available() (int, error) {
	if m.closed {
		return 0, io.ErrClosedPipe
	}
	if err := m.ctx.Err(); err != nil {
		return 0, err
	}
	if !m.started {
		// Admission is checked once. Active leases and revocation cancellation
		// protect the stream; individual buffers must never re-query authority.
		if err := m.scope.Check(m.ctx, m.req); err != nil {
			return 0, err
		}
		m.allocator = m.scope.authorizer
		m.started = true
	}
	if m.unlimited {
		return ByteReservationSize, nil
	}
	if m.consumed < m.reserved {
		return m.reserved - m.consumed, nil
	}
	if m.settle != nil {
		if err := m.settle(m.consumed); err != nil {
			return 0, err
		}
		m.settle = nil
	}
	reserved, settle, err := m.allocator.ReserveBytes(m.ctx, m.scope, m.req, ByteReservationSize)
	if err != nil {
		return 0, err
	}
	if reserved <= 0 || reserved > ByteReservationSize {
		return 0, ErrForbidden
	}
	m.reserved, m.consumed, m.settle = reserved, 0, settle
	m.unlimited = settle == nil
	return reserved, nil
}

// finish is idempotent and does not close the underlying stream. Each caller
// settles before recording success, including short reads and canceled copies.
func (m *byteMeter) finish() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.finishLocked()
}

func (m *byteMeter) finishLocked() error {
	if m.closed {
		return m.closeErr
	}
	m.closed = true
	if m.settle != nil {
		m.closeErr = m.settle(m.consumed)
	}
	return m.closeErr
}

type meteredReader struct {
	meter  *byteMeter
	reader io.Reader
}

func MeterReader(ctx context.Context, req Requirement, reader io.Reader) (io.Reader, func() error) {
	scope := Current(ctx)
	if scope.IsOwner() {
		return reader, func() error { return nil }
	}
	meter := &byteMeter{ctx: ctx, scope: scope, req: req}
	return &meteredReader{meter: meter, reader: reader}, meter.finish
}
func (r *meteredReader) Read(p []byte) (int, error) {
	r.meter.mu.Lock()
	defer r.meter.mu.Unlock()
	if len(p) == 0 {
		return 0, nil
	}
	size, err := r.meter.available()
	if err != nil {
		return 0, err
	}
	n, err := r.reader.Read(p[:min(len(p), size)])
	if !r.meter.unlimited {
		r.meter.consumed += n
	}
	return n, err
}

type meteredWriter struct {
	meter  *byteMeter
	writer io.Writer
}

func MeterWriter(ctx context.Context, req Requirement, writer io.Writer) (io.Writer, func() error) {
	scope := Current(ctx)
	if scope.IsOwner() {
		return writer, func() error { return nil }
	}
	meter := &byteMeter{ctx: ctx, scope: scope, req: req}
	return &meteredWriter{meter: meter, writer: writer}, meter.finish
}
func (w *meteredWriter) Write(p []byte) (int, error) {
	w.meter.mu.Lock()
	defer w.meter.mu.Unlock()
	total := 0
	for len(p) > 0 {
		available, err := w.meter.available()
		if err != nil {
			return total, err
		}
		size := min(len(p), available)
		n, err := w.writer.Write(p[:size])
		if !w.meter.unlimited {
			w.meter.consumed += n
		}
		total += n
		if n < size && err == nil {
			err = io.ErrShortWrite
		}
		if err != nil {
			return total, errors.Join(err, w.meter.finishLocked())
		}
		p = p[n:]
	}
	return total, nil
}
