package taskexecutor

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/resultstore"
	"github.com/google/uuid"
)

const maxActiveExecutions = 64

var (
	ErrStopping        = errors.New("task executor is stopping")
	ErrCapacity        = errors.New("task executor capacity reached")
	ErrAlreadyAdmitted = errors.New("task execution identity is already admitted")
)

func (e *Executor) begin(ctx context.Context, id uuid.UUID) (context.Context, func(), error) {
	e.cancelMu.Lock()
	defer e.cancelMu.Unlock()
	if e.stopped {
		return nil, nil, ErrStopping
	}
	if e.cancels[id] != nil {
		return nil, nil, ErrAlreadyAdmitted
	}
	if len(e.cancels) >= maxActiveExecutions {
		return nil, nil, ErrCapacity
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	work, cancel := context.WithCancel(ctx)
	e.cancels[id] = cancel
	e.workWG.Add(1)
	return work, func() {
		cancel()
		e.cancelMu.Lock()
		delete(e.cancels, id)
		e.cancelMu.Unlock()
		e.workWG.Done()
	}, nil
}

func (e *Executor) saveResult(ctx context.Context, run taskcenter.TaskRun, status taskcenter.Status, result, message string, success, failed int, finished time.Time) error {
	err := resultstore.Write(ctx, func(writeCtx context.Context) error {
		err := e.taskRuns.CompleteExecution(writeCtx, run, status, result, "", message, success, failed, finished)
		if errors.Is(err, taskcenter.ErrObservedOutcomeConflict) {
			return resultstore.Permanent(err)
		}
		return err
	})
	if err != nil {
		log.Printf("[TaskExecutor] result storage failed: run=%s error=%v", run.ID, err)
		e.cancelMu.Lock()
		e.stopErr = errors.Join(e.stopErr, err)
		e.cancelMu.Unlock()
	}
	return err
}

func (e *Executor) saveTargets(ctx context.Context, run taskcenter.TaskRun, targets []ServerExecutionResult) error {
	encoded, err := json.Marshal(targets)
	if err != nil {
		return err
	}
	_, success, failed := summarizeServerExecution(targets)
	err = resultstore.Write(ctx, func(writeCtx context.Context) error {
		err := e.taskRuns.ObserveExecution(writeCtx, run, string(encoded), len(targets), success, failed)
		if errors.Is(err, taskcenter.ErrObservedOutcomeConflict) {
			return resultstore.Permanent(err)
		}
		return err
	})
	if err != nil {
		log.Printf("[TaskExecutor] target storage failed, stopping remaining targets: run=%s error=%v", run.ID, err)
	}
	return err
}

func (e *Executor) Stop(ctx context.Context) error {
	e.stopOnce.Do(func() {
		e.cancelMu.Lock()
		e.stopped = true
		for _, cancel := range e.cancels {
			cancel()
		}
		e.cancelMu.Unlock()
		go func() { e.workWG.Wait(); close(e.stoppedDone) }()
	})
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-e.stoppedDone:
		return e.stopErr
	}
}
