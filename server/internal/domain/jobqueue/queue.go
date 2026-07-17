package jobqueue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Handler func(ctx context.Context, job *Job) error

type Enqueuer interface {
	Enqueue(ctx context.Context, kind, sourceType, sourceID string, payload interface{}, options EnqueueOptions) (*Job, error)
	CancelBySource(ctx context.Context, sourceType, sourceID string) error
}

type Queue interface {
	Enqueuer
	Register(kind string, handler Handler)
	Start(ctx context.Context) error
	Stop()
}

type Options struct {
	Workers       int
	PollInterval  time.Duration
	LeaseDuration time.Duration
	Retention     time.Duration
}

type queue struct {
	repo Repository
	opts Options

	handlerMu sync.RWMutex
	handlers  map[string]Handler

	runningMu sync.Mutex
	running   map[uuid.UUID]context.CancelFunc

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
	once   sync.Once
}

func New(repo Repository, options Options) Queue {
	if options.Workers < 1 {
		options.Workers = 4
	}
	if options.PollInterval <= 0 {
		options.PollInterval = time.Second
	}
	if options.LeaseDuration < 15*time.Second {
		options.LeaseDuration = 60 * time.Second
	}
	if options.Retention <= 0 {
		options.Retention = 30 * 24 * time.Hour
	}
	return &queue{
		repo: repo, opts: options,
		handlers: make(map[string]Handler), running: make(map[uuid.UUID]context.CancelFunc),
	}
}

func (q *queue) Register(kind string, handler Handler) {
	q.handlerMu.Lock()
	defer q.handlerMu.Unlock()
	if kind == "" || handler == nil {
		return
	}
	q.handlers[kind] = handler
}

