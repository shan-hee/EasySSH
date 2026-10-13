package taskexecutor

import (
	"context"
	"testing"

	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/google/uuid"
)

type cancelTrackingQueue struct {
	sourceType string
	sourceID   string
}

func (q *cancelTrackingQueue) Enqueue(context.Context, string, string, string, interface{}, jobqueue.EnqueueOptions) (*jobqueue.Job, error) {
	return nil, nil
}

func (q *cancelTrackingQueue) CancelBySource(_ context.Context, sourceType, sourceID string) error {
	q.sourceType = sourceType
	q.sourceID = sourceID
	return nil
}

func TestCancelTaskCancelsDurableJobAndExecutionContext(t *testing.T) {
	runID := uuid.New()
	queue := &cancelTrackingQueue{}
	executionCtx, cancel := context.WithCancel(context.Background())
	executor := &Executor{queue: queue, cancels: map[uuid.UUID]context.CancelFunc{runID: cancel}}

	if err := executor.CancelTask(context.Background(), runID); err != nil {
		t.Fatal(err)
	}
	if queue.sourceType != "task_run" || queue.sourceID != runID.String() {
		t.Fatalf("unexpected queue cancellation source: %s/%s", queue.sourceType, queue.sourceID)
	}
	select {
	case <-executionCtx.Done():
	default:
		t.Fatal("execution context was not canceled")
	}
}
