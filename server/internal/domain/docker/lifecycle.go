package docker

import "context"

func (s *Service) Stop(ctx context.Context) error {
	s.stopOnce.Do(func() {
		s.mu.Lock()
		s.stopped = true
		for _, cancel := range s.active {
			cancel()
		}
		s.mu.Unlock()
		go func() { s.wg.Wait(); close(s.stoppedDone) }()
	})
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-s.stoppedDone:
		return s.stopErr
	}
}
