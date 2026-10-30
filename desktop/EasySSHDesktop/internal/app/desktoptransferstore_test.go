package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func desktopTransferTestIntent() desktopTransferIntent {
	return desktopTransferIntent{Kind: desktopSFTPTaskTransfer, FileName: "source", SourceServerID: uuid.NewString(), TargetServerID: uuid.NewString(), SourcePaths: []string{"/source"}, TargetPath: "/destination"}
}

func TestDesktopTransferAdmissionRollsBackWithIntent(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	files := NewDesktopSFTPService(nil, tasks, nil)
	if _, err := tasks.db.Exec(`CREATE TRIGGER reject_transfer BEFORE INSERT ON transfer_jobs BEGIN SELECT RAISE(ABORT,'intent unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	id := uuid.NewString()
	if _, err := files.createTransferTask(context.Background(), id, 20, desktopTransferTestIntent()); err == nil {
		t.Fatal("accepted work without intent")
	}
	for _, query := range []string{`SELECT COUNT(*) FROM desktop_task_runs WHERE id=?`, `SELECT COUNT(*) FROM transfer_jobs WHERE id=?`, `SELECT COUNT(*) FROM activity_logs WHERE source_id=?`} {
		var count int
		if err := tasks.db.QueryRow(query, id).Scan(&count); err != nil || count != 0 {
			t.Fatalf("admission escaped transaction: %s count=%d err=%v", query, count, err)
		}
	}
	if len(files.tasks) != 0 {
		t.Fatal("failed admission retained executor")
	}
}

func TestDesktopTransferRestartRetainsEndpointsAndCommittedFiles(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	files := NewDesktopSFTPService(nil, tasks, nil)
	intent := desktopTransferTestIntent()
	id, err := files.createTransferTask(context.Background(), "", 20, intent)
	if err != nil {
		t.Fatal(err)
	}
	if err := files.startTask(id, "transferring", 20); err != nil {
		t.Fatal(err)
	}
	if err := files.prepareTransferDestination(id, "/destination/source (2)", 20, 2); err != nil {
		t.Fatal(err)
	}
	if err := files.updateTaskProgress(id, 10, 20, "stream"); err != nil {
		t.Fatal(err)
	}
	if err := files.recordTransferCommit(id, desktopSFTPTransferStats{FilesCopied: 1, BytesCopied: 10}); err != nil {
		t.Fatal(err)
	}
	// Later in-flight progress must not reset the already committed file count.
	if err := files.updateTaskProgress(id, 12, 20, "second_file"); err != nil {
		t.Fatal(err)
	}
	if err := tasks.recoverInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	reopened := NewDesktopSFTPService(nil, tasks, nil)
	job, err := reopened.GetTransfer(id)
	if err != nil || job.Status != "unknown" || job.BytesCompleted != 10 || job.BytesProcessed != 12 || job.FilesCompleted != 1 || job.ResultPath != "/destination/source (2)" || job.SourceServerID.String() != intent.SourceServerID || job.TargetServerID.String() != intent.TargetServerID {
		t.Fatalf("recovery: %+v %v", job, err)
	}
	list, err := reopened.ListTransfers(protocol.TransferListInput{Kind: "sftp_transfer", PageSize: 1})
	if err != nil || list.Total != 1 || len(list.Jobs) != 1 || list.Jobs[0].ID.String() != id {
		t.Fatalf("persistent list: %+v %v", list, err)
	}
}

func TestDesktopTransferIntentClearsWithTaskRetention(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	files := NewDesktopSFTPService(nil, tasks, nil)
	id, err := files.createTransferTask(context.Background(), "", 20, desktopTransferTestIntent())
	if err != nil {
		t.Fatal(err)
	}
	if err := files.startTask(id, "transferring", 20); err != nil {
		t.Fatal(err)
	}
	if err := files.failTask(id, errors.New("source missing")); err != nil {
		t.Fatal(err)
	}
	if _, err := tasks.db.Exec(`DELETE FROM desktop_task_runs WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := tasks.db.QueryRow(`SELECT COUNT(*) FROM transfer_jobs WHERE id=?`, id).Scan(&count); err != nil || count != 0 {
		t.Fatalf("orphaned intent count=%d err=%v", count, err)
	}
}

func TestDesktopRelaySuffixAndCommitRejectConcurrentTarget(t *testing.T) {
	client := desktopAtomicSFTPFixture(t)
	root := t.TempDir()
	original := filepath.Join(root, "report.txt")
	if err := os.WriteFile(original, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	destination, err := desktopRelayDestination(context.Background(), client, root, "report.txt", 100)
	if err != nil || destination != filepath.Join(root, "report (2).txt") {
		t.Fatalf("suffix: %s %v", destination, err)
	}
	source := filepath.Join(t.TempDir(), "source")
	if err := os.WriteFile(source, []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	selection, err := normalizeDesktopTransferSelection([]string{source}, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := planDesktopTransfer(context.Background(), client, selection, protocol.TransferLimits{MaxEntries: 100, MaxDepth: 8})
	if err != nil {
		t.Fatal(err)
	}
	stats, err := copyDesktopSFTPPlan(context.Background(), client, client, plan, destination, nil, nil, nil)
	if err != nil || stats.FilesCopied != 1 || stats.BytesCopied != 3 {
		t.Fatalf("copy: %+v %v", stats, err)
	}
	if _, err := copyDesktopSFTPPlan(context.Background(), client, client, plan, original, nil, nil, nil); err == nil {
		t.Fatal("existing file replaced")
	}
	body, err := os.ReadFile(original)
	if err != nil || string(body) != "original" {
		t.Fatal("original corrupted", err)
	}
}
