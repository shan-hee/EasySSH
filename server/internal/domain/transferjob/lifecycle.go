package transferjob

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/google/uuid"
)

func (s *service) beginOperation(ctx context.Context) (context.Context, func(), error) {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if s.stopped {
		return ctx, nil, errors.New("transfer service is stopping")
	}
	if len(s.operations) >= 256 {
		return ctx, nil, errors.New("transfer service is busy")
	}
	ctx, cancel := context.WithCancel(ctx)
	id := uuid.New()
	if s.operations == nil {
		s.operations = make(map[uuid.UUID]context.CancelFunc)
	}
	s.operations[id] = cancel
	s.workers.Add(1)
	return ctx, func() {
		cancel()
		s.lifecycleMu.Lock()
		delete(s.operations, id)
		s.lifecycleMu.Unlock()
		s.workers.Done()
	}, nil
}

func (s *service) StartMaintenance(ctx context.Context) {
	s.startOnce.Do(func() {
		ctx, done, err := s.beginOperation(ctx)
		if err != nil {
			return
		}
		go func() {
			defer done()
			retry := time.NewTicker(15 * time.Second)
			cleanup := time.NewTicker(time.Hour)
			defer retry.Stop()
			defer cleanup.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-retry.C:
					reconcileCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
					jobs, reconcileErr := s.repo.ReconcileDispatch(reconcileCtx)
					for _, job := range jobs {
						if err := s.syncTaskRun(reconcileCtx, job.ID); err != nil {
							reconcileErr = errors.Join(reconcileErr, err)
						}
					}
					cancel()
					if reconcileErr != nil && ctx.Err() == nil {
						log.Printf("[TransferJob] reconcile dispatch: %v", reconcileErr)
					}
				case <-cleanup.C:
					cleanupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
					s.cleanupExpired(cleanupCtx)
					cancel()
				}
			}
		}()
	})
}

func (s *service) Stop(ctx context.Context) error {
	s.stopOnce.Do(func() {
		s.lifecycleMu.Lock()
		s.stopped = true
		s.stopDone = make(chan struct{})
		for _, cancel := range s.operations {
			cancel()
		}
		s.lifecycleMu.Unlock()
		go func() {
			s.workers.Wait()
			close(s.stopDone)
		}()
	})
	select {
	case <-s.stopDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
