package transferjob

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sftputil"
	"github.com/google/uuid"
	"github.com/pkg/sftp"
)

func relayTestClient(t *testing.T) *sftp.Client {
	t.Helper()
	clientConn, serverConn := net.Pipe()
	server, err := sftp.NewServer(serverConn)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve() }()
	t.Cleanup(func() { _ = clientConn.Close(); _ = serverConn.Close(); <-done })
	client, err := sftp.NewClientPipe(clientConn, clientConn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func TestRelayPlanBoundsTreeAndDoesNotFollowLinks(t *testing.T) {
	root := filepath.Join(t.TempDir(), "source")
	if err := os.MkdirAll(filepath.Join(root, "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "nested", "payload"), []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	client := relayTestClient(t)
	cfg := downloadConfig()
	plan, err := planRelay(context.Background(), client, root, cfg)
	if err != nil || len(plan.files) != 1 || len(plan.directories) != 2 || plan.bytes != 4 {
		t.Fatalf("plan=%+v err=%v", plan, err)
	}
	cfg.TransferMaxEntries = 2
	if _, err := planRelay(context.Background(), client, root, cfg); err == nil {
		t.Fatal("entry limit bypassed")
	}
	cfg.TransferMaxEntries, cfg.TransferMaxDepth = 100, 1
	if _, err := planRelay(context.Background(), client, root, cfg); err == nil {
		t.Fatal("depth limit bypassed")
	}
	cfg.TransferMaxDepth = 10
	if err := os.Symlink(filepath.Join(root, "nested", "payload"), filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if _, err := planRelay(context.Background(), client, root, cfg); err == nil {
		t.Fatal("symlink accepted")
	}
}

func TestRelaySuffixAndCommitDoNotOverwrite(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	client := relayTestClient(t)
	root := t.TempDir()
	source := filepath.Join(t.TempDir(), "report.txt")
	if err := os.WriteFile(source, []byte("payload"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"report.txt", "report (2).txt"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("original"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	destination, err := relayDestination(ctx, client, root, "report.txt", 10)
	if err != nil || destination != filepath.Join(root, "report (3).txt") {
		t.Fatalf("destination=%s err=%v", destination, err)
	}
	info, err := client.Lstat(source)
	if err != nil {
		t.Fatal(err)
	}
	file := relayFile{source: source, info: info}
	readReq := access.Requirement{Action: protocol.FilesDownload, ServerID: uuid.NewString()}
	writeReq := access.Requirement{Action: protocol.FilesUpload, ServerID: uuid.NewString()}
	var copied int
	if err := copyRelayFile(ctx, client, client, file, destination, readReq, writeReq, func(n int) { copied += n }); err != nil {
		t.Fatal(err)
	}
	if copied != 7 {
		t.Fatalf("copied=%d", copied)
	}
	// A destination created after name selection also must not be replaced.
	if err := copyRelayFile(ctx, client, client, file, filepath.Join(root, "report.txt"), readReq, writeReq, func(int) {}); err == nil {
		t.Fatal("existing destination replaced")
	}
	body, err := os.ReadFile(filepath.Join(root, "report.txt"))
	if err != nil || string(body) != "original" {
		t.Fatalf("original changed: %q %v", body, err)
	}
	// The destination can also become occupied while the temporary file is
	// being written. Committing it must leave the concurrent writer's file intact.
	raced := filepath.Join(root, "raced.txt")
	err = copyRelayFile(ctx, client, client, file, raced, readReq, writeReq, func(int) {
		if err := os.WriteFile(raced, []byte("concurrent"), 0600); err != nil {
			t.Fatal(err)
		}
	})
	if err == nil {
		t.Fatal("concurrently created destination replaced")
	}
	body, err = os.ReadFile(raced)
	if err != nil || string(body) != "concurrent" {
		t.Fatalf("concurrent file changed: %q %v", body, err)
	}
	leftovers, err := filepath.Glob(filepath.Join(root, ".easyssh-transfer-*"))
	if err != nil || len(leftovers) != 0 {
		t.Fatalf("temporary files retained: %v %v", leftovers, err)
	}
}

func TestRelaySourceChangeAndCancellationDoNotCommit(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	client := relayTestClient(t)
	source := filepath.Join(t.TempDir(), "source")
	if err := os.WriteFile(source, []byte("payload"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := client.Lstat(source)
	if err != nil {
		t.Fatal(err)
	}
	file := relayFile{source: source, info: info}
	destination := filepath.Join(t.TempDir(), "target")
	readReq := access.Requirement{Action: protocol.FilesDownload, ServerID: uuid.NewString()}
	writeReq := access.Requirement{Action: protocol.FilesUpload, ServerID: uuid.NewString()}
	cancelled, cancel := context.WithCancel(ctx)
	err = copyRelayFile(cancelled, client, client, file, destination, readReq, writeReq, func(int) { cancel() })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel=%v", err)
	}
	if _, err := os.Stat(destination); !os.IsNotExist(err) {
		t.Fatal("cancelled output committed")
	}
	if err := os.WriteFile(source, []byte("changed size"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := copyRelayFile(ctx, client, client, file, destination, readReq, writeReq, func(int) {}); err == nil {
		t.Fatal("changed source accepted")
	}
}

func TestRelayAdmissionAndRecoveryKeepPartialFacts(t *testing.T) {
	ctx, s, db, upload := uploadFixture(t)
	job, err := s.CreateRelayJob(ctx, &protocol.TransferRelayInput{SourceServerID: upload.ServerID, TargetServerID: uuid.NewString(), SourcePath: "/source", TargetPath: "/destination"})
	if err != nil {
		t.Fatal(err)
	}
	if job.Kind != JobKindSFTPTransfer || job.TaskRunID == nil || job.ArtifactManaged {
		t.Fatalf("invalid relay admission: %+v", job)
	}
	assertUploadQueue(t, db, job.ID, 1)
	repo := NewRepository(db, nil, nil)
	now := time.Now().UTC()
	if err := repo.Update(ctx, job.ID, map[string]interface{}{"status": JobStatusRunning, "started_at": &now, "bytes_total": 20, "bytes_processed": 15, "bytes_completed": 10, "files_total": 2, "files_completed": 1, "result_path": "/destination/source (2)"}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.RecoverInterrupted(ctx); err != nil {
		t.Fatal(err)
	}
	recovered, err := repo.GetByID(ctx, job.ID)
	if err != nil || recovered.Status != JobStatusUnknown || recovered.BytesCompleted != 10 || recovered.FilesCompleted != 1 || recovered.ResultPath != "/destination/source (2)" {
		t.Fatalf("recovery lost partial facts: %+v %v", recovered, err)
	}
	var activity operationrecord.OperationRecord
	if err := db.Where("source_table = ? AND source_id = ?", "transfer_jobs", job.ID.String()).First(&activity).Error; err != nil {
		t.Fatal(err)
	}
	if activity.Status != operationrecord.StatusUnknown || activity.BytesCompleted != 10 || activity.SuccessCount != 1 {
		t.Fatalf("incorrect activity: %+v", activity)
	}
	// Unknown results remain observations; no SSH pool is needed to settle them.
	observed := observedOutcome(ctx, recovered, sftputil.ErrMutationOutcomeUnknown, job.Stage)
	if observed.BytesCompleted != 10 || observed.FilesCompleted != 1 {
		t.Fatal("uncertainty discarded known commits")
	}
}
