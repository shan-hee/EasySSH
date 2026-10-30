package app

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"testing"
	"time"

	"github.com/easyssh/shared/dockerutil"
	"github.com/google/uuid"
)

func TestDesktopDockerPersistsTaskBeforeActionAndProjectsUnknown(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	s := NewDesktopDockerService(nil, tasks)
	server := uuid.NewString()
	calls := 0
	result, err := s.runAction(DesktopDockerContainerInput{ServerID: server, ContainerID: "container"}, protocol.DockerActionRestart, false, func(context.Context, string, string) error {
		calls++
		var status string
		if err := tasks.db.QueryRow(`SELECT status FROM desktop_task_runs WHERE source_type='desktop_docker'`).Scan(&status); err != nil || status != "running" {
			t.Fatalf("not running before dispatch: %s %v", status, err)
		}
		return errors.Join(dockerutil.ErrMutationOutcomeUnknown, context.Canceled)
	})
	if err != nil || result.Status != "unknown" || calls != 1 {
		t.Fatalf("result: %+v %v", result, err)
	}
	run, err := tasks.getRun(result.TaskID)
	if err != nil || run.Status != "unknown" || run.FailureCount != 0 || run.ServerID != server || run.Resource != "container" || run.Retryable || run.Cancelable {
		t.Fatalf("task: %+v %v", run, err)
	}
	var status, kind string
	if err := tasks.db.QueryRow(`SELECT status,kind FROM activity_logs WHERE source_table='desktop_task_runs' AND source_id=?`, result.TaskID).Scan(&status, &kind); err != nil || status != "unknown" || kind != "execution" {
		t.Fatalf("activity: %s %s %v", status, kind, err)
	}
}

func TestDesktopDockerAdmissionFailuresDoNotOpenTransport(t *testing.T) {
	for _, phase := range []string{"create", "start"} {
		t.Run(phase, func(t *testing.T) {
			tasks, _ := desktopTaskFixture(t)
			s := NewDesktopDockerService(nil, tasks)
			statement := `CREATE TRIGGER reject_docker BEFORE INSERT ON desktop_task_runs WHEN NEW.source_type='desktop_docker' BEGIN SELECT RAISE(ABORT,'blocked'); END`
			if phase == "start" {
				statement = `CREATE TRIGGER reject_docker BEFORE UPDATE ON desktop_task_runs WHEN NEW.source_type='desktop_docker' AND NEW.status='running' BEGIN SELECT RAISE(ABORT,'blocked'); END`
			}
			if _, err := tasks.db.Exec(statement); err != nil {
				t.Fatal(err)
			}
			called := false
			result, err := s.runAction(DesktopDockerContainerInput{ServerID: uuid.NewString(), ContainerID: "container"}, protocol.DockerActionStart, false, func(context.Context, string, string) error { called = true; return nil })
			if called {
				t.Fatal("transport opened before admission")
			}
			if phase == "create" && err == nil || phase == "start" && (err != nil || result.Status != "failed") {
				t.Fatalf("admission result: %+v %v", result, err)
			}
		})
	}
}

func TestDesktopDockerShutdownCollectsInFlightOutcome(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	s := NewDesktopDockerService(nil, tasks)
	entered := make(chan struct{})
	finished := make(chan protocol.DockerActionResult, 1)
	go func() {
		result, _ := s.runAction(DesktopDockerContainerInput{ServerID: uuid.NewString(), ContainerID: "container"}, protocol.DockerActionRestart, false, func(ctx context.Context, _, _ string) error {
			close(entered)
			<-ctx.Done()
			return dockerutil.ErrMutationOutcomeUnknown
		})
		finished <- result
	}()
	<-entered
	stopped := make(chan error, 1)
	go func() { stopped <- s.ServiceShutdown() }()
	select {
	case err := <-stopped:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("shutdown did not release canceled action")
	}
	result := <-finished
	run, err := tasks.getRun(result.TaskID)
	if err != nil || run.Status != "unknown" {
		t.Fatalf("shutdown lost outcome: %+v %v", run, err)
	}
}
