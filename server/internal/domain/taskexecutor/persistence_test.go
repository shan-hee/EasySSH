package taskexecutor

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

type outcomeSink struct {
	taskcenter.Service
	mu       sync.Mutex
	calls    int
	failures int
	err      error
	run      taskcenter.TaskRun
	status   taskcenter.Status
	result   string
	finished time.Time
}

type progressSink struct {
	taskcenter.Service
	calls                      int
	err                        error
	results                    string
	completed, success, failed int
}

func (s *progressSink) ObserveExecution(ctx context.Context, run taskcenter.TaskRun, result string, completed, success, failed int) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.calls++
	s.results, s.completed, s.success, s.failed = result, completed, success, failed
	return s.err
}

func TestTargetCheckpointPersistsAfterCancellation(t *testing.T) {
	sink := &progressSink{}
	e := NewExecutor(nil, nil, nil, nil, 1, sink)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	targets := []ServerExecutionResult{{ServerID: uuid.New(), Status: executionStatusSuccess, Output: "confirmed"}, {ServerID: uuid.New(), Status: executionStatusUnknown}}
	if err := e.saveTargets(ctx, observedRun(), targets); err != nil {
		t.Fatal(err)
	}
	var saved []ServerExecutionResult
	if err := json.Unmarshal([]byte(sink.results), &saved); err != nil || len(saved) != 2 || saved[0].Output != "confirmed" || sink.completed != 2 || sink.success != 1 || sink.failed != 0 {
		t.Fatalf("lost observed targets: %+v %v", sink, err)
	}
	sink.err = taskcenter.ErrObservedOutcomeConflict
	sink.calls = 0
	if err := e.saveTargets(ctx, observedRun(), targets); !errors.Is(err, taskcenter.ErrObservedOutcomeConflict) || sink.calls != 1 {
		t.Fatalf("retried conflicting checkpoint: %v calls=%d", err, sink.calls)
	}
}

func TestCanceledTargetCheckpointsAreSerializedAndNeverContainEmptySlots(t *testing.T) {
	for _, mode := range []string{"sequential", "parallel"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			e := NewExecutor(nil, nil, nil, nil, 3, nil)
			task := &scheduledtask.ScheduledTask{ServerIDs: []string{uuid.NewString(), uuid.NewString(), uuid.NewString()}}
			calls := 0
			results := e.executeOnServers(ctx, task, "", "", mode, SourceBatchTask, TriggerManual, func(targets []ServerExecutionResult) error {
				calls++
				if len(targets) != calls {
					t.Errorf("non-monotonic checkpoint: %d after %d callbacks", len(targets), calls)
				}
				for _, target := range targets {
					if target.ServerID == uuid.Nil || target.Status != executionStatusCanceled {
						t.Errorf("empty or incorrect target: %+v", target)
					}
				}
				return nil
			})
			if len(results) != 3 || calls != 3 {
				t.Fatalf("missing targets: %d callbacks=%d", len(results), calls)
			}
		})
	}
}

func (s *outcomeSink) CompleteExecution(_ context.Context, run taskcenter.TaskRun, status taskcenter.Status, result, code, message string, success, failed int, finished time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.run, s.status, s.result, s.finished = run, status, result, finished
	if s.failures > 0 {
		s.failures--
		return errors.New("temporary storage failure")
	}
	return s.err
}
func observedRun() taskcenter.TaskRun {
	return taskcenter.TaskRun{ID: uuid.New(), Actor: protocol.Actor{Kind: protocol.Owner, ID: uuid.NewString(), SessionID: uuid.NewString()}, SourceType: "scheduled_task", SourceID: uuid.NewString(), TaskType: "command"}
}
func TestOutcomeStorageRetryPreservesObservation(t *testing.T) {
	sink := &outcomeSink{failures: 1}
	e := NewExecutor(nil, nil, nil, nil, 1, sink)
	run := observedRun()
	_, done, err := e.begin(context.Background(), run.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	if _, _, err := e.begin(context.Background(), run.ID); !errors.Is(err, ErrAlreadyAdmitted) {
		t.Fatalf("duplicate active execution: %v", err)
	}
	finished := time.Now().Add(-time.Minute).UTC().Truncate(time.Millisecond)
	if err := e.saveResult(context.Background(), run, taskcenter.StatusSucceeded, "observed output", "", 1, 0, finished); err != nil {
		t.Fatal(err)
	}
	if sink.calls != 2 || sink.run.Actor != run.Actor || sink.result != "observed output" || sink.status != taskcenter.StatusSucceeded || !sink.finished.Equal(finished) {
		t.Fatalf("storage retry changed observed facts: %+v", sink)
	}
}
func TestStopWaitsForFinalWriteAfterExecutionCancellation(t *testing.T) {
	sink := &outcomeSink{}
	e := NewExecutor(nil, nil, nil, nil, 1, sink)
	run := observedRun()
	work, done, err := e.begin(context.Background(), run.ID)
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		defer done()
		<-work.Done()
		_ = e.saveResult(work, run, taskcenter.StatusSucceeded, "done", "", 1, 0, time.Now())
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := e.Stop(ctx); err != nil {
		t.Fatal(err)
	}
	if sink.calls != 1 || sink.status != taskcenter.StatusSucceeded {
		t.Fatal("shutdown lost observed result")
	}
	if _, _, err := e.begin(context.Background(), uuid.New()); !errors.Is(err, ErrStopping) {
		t.Fatalf("admitted after stop: %v", err)
	}
}
func TestImmutableOutcomeConflictIsNotRetried(t *testing.T) {
	sink := &outcomeSink{err: taskcenter.ErrObservedOutcomeConflict}
	e := NewExecutor(nil, nil, nil, nil, 1, sink)
	err := e.saveResult(context.Background(), observedRun(), taskcenter.StatusSucceeded, "done", "", 1, 0, time.Now())
	if !errors.Is(err, taskcenter.ErrObservedOutcomeConflict) || sink.calls != 1 {
		t.Fatalf("immutable conflict retried: %v calls=%d", err, sink.calls)
	}
	if err := e.Stop(context.Background()); !errors.Is(err, taskcenter.ErrObservedOutcomeConflict) {
		t.Fatalf("shutdown concealed storage failure: %v", err)
	}
}
