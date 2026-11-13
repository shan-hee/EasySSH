package retention

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRunAppliesEachPeriodAndSkipsCategoriesKeptForever(t *testing.T) {
	var taskCutoff, logCutoff time.Time
	content := 0
	current := Policy{TaskDays: 30, LogDays: 0}
	service := &Service{
		Policy: func(context.Context) (Policy, error) { return current, nil },
		Tasks: func(_ context.Context, before time.Time) (int64, error) {
			taskCutoff = before
			return 4, nil
		},
		Logs: func(_ context.Context, before time.Time) (int64, error) {
			logCutoff = before
			return 9, nil
		},
		Content: func(context.Context) error { content++; return nil },
	}
	started := time.Now()
	result, err := service.Run(context.Background())
	if err != nil || result.Tasks != 4 || result.Logs != 0 || content != 1 {
		t.Fatalf("first run: %+v %v content=%d", result, err, content)
	}
	if !logCutoff.IsZero() {
		t.Fatal("logs kept forever were cleaned")
	}
	if age := started.Sub(taskCutoff); age < 29*24*time.Hour || age > 31*24*time.Hour {
		t.Fatalf("task cutoff is %v before now", age)
	}
	// A changed setting applies to the next run without a restart.
	current = Policy{TaskDays: 0, LogDays: 7}
	taskCutoff = time.Time{}
	result, err = service.Run(context.Background())
	if err != nil || result.Tasks != 0 || result.Logs != 9 || !taskCutoff.IsZero() {
		t.Fatalf("second run: %+v %v", result, err)
	}
	if age := time.Now().Sub(logCutoff); age < 6*24*time.Hour || age > 8*24*time.Hour {
		t.Fatalf("log cutoff is %v before now", age)
	}
}

func TestRunReportsAFailedCategory(t *testing.T) {
	failure := errors.New("database is locked")
	logs := 0
	service := &Service{
		Policy: func(context.Context) (Policy, error) { return Policy{TaskDays: 90, LogDays: 90}, nil },
		Tasks:  func(context.Context, time.Time) (int64, error) { return 0, failure },
		Logs:   func(context.Context, time.Time) (int64, error) { logs++; return 0, nil },
	}
	if _, err := service.Run(context.Background()); !errors.Is(err, failure) || logs != 0 {
		t.Fatalf("failure hidden: %v logs=%d", err, logs)
	}
}

func TestStartRunsOnceImmediatelyAndStops(t *testing.T) {
	ran := make(chan struct{}, 1)
	service := &Service{
		Policy: func(context.Context) (Policy, error) { return Policy{}, nil },
		Tasks:  func(context.Context, time.Time) (int64, error) { return 0, nil },
		Logs:   func(context.Context, time.Time) (int64, error) { return 0, nil },
		Content: func(context.Context) error {
			select {
			case ran <- struct{}{}:
			default:
			}
			return nil
		},
	}
	service.Start(context.Background())
	service.Start(context.Background())
	select {
	case <-ran:
	case <-time.After(5 * time.Second):
		t.Fatal("no run after start")
	}
	service.Stop()
	service.Stop()
}
