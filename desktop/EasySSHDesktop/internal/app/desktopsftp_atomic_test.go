package app

import (
	"context"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
)

func TestDesktopLocalDownloadFailureAndCancellationKeepDestination(t *testing.T) {
	for _, canceled := range []bool{false, true} {
		dir := t.TempDir()
		target := filepath.Join(dir, "existing")
		if err := os.WriteFile(target, []byte("original"), 0600); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		err := writeDesktopLocalAtomic(ctx, target, func(file *os.File) error {
			if _, err := file.WriteString("incomplete"); err != nil {
				return err
			}
			if canceled {
				cancel()
				return nil
			}
			return io.ErrUnexpectedEOF
		})
		cancel()
		if err == nil {
			t.Fatal("incomplete write committed")
		}
		data, err := os.ReadFile(target)
		if err != nil || string(data) != "original" {
			t.Fatalf("destination changed: %q %v", data, err)
		}
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) != 1 {
			t.Fatalf("temporary file leaked: %v %v", entries, err)
		}
	}
}

func TestDesktopLocalDownloadDoesNotOverwriteConcurrentChange(t *testing.T) {
	target := filepath.Join(t.TempDir(), "existing")
	if err := os.WriteFile(target, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	err := writeDesktopLocalAtomic(context.Background(), target, func(file *os.File) error {
		if _, err := file.WriteString("download"); err != nil {
			return err
		}
		return os.WriteFile(target, []byte("concurrent edit"), 0600)
	})
	if err == nil {
		t.Fatal("concurrent destination change ignored")
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "concurrent edit" {
		t.Fatalf("concurrent edit lost: %q %v", data, err)
	}
}

func desktopAtomicSFTPFixture(t *testing.T) *sftp.Client {
	t.Helper()
	serverConn, clientConn := net.Pipe()
	server, err := sftp.NewServer(serverConn)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve() }()
	client, err := sftp.NewClientPipe(clientConn, clientConn)
	if err != nil {
		_ = server.Close()
		_ = clientConn.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close(); _ = server.Close(); _ = serverConn.Close(); <-done })
	return client
}

func TestDesktopRemoteReplacementKeepsOldFileUntilSuccessfulCommit(t *testing.T) {
	client := desktopAtomicSFTPFixture(t)
	dir := t.TempDir()
	target := filepath.Join(dir, "existing")
	if err := os.WriteFile(target, []byte("original"), 0640); err != nil {
		t.Fatal(err)
	}
	_, err := writeDesktopSFTPAtomic(context.Background(), client, target, 0600, func(file *sftp.File) error {
		if _, err := file.Write([]byte("partial")); err != nil {
			return err
		}
		return io.ErrUnexpectedEOF
	})
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("copy failure lost: %v", err)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "original" {
		t.Fatalf("old file damaged: %q %v", data, err)
	}
	info, err := writeDesktopSFTPAtomic(context.Background(), client, target, 0600, func(file *sftp.File) error {
		_, err := io.Copy(file, strings.NewReader("replacement"))
		return err
	})
	if err != nil || info.Name != "existing" || info.Size != int64(len("replacement")) {
		t.Fatalf("commit failed: %+v %v", info, err)
	}
	stat, err := os.Stat(target)
	if err != nil || stat.Mode().Perm() != 0640 {
		t.Fatalf("existing mode changed: %v %v", stat, err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("temporary file leaked: %v %v", entries, err)
	}
}

func TestDesktopRemoteReplacementRejectsSymlinkAndChangingSource(t *testing.T) {
	client := desktopAtomicSFTPFixture(t)
	dir := t.TempDir()
	target := filepath.Join(dir, "source")
	if err := os.WriteFile(target, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	expected, err := client.Lstat(target)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(target, []byte("changed length"), 0600); err != nil {
		t.Fatal(err)
	}
	source, err := client.Open(target)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	if _, err = copyDesktopSFTPExact(io.Discard, source, expected); err == nil {
		t.Fatal("changed source accepted")
	}
	link := filepath.Join(dir, "link")
	if err = os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err = writeDesktopSFTPAtomic(context.Background(), client, link, 0600, func(*sftp.File) error {
		t.Fatal("symlink target opened for writing")
		return nil
	}); err == nil {
		t.Fatal("symlink accepted")
	}
}

func TestDesktopSFTPShutdownCancelsAndWaitsForObservedResult(t *testing.T) {
	s := NewDesktopSFTPService(nil, nil, nil)
	ctx, done, err := s.beginOperation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	go func() { _ = s.ServiceShutdown(); close(finished) }()
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("shutdown did not interrupt active operation")
	}
	if _, _, err = s.beginOperation(context.Background()); err == nil {
		t.Fatal("new operation accepted during shutdown")
	}
	select {
	case <-finished:
		t.Fatal("shutdown returned before executor handed off its result")
	default:
	}
	done()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not finish after executor exited")
	}
}

func TestDesktopCancellationCannotRewriteAmbiguousCommitOrSuccess(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := desktopSFTPOperationError(ctx, nil); err != nil {
		t.Fatal("late cancellation replaced success")
	}
	if err := desktopSFTPOperationError(ctx, errDesktopSFTPCommitUnknown); !errors.Is(err, errDesktopSFTPCommitUnknown) || errors.Is(err, errDesktopSFTPTaskCancelled) {
		t.Fatal("unknown commit reported canceled")
	}
	if err := desktopSFTPOperationError(ctx, io.ErrClosedPipe); !errors.Is(err, errDesktopSFTPTaskCancelled) {
		t.Fatal("interrupted I/O reported as ordinary failure")
	}
}
