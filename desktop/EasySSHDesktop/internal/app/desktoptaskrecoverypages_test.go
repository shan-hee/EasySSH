package app

import (
	"context"
	"testing"
)

func TestDesktopRecoveryPagesPreserveBodiesAndCancelOnlyUnstartedTasks(t *testing.T) {
	s, first := desktopTaskFixture(t)
	ids := []string{first}
	for range 104 {
		id, err := s.create(desktopTaskCreateInput{Actor: desktopLocalActor(), TaskType: "command", Title: "recover"})
		if err != nil {
			t.Fatal(err)
		}
		if err := s.start(id, "executing"); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	queued, err := s.create(desktopTaskCreateInput{Actor: desktopLocalActor(), TaskType: "command", Title: "never started"})
	if err != nil {
		t.Fatal(err)
	}
	const result = `{"output":"observed partial"}`
	if _, err := s.db.Exec("UPDATE desktop_task_runs SET result_json=?,progress_json=?,success_count=1 WHERE status='running'", result, `{"observed":1}`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := s.recoverInterrupted(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range ids {
		run, err := s.getRun(id)
		if err != nil || run.Status != "unknown" || run.ResultJSON != result || run.ProgressJSON != `{"observed":1}` || run.SuccessCount != 1 {
			t.Fatalf("lost partial result: %+v %v", run, err)
		}
	}
	run, err := s.getRun(queued)
	if err != nil || run.Status != "canceled" {
		t.Fatalf("unstarted task reported as executed: %+v %v", run, err)
	}
}
