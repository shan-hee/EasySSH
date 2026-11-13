package app

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/easyssh/shared/retention"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Retention periods live in the preference file, like other desktop settings.
// A missing or unreadable value means the default period.
const (
	desktopTaskRetentionPreference = "retention.taskDays"
	desktopLogRetentionPreference  = "retention.logDays"
)

type DesktopRetentionResult struct {
	DeletedTasks int64 `json:"deleted_tasks"`
	DeletedLogs  int64 `json:"deleted_logs"`
}

// DesktopRetentionService removes finished records once they are older than
// the chosen period. It is the only place on the desktop that deletes records
// by age: each service supplies how to delete, never when.
type DesktopRetentionService struct {
	tasks    *DesktopTaskService
	activity *ActivityLogService

	running sync.Mutex
	mu      sync.Mutex
	cancel  context.CancelFunc
	done    sync.WaitGroup
}

func NewDesktopRetentionService(tasks *DesktopTaskService, activity *ActivityLogService) *DesktopRetentionService {
	return &DesktopRetentionService{tasks: tasks, activity: activity}
}

func (s *DesktopRetentionService) ServiceName() string { return "DesktopRetentionService" }

func (s *DesktopRetentionService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	worker, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	s.cancel = cancel
	s.done.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.done.Done()
		if !waitForDesktopActivation(worker) {
			return
		}
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			if _, err := s.run(worker); err != nil && worker.Err() == nil {
				desktopLogPrintf("retention cleanup failed: %v", err)
			}
			select {
			case <-ticker.C:
			case <-worker.Done():
				return
			}
		}
	}()
	return nil
}

func (s *DesktopRetentionService) ServiceShutdown() error {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		s.done.Wait()
	}
	return nil
}

func desktopRetentionDays(preferences DesktopPreferenceSnapshot, key string) int {
	days, err := strconv.Atoi(preferences[key])
	if err != nil || !retention.Valid(days) {
		return retention.DefaultDays
	}
	return days
}

// Run applies the retention periods once, without waiting for the daily run.
func (s *DesktopRetentionService) Run() (DesktopRetentionResult, error) {
	return s.run(context.Background())
}

func (s *DesktopRetentionService) run(ctx context.Context) (DesktopRetentionResult, error) {
	s.running.Lock()
	defer s.running.Unlock()
	var result DesktopRetentionResult
	desktopPreferenceMu.Lock()
	preferences, err := readDesktopPreferences()
	desktopPreferenceMu.Unlock()
	if err != nil {
		return result, err
	}
	now := time.Now()
	if before, ok := retention.Cutoff(now, desktopRetentionDays(preferences, desktopTaskRetentionPreference)); ok {
		cleaned, err := s.tasks.cleanupBefore(before)
		if err != nil {
			return result, err
		}
		result.DeletedTasks = cleaned.DeletedCount
		// Transfer receipts are the remote counterpart of local task records.
		database, err := s.tasks.database()
		if err != nil {
			return result, err
		}
		receipts, err := cleanupRemoteTransferReceipts(ctx, database, before)
		if err != nil {
			return result, err
		}
		result.DeletedTasks += receipts
	}
	if before, ok := retention.Cutoff(now, desktopRetentionDays(preferences, desktopLogRetentionPreference)); ok {
		if result.DeletedLogs, err = s.activity.pruneBefore(ctx, before); err != nil {
			return result, err
		}
	}
	return result, nil
}
