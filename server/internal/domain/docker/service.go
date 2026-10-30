// Package docker owns Docker work admission, durable outcomes and SSH channel lifetimes.
package docker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/monitor"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/dockerutil"
	"github.com/easyssh/shared/resultstore"
	"github.com/google/uuid"
	"log"
)

var ErrOutcomeConflict = errors.New("Docker task outcome conflicts with stored result")
var ErrStopped = errors.New("Docker service stopped")
var ErrInvalidOperation = errors.New("invalid Docker operation")

type taskWriter interface {
	Create(context.Context, *taskcenter.TaskRun) error
	Start(context.Context, uuid.UUID, string) error
	CompleteDocker(context.Context, uuid.UUID, taskcenter.Status, string, string, string, int, int, time.Time) error
}
type taskReader interface {
	Get(context.Context, uuid.UUID) (*taskcenter.TaskRun, error)
	GetAny(context.Context, uuid.UUID) (*taskcenter.TaskRun, error)
}

type Service struct {
	pool        *monitor.ConnectionPool
	tasks       taskWriter
	repo        taskReader
	mu          sync.Mutex
	stopped     bool
	active      map[uuid.UUID]context.CancelFunc
	wg          sync.WaitGroup
	stopOnce    sync.Once
	stoppedDone chan struct{}
	stopErr     error
}

func NewService(pool *monitor.ConnectionPool, tasks taskWriter, repo taskReader) *Service {
	return &Service{pool: pool, tasks: tasks, repo: repo, active: make(map[uuid.UUID]context.CancelFunc), stoppedDone: make(chan struct{})}
}