func (q *queue) Enqueue(ctx context.Context, kind, sourceType, sourceID string, payload interface{}, options EnqueueOptions) (*Job, error) {
	if kind == "" || sourceType == "" || sourceID == "" {
		return nil, errors.New("job kind, source type and source id are required")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	job := &Job{
		Kind: kind, SourceType: sourceType, SourceID: sourceID, PayloadJSON: string(raw),
		Status: StatusQueued, AvailableAt: options.AvailableAt, MaxAttempts: options.MaxAttempts, Priority: options.Priority,
	}
	if options.DedupeKey != "" {
		job.DedupeKey = &options.DedupeKey
	}
	if err := q.repo.Create(ctx, job); err != nil {
		return nil, err
	}
	return job, nil
}

func (q *queue) CancelBySource(ctx context.Context, sourceType, sourceID string) error {
	ids, err := q.repo.CancelBySource(ctx, sourceType, sourceID)
	if err != nil {
		return err
	}
	q.runningMu.Lock()
	for _, id := range ids {
		if cancel := q.running[id]; cancel != nil {
			cancel()
		}
	}
	q.runningMu.Unlock()
	return nil
}

func (q *queue) Start(ctx context.Context) error {
	if q.ctx != nil {
		return nil
	}
	q.ctx, q.cancel = context.WithCancel(ctx)
	recovered, err := q.repo.RecoverExpiredLeases(q.ctx, time.Now())
	if err != nil {
		return fmt.Errorf("recover expired job leases: %w", err)
	}
	if recovered > 0 {
		log.Printf("[JobQueue] recovered %d expired job leases", recovered)
	}
	for index := 0; index < q.opts.Workers; index++ {
		q.wg.Add(1)
		go q.worker(index)
	}
	q.wg.Add(1)
	go q.recoverExpiredLeases()
	return nil
}

func (q *queue) Stop() {
	q.once.Do(func() {
		if q.cancel != nil {
			q.cancel()
		}
		q.runningMu.Lock()
		for _, cancel := range q.running {
			cancel()
		}
		q.runningMu.Unlock()
		q.wg.Wait()
	})
}

func (q *queue) worker(index int) {
	defer q.wg.Done()
	hostname, _ := os.Hostname()
	workerID := fmt.Sprintf("%s:%d:%d:%s", hostname, os.Getpid(), index, uuid.NewString()[:8])
	ticker := time.NewTicker(q.opts.PollInterval)
	defer ticker.Stop()
	for {
		job, err := q.repo.Claim(q.ctx, workerID, q.opts.LeaseDuration)
		if err == nil {
			q.process(workerID, job)
			continue
		}
		if err != nil && !errors.Is(err, ErrNoJobAvailable) && !errors.Is(err, context.Canceled) {
			log.Printf("[JobQueue] claim failed: worker=%s error=%v", workerID, err)
		}
		select {
		case <-q.ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (q *queue) process(workerID string, job *Job) {
	if job == nil {
		return
	}
	running, err := q.repo.MarkRunning(q.ctx, job.ID, workerID)
	if err != nil || !running {
		return
	}

	handlerCtx, cancel := context.WithCancel(q.ctx)
	q.runningMu.Lock()
	q.running[job.ID] = cancel
	q.runningMu.Unlock()
	defer func() {
		cancel()
		q.runningMu.Lock()
		delete(q.running, job.ID)
		q.runningMu.Unlock()
	}()
	active, heartbeatErr := q.repo.Heartbeat(q.ctx, job.ID, workerID, q.opts.LeaseDuration)
	if heartbeatErr != nil || !active {
		return
	}

	heartbeatDone := make(chan struct{})
	go q.heartbeat(handlerCtx, cancel, heartbeatDone, workerID, job.ID)

	q.handlerMu.RLock()
	handler := q.handlers[job.Kind]
	q.handlerMu.RUnlock()
	if handler == nil {
		err = fmt.Errorf("no handler registered for job kind %s", job.Kind)
	} else {
		err = invokeHandler(handlerCtx, handler, job)
	}
	cancel()
	<-heartbeatDone

	if q.ctx.Err() != nil {
		return
	}
	if err == nil {
		_, completeErr := q.repo.Complete(q.ctx, job.ID, workerID)
		if completeErr != nil {
			log.Printf("[JobQueue] complete failed: job=%s error=%v", job.ID, completeErr)
		}
		return
	}

	backoff := retryBackoff(job.Attempt)
	_, failErr := q.repo.Fail(q.ctx, job.ID, workerID, err.Error(), time.Now().Add(backoff))
	if failErr != nil {
		log.Printf("[JobQueue] fail transition failed: job=%s error=%v", job.ID, failErr)
	}
}

func (q *queue) recoverExpiredLeases() {
	defer q.wg.Done()
	interval := q.opts.LeaseDuration / 2
	if interval < 10*time.Second {
		interval = 10 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	cleanupTicker := time.NewTicker(24 * time.Hour)
	defer cleanupTicker.Stop()
	q.cleanupTerminalJobs()
	for {
		select {
		case <-q.ctx.Done():
			return
		case now := <-ticker.C:
			recovered, err := q.repo.RecoverExpiredLeases(q.ctx, now)
			if err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("[JobQueue] recover expired leases failed: %v", err)
			} else if recovered > 0 {
				log.Printf("[JobQueue] recovered %d expired job leases", recovered)
			}
		case <-cleanupTicker.C:
			q.cleanupTerminalJobs()
		}
	}
}

func (q *queue) cleanupTerminalJobs() {
	deleted, err := q.repo.CleanupTerminalBefore(q.ctx, time.Now().Add(-q.opts.Retention))
	if err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("[JobQueue] cleanup terminal jobs failed: %v", err)
	} else if deleted > 0 {
		log.Printf("[JobQueue] cleaned up %d terminal jobs", deleted)
	}
}

func invokeHandler(ctx context.Context, handler Handler, job *Job) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("job handler panic: %v", recovered)
		}
	}()
	return handler(ctx, job)
}

func (q *queue) heartbeat(ctx context.Context, cancel context.CancelFunc, done chan<- struct{}, workerID string, jobID uuid.UUID) {
	defer close(done)
	interval := q.opts.LeaseDuration / 3
	if interval < 5*time.Second {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			active, err := q.repo.Heartbeat(q.ctx, jobID, workerID, q.opts.LeaseDuration)
			if err != nil || !active {
				cancel()
				return
			}
		}
	}
}

func retryBackoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	seconds := math.Pow(2, float64(attempt-1))
	if seconds > 60 {
		seconds = 60
	}
	return time.Duration(seconds) * time.Second
}
