package app

import (
	"context"
	"errors"
	"testing"

	"github.com/easyssh/shared/sshutil"
	"golang.org/x/crypto/ssh"
)

func TestCommandTransportLossDoesNotInventExitStatus(t *testing.T) {
	for _, err := range []error{errors.New("transport closed"), &ssh.ExitMissingError{}, context.Canceled, context.DeadlineExceeded} {
		outcome, code, message := sshutil.CommandOutcome(err)
		if outcome != "unknown" || code != nil || message == "" {
			t.Fatalf("unconfirmed remote result became an exit: %s %v %q", outcome, code, message)
		}
	}
	outcome, code, message := sshutil.CommandOutcome(nil)
	if outcome != "succeeded" || code == nil || *code != 0 || message != "" {
		t.Fatal("confirmed success lost")
	}
}

func TestUnknownScriptTargetSurvivesPersistenceAndRecovery(t *testing.T) {
	s, id := desktopBatchCompletionFixture(t)
	now := desktopTaskNow()
	target := desktopBatchTaskResult{ID: "unconfirmed", TaskID: id, ServerID: "11111111-1111-4111-8111-111111111111", Status: "unknown", StartedAt: now, CompletedAt: now}
	for range 2 {
		tx, err := s.db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err := saveDesktopTaskTarget(tx, target); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	var missing bool
	if err := s.db.QueryRow(`SELECT exit_code IS NULL FROM desktop_batch_task_results WHERE id=?`, target.ID).Scan(&missing); err != nil || !missing {
		t.Fatalf("unknown exit stored as zero: %v", err)
	}
	item, err := scanDesktopActivity(s.db.QueryRow(desktopActivitySelectSQL+` WHERE source_table='desktop_batch_task_results' AND source_id=?`, target.ID))
	if err != nil || item.Status != "unknown" || item.SuccessCount != 0 || item.FailureCount != 0 {
		t.Fatalf("unknown target counted as failure: %+v %v", item, err)
	}
	if err := s.recoverInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	run, err := s.getRun(id)
	if err != nil || run.Status != "unknown" || run.FailureCount != 0 || run.Retryable {
		t.Fatalf("recovery changed unknown semantics: %+v %v", run, err)
	}
}
