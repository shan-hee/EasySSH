package transferjob

import (
	"context"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"io"
	"os"
	"sync"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/systemconfig"
)

// ConfigureStorage never strands managed artifacts in an unaccounted old root.
// Limits may change while transfers run, but changing the root requires an idle,
// empty store. Moving existing artifacts is a separate explicit operation.
func (s *service) ConfigureStorage(ctx context.Context, cfg *systemconfig.SystemConfig) error {
	ctx, done, err := s.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer done()
	if err := access.Current(ctx).RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	if cfg == nil {
		return ErrInvalidJobRequest
	}
	current, err := s.config(ctx)
	if err != nil {
		return err
	}
	changed := s.storageRoot(current) != s.storageRoot(cfg)
	if changed {
		if !s.storageMu.TryLock() {
			return fmt.Errorf("%w: wait for active transfers and backups before changing storage root", ErrArtifactInUse)
		}
		defer s.storageMu.Unlock()
	} else {
		if !s.storageMu.TryRLock() {
			return ErrArtifactInUse
		}
		defer s.storageMu.RUnlock()
	}
	current, err = s.config(ctx)
	if err != nil {
		return err
	}
	if s.storageRoot(current) != s.storageRoot(cfg) {
		if !changed {
			return fmt.Errorf("%w: storage configuration changed; reload before saving", ErrArtifactInUse)
		}
		entries, err := os.ReadDir(s.storageRoot(current))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if len(entries) != 0 {
			return fmt.Errorf("%w: clear the current artifact directory before changing its root", ErrArtifactInUse)
		}
	}
	return s.systemConfig.SaveFileTransfer(ctx, cfg)
}

// A reservation includes bytes not written yet. Writes and new reservations
// share a lock, so a disk scan cannot observe written bytes before their
// reservation has been settled, or miss both the reservation and the write.
type storageBudget struct {
	mu       sync.Mutex
	reserved int64
}

type storageReservation struct {
	budget    *storageBudget
	remaining int64
	closed    bool
}

func (s *service) reserveStorage(cfg *systemconfig.SystemConfig, size int64, upload bool) (*storageReservation, error) {
	if size < 0 {
		return nil, fmt.Errorf("%w: file_size must be specified and non-negative", ErrInvalidJobRequest)
	}
	if upload && cfg.MaxFileUploadSize > 0 && size > int64(cfg.MaxFileUploadSize)<<20 {
		return nil, fmt.Errorf("%w: file exceeds configured upload limit", ErrInvalidJobRequest)
	}
	s.budget.mu.Lock()
	defer s.budget.mu.Unlock()
	used, err := dirSize(s.storageRoot(cfg))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	limit := int64(cfg.TransferMaxStorageGB) << 30
	if limit <= 0 || size > limit || used > limit-size || s.budget.reserved > limit-size-used {
		return nil, fmt.Errorf("transfer storage quota exceeded")
	}
	s.budget.reserved += size
	return &storageReservation{budget: &s.budget, remaining: size}, nil
}

func (r *storageReservation) Close() {
	r.budget.mu.Lock()
	defer r.budget.mu.Unlock()
	if !r.closed {
		r.budget.reserved -= r.remaining
		r.remaining = 0
		r.closed = true
	}
}

func (r *storageReservation) Writer(writer io.Writer) io.Writer {
	return reservedStorageWriter{reservation: r, writer: writer}
}

type reservedStorageWriter struct {
	reservation *storageReservation
	writer      io.Writer
}

func (w reservedStorageWriter) Write(p []byte) (int, error) {
	r := w.reservation
	r.budget.mu.Lock()
	defer r.budget.mu.Unlock()
	if r.closed {
		return 0, os.ErrClosed
	}
	if int64(len(p)) > r.remaining {
		return 0, fmt.Errorf("file exceeds reserved size")
	}
	n, err := w.writer.Write(p)
	r.remaining -= int64(n)
	r.budget.reserved -= int64(n)
	return n, err
}
