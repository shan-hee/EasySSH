package app

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/pkg/sftp"
)

func TestDesktopDeletePreservesConfirmedEffectsOnCancellation(t *testing.T) {
	client := desktopAtomicSFTPFixture(t)
	target := filepath.Join(t.TempDir(), "removed")
	if err := os.WriteFile(target, []byte("payload"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	var effects DesktopSFTPDeleteEffects
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err = removeDesktopSFTPEntry(ctx, client, target, info, &effects); err != nil {
		t.Fatal(err)
	}
	cancel()
	if err = removeDesktopSFTPEntry(ctx, client, target, info, &effects); !errors.Is(err, errDesktopSFTPTaskCancelled) {
		t.Fatalf("canceled delete continued: %v", err)
	}
	if effects.FilesRemoved != 1 || effects.BytesRemoved != 7 || effects.UncertainPath != "" {
		t.Fatalf("confirmed work lost: %+v", effects)
	}
}

type desktopDropDeleteResponse struct{ conn net.Conn }

func (h desktopDropDeleteResponse) Filecmd(request *sftp.Request) error {
	if request.Method != "Remove" {
		return errors.New("unexpected request")
	}
	if err := os.Remove(request.Filepath); err != nil {
		return err
	}
	// The effect happened, but the client never receives SSH_FXP_STATUS.
	_ = h.conn.Close()
	return nil
}

func TestDesktopDeleteLostResponseIsUnknownEvenWhenCanceled(t *testing.T) {
	serverConn, clientConn := net.Pipe()
	server := sftp.NewRequestServer(serverConn, sftp.Handlers{FileCmd: desktopDropDeleteResponse{serverConn}})
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve() }()
	client, err := sftp.NewClientPipe(clientConn, clientConn)
	if err != nil {
		_ = server.Close()
		_ = clientConn.Close()
		t.Fatal(err)
	}
	defer func() { _ = client.Close(); _ = server.Close(); <-done }()
	target := filepath.Join(t.TempDir(), "removed")
	if err = os.WriteFile(target, []byte("payload"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	var effects DesktopSFTPDeleteEffects
	ctx, cancel := context.WithCancel(context.Background())
	err = removeDesktopSFTPEntry(ctx, client, target, info, &effects)
	cancel()
	err = desktopSFTPOperationError(ctx, err)
	if !errors.Is(err, errDesktopSFTPDeleteUnknown) || errors.Is(err, errDesktopSFTPTaskCancelled) || effects.UncertainPath != target || effects.FilesRemoved != 0 {
		t.Fatalf("ambiguous effect misreported: %+v %v", effects, err)
	}
	if _, err = os.Stat(target); !os.IsNotExist(err) {
		t.Fatalf("fixture did not delete before dropping response: %v", err)
	}
}