func (s *Service) begin(ctx context.Context) (context.Context, func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopped {
		return nil, nil, ErrStopped
	}
	if len(s.active) >= 128 {
		return nil, nil, access.ErrCapacity
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	id := uuid.New()
	s.active[id] = cancel
	s.wg.Add(1)
	return ctx, func() { cancel(); s.mu.Lock(); delete(s.active, id); s.mu.Unlock(); s.wg.Done() }, nil
}

// Client registers read work until cleanup. Request cancellation closes its HTTP
// unix-socket channel through the transport, never the shared SSH connection.
func (s *Service) Client(ctx context.Context, serverID string) (*dockerutil.Client, context.Context, func(), error) {
	ctx, done, err := s.begin(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	lease, err := access.Current(ctx).OpenWork(ctx, access.Task, access.Requirement{Action: protocol.DockerRead, ServerID: serverID})
	if err != nil {
		done()
		return nil, nil, nil, err
	}
	ctx = lease.Context()
	client, closeClient, err := s.openClient(ctx, serverID, protocol.DockerRead)
	if err != nil {
		lease.Close(err)
		done()
		return nil, nil, nil, err
	}
	return client, ctx, func() { closeClient(); lease.Close(ctx.Err()); done() }, nil
}

func (s *Service) openClient(ctx context.Context, serverID string, action protocol.Action) (*dockerutil.Client, func(), error) {
	if s.pool == nil {
		return nil, nil, errors.New("Docker connection pool is unavailable")
	}
	pooled, err := s.pool.GetOrCreate(ctx, serverID, action)
	if err != nil {
		return nil, nil, err
	}
	raw := pooled.Client.GetRawConnection()
	if raw == nil {
		s.pool.Release(pooled)
		return nil, nil, errors.New("SSH connection is unavailable")
	}
	client, err := dockerutil.NewClient(raw.DialContext, "/var/run/docker.sock")
	if err != nil {
		s.pool.Release(pooled)
		return nil, nil, err
	}
	return client, func() { _ = client.Close(); s.pool.Release(pooled) }, nil
}

func (s *Service) Apply(ctx context.Context, serverID, containerID string, action protocol.DockerAction, force bool) (protocol.DockerActionResult, error) {
	return s.apply(ctx, serverID, containerID, action, force, func(ctx context.Context, ref string) error {
		client, cleanup, err := s.openClient(ctx, serverID, protocol.DockerManage)
		if err != nil {
			return err
		}
		defer cleanup()
		return client.Apply(ctx, action, ref, force)
	})
}

func (s *Service) apply(ctx context.Context, serverID, containerID string, action protocol.DockerAction, force bool, execute func(context.Context, string) error) (protocol.DockerActionResult, error) {
	var result protocol.DockerActionResult
	ctx, done, err := s.begin(ctx)
	if err != nil {
		return result, err
	}
	defer done()
	lease, err := access.Current(ctx).OpenWork(ctx, access.Task, access.Requirement{Action: protocol.DockerManage, ServerID: serverID})
	if err != nil {
		return result, err
	}
	var operationErr error
	defer func() { lease.Close(operationErr) }()
	ctx = lease.Context()
	ref, err := dockerutil.NormalizeContainerRef(containerID)
	if err != nil {
		operationErr = fmt.Errorf("%w: %v", ErrInvalidOperation, err)
		return result, operationErr
	}
	server, err := uuid.Parse(serverID)
	if err != nil || server == uuid.Nil || !action.Valid() || force && action != protocol.DockerActionRemove {
		operationErr = ErrInvalidOperation
		return result, operationErr
	}
	if s.tasks == nil || s.repo == nil {
		operationErr = errors.New("Docker task storage is unavailable")
		return result, operationErr
	}
	id := uuid.New()
	result = protocol.DockerActionResult{TaskID: id.String(), ServerID: server.String(), ContainerID: ref, Action: action}
	payload, _ := json.Marshal(struct {
		Action      protocol.DockerAction `json:"action"`
		ContainerID string                `json:"container_id"`
		Force       bool                  `json:"force"`
	}{action, ref, force})
	run := taskcenter.TaskRun{ID: id, Actor: access.Current(ctx).Actor(), SourceType: "docker", SourceID: id.String(), TaskType: "docker_" + string(action), Title: "Docker " + string(action), ServerID: &server, Resource: ref, PayloadJSON: string(payload), TotalCount: 1, Cancelable: false, Retryable: false}
	operationErr = s.tasks.Create(ctx, &run)
	if operationErr != nil {
		return result, operationErr
	}
	if operationErr == nil {
		operationErr = s.tasks.Start(ctx, id, run.TaskType)
	}
	if operationErr == nil {
		// Start is shared with resumable jobs and can return nil for a terminal row.
		// Confirm our fresh task is running before sending a non-repeatable action.
		var current *taskcenter.TaskRun
		current, operationErr = s.repo.GetAny(ctx, id)
		if operationErr == nil && (!sameTask(current, &run) || current.Status != taskcenter.StatusRunning) {
			operationErr = ErrOutcomeConflict
		}
	}
	if operationErr == nil {
		operationErr = ctx.Err()
	}
	if operationErr == nil {
		operationErr = execute(ctx, ref)
	}
	result.Status, result.ErrorCode, result.ErrorMessage = dockerutil.Outcome(operationErr)
	finished := time.Now().UTC().Truncate(time.Millisecond)
	encoded, err := json.Marshal(result)
	if err != nil {
		return result, err
	}
	success, failure := 0, 0
	if result.Status == "succeeded" {
		success = 1
	}
	if result.Status == "failed" || result.Status == "timeout" {
		failure = 1
	}
	err = resultstore.Write(ctx, func(writeCtx context.Context) error {
		err := s.tasks.CompleteDocker(writeCtx, id, taskcenter.Status(result.Status), string(encoded), result.ErrorCode, result.ErrorMessage, success, failure, finished)
		if errors.Is(err, taskcenter.ErrObservedOutcomeConflict) {
			return resultstore.Permanent(err)
		}
		return err
	})
	if err != nil {
		log.Printf("[Docker] result storage failed: task=%s error=%v", id, err)
		s.mu.Lock()
		s.stopErr = errors.Join(s.stopErr, err)
		s.mu.Unlock()
		return result, err
	}
	return result, nil
}

func sameTask(a, b *taskcenter.TaskRun) bool {
	return a != nil && a.ID == b.ID && a.Actor == b.Actor && a.SourceType == "docker" && a.SourceID == b.SourceID && a.TaskType == b.TaskType && a.ServerID != nil && b.ServerID != nil && *a.ServerID == *b.ServerID && a.Resource == b.Resource && a.PayloadJSON == b.PayloadJSON
}

func (s *Service) Result(ctx context.Context, serverID string, id uuid.UUID) (protocol.DockerActionResult, error) {
	ctx, done, err := s.begin(ctx)
	if err != nil {
		return protocol.DockerActionResult{}, err
	}
	defer done()
	scope := access.Current(ctx)
	if err = scope.Check(ctx, access.Requirement{Action: protocol.DockerManage, ServerID: serverID}); err != nil {
		return protocol.DockerActionResult{}, err
	}
	// Reuse the task center's audience: owners can inspect workspace history
	// across logins; visitors are restricted to their own access session.
	run, err := s.repo.Get(ctx, id)
	if err != nil {
		return protocol.DockerActionResult{}, err
	}
	if run.SourceType != "docker" || run.ServerID == nil || run.ServerID.String() != serverID {
		return protocol.DockerActionResult{}, access.ErrForbidden
	}
	var result protocol.DockerActionResult
	if err = json.Unmarshal([]byte(run.ResultJSON), &result); err != nil {
		// Interrupted tasks are recovered by TaskCenter without inventing a result DTO.
		result = protocol.DockerActionResult{TaskID: id.String(), ServerID: serverID, ContainerID: run.Resource, Action: protocol.DockerAction(strings.TrimPrefix(run.TaskType, "docker_")), Status: string(run.Status), ErrorCode: run.ErrorCode, ErrorMessage: run.ErrorMessage}
	}
	return result, nil
}
