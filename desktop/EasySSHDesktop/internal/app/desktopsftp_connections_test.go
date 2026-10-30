package app

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func desktopFileSSHPeer(t *testing.T) (DesktopServer, *ssh.ClientConfig, *atomic.Int32) {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		t.Fatal(err)
	}
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	accepted := &atomic.Int32{}
	var mu sync.Mutex
	var transport net.Conn
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		accepted.Add(1)
		mu.Lock()
		transport = conn
		mu.Unlock()
		defer conn.Close()
		server, channels, requests, err := ssh.NewServerConn(conn, config)
		if err != nil {
			return
		}
		defer server.Close()
		requestsDone := make(chan struct{})
		go func() { defer close(requestsDone); ssh.DiscardRequests(requests) }()
		for channel := range channels {
			_ = channel.Reject(ssh.Prohibited, "fixture has no execution channels")
		}
		<-requestsDone
	}()
	t.Cleanup(func() {
		_ = listener.Close()
		mu.Lock()
		if transport != nil {
			_ = transport.Close()
		}
		mu.Unlock()
		<-done
	})
	host, portText, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, _ := strconv.Atoi(portText)
	return DesktopServer{ID: "file-server", Name: "files", Host: host, Port: port}, &ssh.ClientConfig{User: "fixture", HostKeyCallback: ssh.InsecureIgnoreHostKey(), Timeout: time.Second}, accepted
}

func TestFileConnectionReusesOneFactAndOutlivesAuthenticationRequest(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	activity := &ActivityLogService{db: tasks.db}
	server, config, accepted := desktopFileSSHPeer(t)
	files := NewDesktopSFTPService(nil, tasks, activity)
	t.Cleanup(func() { _ = files.ServiceShutdown() })
	ctx, cancel := context.WithCancel(context.Background())
	client, closeClient, err := files.dialFileSSH(ctx, server, config, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err = files.setAuthenticatedSSHClient(server.ID, client, closeClient, 1, 0); err != nil {
		t.Fatal(err)
	}
	cancel()
	for i := 0; i < 3; i++ {
		borrowed, release, ok := files.acquireAuthenticatedSSHClient(server.ID, 1)
		if !ok || borrowed != client {
			t.Fatal("authentication request cancellation closed cached transport")
		}
		release()
	}
	var count int
	if err = tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_connections WHERE action='sftp_connect' AND status='running' AND established_at<>''`).Scan(&count); err != nil || count != 1 || accepted.Load() != 1 {
		t.Fatalf("reuse inflated connection count: %d %d %v", count, accepted.Load(), err)
	}
	files.clearAuthenticatedSSHClient(server.ID)
	if err = tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_connections WHERE action='sftp_connect' AND status='success' AND finished_at<>''`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("explicit close did not wait for its outcome: %d %v", count, err)
	}
	if len(activity.liveConnections) != 0 {
		t.Fatal("closed transport left an active observation")
	}
}

func TestFileConnectionAdmissionFailureDoesNotDial(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	activity := &ActivityLogService{db: tasks.db}
	server, config, accepted := desktopFileSSHPeer(t)
	files := NewDesktopSFTPService(nil, tasks, activity)
	t.Cleanup(func() { _ = files.ServiceShutdown() })
	if _, err := tasks.db.Exec(`CREATE TRIGGER reject_file_observation BEFORE INSERT ON desktop_connections BEGIN SELECT RAISE(ABORT,'unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if _, _, err := files.dialFileSSH(context.Background(), server, config, time.Second); err == nil {
		t.Fatal("connected without a durable fact")
	}
	if accepted.Load() != 0 || len(activity.liveConnections) != 0 || len(files.operations) != 0 {
		t.Fatal("failed observation admission left network or lifecycle work")
	}
}

func TestFileServiceShutdownWaitsForUncachedConnectionOutcome(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	activity := &ActivityLogService{db: tasks.db}
	server, config, _ := desktopFileSSHPeer(t)
	files := NewDesktopSFTPService(nil, tasks, activity)
	_, closeClient, err := files.dialFileSSH(context.Background(), server, config, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer closeClient()
	if err = files.ServiceShutdown(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_connections WHERE finished_at=''`).Scan(&count); err != nil || count != 0 || len(files.operations) != 0 {
		t.Fatalf("shutdown escaped connection workers: %d %v", count, err)
	}
	if _, _, err = files.dialFileSSH(context.Background(), server, config, time.Second); err == nil {
		t.Fatal("shutdown accepted another connection")
	}
}

func TestFileCacheRejectsChangedConnectionRevision(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	activity := &ActivityLogService{db: tasks.db}
	server, config, _ := desktopFileSSHPeer(t)
	files := NewDesktopSFTPService(nil, tasks, activity)
	t.Cleanup(func() { _ = files.ServiceShutdown() })
	client, closeClient, err := files.dialFileSSH(context.Background(), server, config, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if err = files.setAuthenticatedSSHClient(server.ID, client, closeClient, 1, 0); err != nil {
		t.Fatal(err)
	}
	if _, _, ok := files.acquireAuthenticatedSSHClient(server.ID, 2); ok {
		t.Fatal("borrowed transport authenticated against an old configuration")
	}
	var count int
	if err = tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_connections WHERE status='success' AND finished_at<>''`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("invalidated connection outcome missing: %d %v", count, err)
	}
}
