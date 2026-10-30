package docker

import (
	"context"
	"errors"
	"github.com/easyssh/server/internal/testutil"
	"github.com/easyssh/shared/protocol"
	"sync"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/dockerutil"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type dockerMemoryTasks struct {
	mu                               sync.Mutex
	rows                             map[uuid.UUID]taskcenter.TaskRun
	createErr, startErr, completeErr error
	commitCreate                     bool
	completeFailures                 int
}

func (m *dockerMemoryTasks) Create(_ context.Context, run *taskcenter.TaskRun) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.createErr != nil && !m.commitCreate {
		return m.createErr
	}
	if _, ok := m.rows[run.ID]; ok {
		return errors.New("duplicate")
	}
	copy := *run
	copy.Status = taskcenter.StatusQueued
	m.rows[run.ID] = copy
	return m.createErr
}
func (m *dockerMemoryTasks) Start(_ context.Context, id uuid.UUID, stage string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.startErr != nil {
		return m.startErr
	}
	row := m.rows[id]
	row.Status = taskcenter.StatusRunning
	row.Stage = stage
	m.rows[id] = row
	return nil
}
func (m *dockerMemoryTasks) GetAny(_ context.Context, id uuid.UUID) (*taskcenter.TaskRun, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.rows[id]
	if !ok {
		return nil, gorm.ErrRecordNotFound
	}
	return &row, nil
}

func (m *dockerMemoryTasks) Get(ctx context.Context, id uuid.UUID) (*taskcenter.TaskRun, error) {
	run, err := m.GetAny(ctx, id)
	if err != nil {
		return nil, err
	}
	scope := access.Current(ctx)
	if scope.RequireOwner(ctx, protocol.ActivityRead) != nil && run.Actor != scope.Actor() {
		return nil, access.ErrForbidden
	}
	return run, nil
}
func (m *dockerMemoryTasks) CompleteDocker(_ context.Context, id uuid.UUID, status taskcenter.Status, result, code, message string, success, failure int, finishedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.completeFailures > 0 {
		m.completeFailures--
		return errors.New("temporary storage error")
	}
	if m.completeErr != nil {
		return m.completeErr
	}
	row := m.rows[id]
	if row.Status != taskcenter.StatusQueued && row.Status != taskcenter.StatusRunning {
		return nil
	}
	row.FinishedAt = &finishedAt
	row.Status = status
	row.ResultJSON = result
	row.ErrorCode = code
	row.ErrorMessage = message
	row.SuccessCount = success
	row.FailureCount = failure
	m.rows[id] = row
	return nil
}

type dockerAuthority struct {
	testutil.AccessPolicy
	runtime *access.Runtime
}

func (d dockerAuthority) Authorize(context.Context, protocol.Actor, access.Requirement) error {
	return nil
}
func (d dockerAuthority) OpenWork(ctx context.Context, scope access.Scope, kind access.WorkKind, req ...access.Requirement) (*access.Lease, error) {
	return d.runtime.Reserve(ctx, scope, kind, 128, req...)
}
func dockerContext(t *testing.T, session string) context.Context {
	t.Helper()
	scope, err := access.NewScope(protocol.Actor{Kind: protocol.Visitor, ID: session, SessionID: session, GrantID: "grant"}, time.Now().Add(time.Hour), dockerAuthority{runtime: access.NewRuntime()})
	if err != nil {
		t.Fatal(err)
	}
	return access.WithScope(context.Background(), scope)
}
func dockerFixture(t *testing.T) (*Service, *dockerMemoryTasks, context.Context, string) {
	t.Helper()
	store := &dockerMemoryTasks{rows: make(map[uuid.UUID]taskcenter.TaskRun)}
	s := NewService(nil, store, store)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = s.Stop(ctx)
	})
	return s, store, dockerContext(t, "session"), uuid.NewString()
}

func TestDockerActionHasRunningTaskBeforeDispatch(t *testing.T) {
	s, store, ctx, server := dockerFixture(t)
	calls := 0
	result, err := s.apply(ctx, server, "container", protocol.DockerActionRestart, false, func(context.Context, string) error {
		calls++
		store.mu.Lock()
		defer store.mu.Unlock()
		if len(store.rows) != 1 {
			t.Fatal("missing admission")
		}
		for _, run := range store.rows {
			if run.Status != taskcenter.StatusRunning || run.Retryable || run.Cancelable || run.SourceType != "docker" {
				t.Fatalf("invalid admission: %+v", run)
			}
		}
		return dockerutil.ErrMutationOutcomeUnknown
	})
	if err != nil || result.Status != "unknown" || calls != 1 {
		t.Fatalf("outcome: %+v %v calls=%d", result, err, calls)
	}
	run, _ := store.GetAny(ctx, uuid.MustParse(result.TaskID))
	if run.FailureCount != 0 || run.Status != taskcenter.StatusUnknown {
		t.Fatalf("unknown counted as failure: %+v", run)
	}
}

