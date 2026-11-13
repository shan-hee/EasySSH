// Package retention removes finished records once they are older than the
// period chosen in system settings. It is the only place that deletes records
// by age: each domain supplies how to delete, never when.
package retention

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	policy "github.com/easyssh/shared/retention"
)

const interval = 24 * time.Hour

// Policy is the number of days each category is kept; 0 keeps it forever.
type Policy struct {
	TaskDays int
	LogDays  int
}

type Result struct {
	Tasks int64
	Logs  int64
}

type Service struct {
	// Policy reads the current settings, so a change applies to the next run.
	Policy func(context.Context) (Policy, error)
	// Tasks and Logs remove records finished before the cutoff and report how many.
	Tasks func(context.Context, time.Time) (int64, error)
	Logs  func(context.Context, time.Time) (int64, error)
	// Content removes stored bodies that no remaining record refers to.
	Content func(context.Context) error

	running sync.Mutex
	mu      sync.Mutex
	cancel  context.CancelFunc
	done    sync.WaitGroup
}

// Run applies the policy once. Scheduled and requested runs never overlap.
func (s *Service) Run(ctx context.Context) (Result, error) {
	s.running.Lock()
	defer s.running.Unlock()
	var result Result
	current, err := s.Policy(ctx)
	if err != nil {
		return result, err
	}
	now := time.Now()
	if before, ok := policy.Cutoff(now, current.TaskDays); ok {
		if result.Tasks, err = s.Tasks(ctx, before); err != nil {
			return result, err
		}
	}
	if before, ok := policy.Cutoff(now, current.LogDays); ok {
		if result.Logs, err = s.Logs(ctx, before); err != nil {
			return result, err
		}
	}
	// A body is shared by a task and its log entry and goes with the last of them.
	if s.Content != nil {
		if err = s.Content(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("[Retention] content cleanup: %v", err)
		}
	}
	return result, nil
}

// Start runs once now and then daily until Stop.
func (s *Service) Start(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		return
	}
	ctx, s.cancel = context.WithCancel(ctx)
	s.done.Add(1)
	go func() {
		defer s.done.Done()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			result, err := s.Run(ctx)
			if err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("[Retention] cleanup failed: %v", err)
			} else if result.Tasks > 0 || result.Logs > 0 {
				log.Printf("[Retention] removed %d task records and %d log entries", result.Tasks, result.Logs)
			}
			select {
			case <-ticker.C:
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (s *Service) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel == nil {
		return
	}
	s.cancel()
	s.done.Wait()
	s.cancel = nil
}
