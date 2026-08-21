package jobqueue

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestQueueDispatchesOnDemandAndExpandsImmediately(t *testing.T) {
	repo := newQueueTestRepository(t)
	queue := New(repo, Options{
		MaxConcurrency:       2,
		FallbackPollInterval: time.Hour,
		LeaseDuration:        30 * time.Second,
	})
	started := make(chan struct{}, 3)
	release := make(chan struct{})
	queue.Register("test", func(context.Context, *Job) error {
		started <- struct{}{}
		<-release
		return nil
	})
	if err := queue.Start(context.Background()); err != nil {
		t.Fatalf("start queue: %v", err)
	}
	defer queue.Stop()
	defer close(release)

	for index := 0; index < 3; index++ {
		if _, err := queue.Enqueue(context.Background(), "test", "test", fmt.Sprintf("%d", index), nil, EnqueueOptions{}); err != nil {
			t.Fatalf("enqueue job %d: %v", index, err)
		}
	}
	waitForStarts(t, started, 2)
	assertNoStart(t, started)

	status, err := queue.RuntimeStatus(context.Background())
	if err != nil {
		t.Fatalf("get runtime status: %v", err)
	}
	if status.Active != 2 || status.Queued != 1 || status.MaxConcurrency != 2 {
		t.Fatalf("unexpected status before expansion: %+v", status)
	}

	queue.SetMaxConcurrency(3)
	waitForStarts(t, started, 1)
	status, err = queue.RuntimeStatus(context.Background())
	if err != nil {
		t.Fatalf("get expanded runtime status: %v", err)
	}
	if status.Active != 3 || status.Queued != 0 || status.MaxConcurrency != 3 {
		t.Fatalf("unexpected status after expansion: %+v", status)
	}
}

func TestQueueShrinkDoesNotInterruptRunningJobs(t *testing.T) {
	repo := newQueueTestRepository(t)
	queue := New(repo, Options{
		MaxConcurrency:       3,
		FallbackPollInterval: time.Hour,
		LeaseDuration:        30 * time.Second,
	})
	started := make(chan struct{}, 4)
	release := make(chan struct{})
	queue.Register("test", func(context.Context, *Job) error {
		started <- struct{}{}
		<-release
		return nil
	})
	if err := queue.Start(context.Background()); err != nil {
		t.Fatalf("start queue: %v", err)
	}
	defer queue.Stop()

	for index := 0; index < 3; index++ {
		if _, err := queue.Enqueue(context.Background(), "test", "test", fmt.Sprintf("running-%d", index), nil, EnqueueOptions{}); err != nil {
			t.Fatalf("enqueue running job %d: %v", index, err)
		}
	}
	waitForStarts(t, started, 3)
	queue.SetMaxConcurrency(1)
	if _, err := queue.Enqueue(context.Background(), "test", "test", "waiting", nil, EnqueueOptions{}); err != nil {
		t.Fatalf("enqueue waiting job: %v", err)
	}
	assertNoStart(t, started)

	status, err := queue.RuntimeStatus(context.Background())
	if err != nil {
		t.Fatalf("get shrinking runtime status: %v", err)
	}
	if status.Active != 3 || status.Queued != 1 || status.MaxConcurrency != 1 || !status.ScalingDown {
		t.Fatalf("unexpected shrinking status: %+v", status)
	}

	close(release)
	waitForStarts(t, started, 1)
}

func newQueueTestRepository(t *testing.T) Repository {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared&_busy_timeout=5000", uuid.NewString())
	database, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := database.AutoMigrate(&Job{}); err != nil {
		t.Fatalf("migrate job queue: %v", err)
	}
	return NewRepository(database)
}

func waitForStarts(t *testing.T, started <-chan struct{}, count int) {
	t.Helper()
	for index := 0; index < count; index++ {
		select {
		case <-started:
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for job %d of %d to start", index+1, count)
		}
	}
}

func assertNoStart(t *testing.T, started <-chan struct{}) {
	t.Helper()
	select {
	case <-started:
		t.Fatal("job started without available execution capacity")
	case <-time.After(100 * time.Millisecond):
	}
}