func TestDockerAdmissionFailureNeverDispatches(t *testing.T) {
	for _, phase := range []string{"create", "create-reply", "start"} {
		t.Run(phase, func(t *testing.T) {
			s, store, ctx, server := dockerFixture(t)
			failure := errors.New("storage failed")
			switch phase {
			case "create":
				store.createErr = failure
			case "create-reply":
				store.createErr = failure
				store.commitCreate = true
			case "start":
				store.startErr = failure
			}
			calls := 0
			result, err := s.apply(ctx, server, "container", protocol.DockerActionStop, false, func(context.Context, string) error { calls++; return nil })
			if calls != 0 {
				t.Fatal("action sent before durable admission")
			}
			if phase == "start" {
				if err != nil || result.Status != "failed" {
					t.Fatalf("start rejection: %+v %v", result, err)
				}
			} else if !errors.Is(err, failure) {
				t.Fatalf("creation failure hidden: %v", err)
			}
		})
	}
}
func TestDockerStorageRetryDoesNotRepeatMutation(t *testing.T) {
	s, store, ctx, server := dockerFixture(t)
	store.completeFailures = 1
	calls := 0
	result, err := s.apply(ctx, server, "container", protocol.DockerActionPause, false, func(context.Context, string) error { calls++; return nil })
	if err != nil || result.Status != "succeeded" || calls != 1 {
		t.Fatalf("storage retry repeated action: %+v %v calls=%d", result, err, calls)
	}
	id := uuid.MustParse(result.TaskID)
	if _, err = s.Result(dockerContext(t, "other"), server, id); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("cross-session result: %v", err)
	}
	saved, err := s.Result(ctx, server, id)
	if err != nil || saved != result {
		t.Fatalf("durable result changed: %+v %v", saved, err)
	}
}

func TestDockerResultUsesTaskAudienceAcrossOwnerLogins(t *testing.T) {
	s, store, visitor, serverID := dockerFixture(t)
	result, err := s.apply(visitor, serverID, "container", protocol.DockerActionPause, false, func(context.Context, string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.MustParse(result.TaskID)
	owner := uuid.NewString()
	ownerContext := func(session string) context.Context {
		scope, err := access.NewScope(protocol.Actor{Kind: protocol.Owner, ID: owner, SessionID: session}, time.Now().Add(time.Hour), dockerAuthority{runtime: access.NewRuntime()})
		if err != nil {
			t.Fatal(err)
		}
		return access.WithScope(context.Background(), scope)
	}
	// Owners inspect visitor work as part of the same task history.
	if got, err := s.Result(ownerContext(uuid.NewString()), serverID, id); err != nil || got != result {
		t.Fatalf("owner cannot inspect visitor task: %+v %v", got, err)
	}
	store.mu.Lock()
	run := store.rows[id]
	run.Actor = protocol.Actor{Kind: protocol.Owner, ID: owner, SessionID: uuid.NewString()}
	store.rows[id] = run
	store.mu.Unlock()
	if got, err := s.Result(ownerContext(uuid.NewString()), serverID, id); err != nil || got != result {
		t.Fatalf("new owner login lost historical result: %+v %v", got, err)
	}
	if _, err := s.Result(visitor, serverID, id); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("visitor read owner task: %v", err)
	}
	if _, err := s.Result(ownerContext(uuid.NewString()), uuid.NewString(), id); !errors.Is(err, access.ErrForbidden) {
		t.Fatalf("result attached to different server: %v", err)
	}
}
func TestDockerImmutableResultConflictIsReported(t *testing.T) {
	s, store, ctx, server := dockerFixture(t)
	store.completeErr = taskcenter.ErrObservedOutcomeConflict
	calls := 0
	result, err := s.apply(ctx, server, "container", protocol.DockerActionStart, false, func(context.Context, string) error { calls++; return nil })
	if !errors.Is(err, taskcenter.ErrObservedOutcomeConflict) || calls != 1 || result.Status != "succeeded" {
		t.Fatalf("conflict concealed or action repeated: %+v %v", result, err)
	}
}

func TestDockerStopWaitsForObservedOutcome(t *testing.T) {
	s, store, ctx, server := dockerFixture(t)
	entered := make(chan struct{})
	finished := make(chan protocol.DockerActionResult, 1)
	go func() {
		result, _ := s.apply(ctx, server, "container", protocol.DockerActionRestart, false, func(ctx context.Context, _ string) error {
			close(entered)
			<-ctx.Done()
			return dockerutil.ErrMutationOutcomeUnknown
		})
		finished <- result
	}()
	<-entered
	stopCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := s.Stop(stopCtx); err != nil {
		t.Fatal(err)
	}
	result := <-finished
	run, err := store.GetAny(context.Background(), uuid.MustParse(result.TaskID))
	if err != nil || run.Status != taskcenter.StatusUnknown {
		t.Fatalf("shutdown lost result: %+v %v", run, err)
	}
	if _, err := s.Apply(ctx, server, "container", protocol.DockerActionStart, false); !errors.Is(err, ErrStopped) {
		t.Fatalf("admitted after stop: %v", err)
	}
}
