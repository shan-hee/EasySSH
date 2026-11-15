package app

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/easyssh/shared/aiworkspace"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// Exercise the real desktop read/prepare/execute path over SSH and SFTP, using
// the same local filesystem-backed SFTP server as the atomic-write fixtures.
func desktopAIFileFixture(t *testing.T) (*DesktopAIService, string) {
	t.Helper()
	tasks, _ := desktopTaskFixture(t)
	servers := &DesktopServerService{db: tasks.db}
	const serverID = "ai-file-server"
	if _, err := tasks.db.Exec(`INSERT INTO desktop_servers(id,name,host,username,created_at,updated_at) VALUES(?,'files','localhost','fixture','','')`, serverID); err != nil {
		t.Fatalf("insert fixture server: %v", err)
	}
	// desktop_server_details inner-joins auth. The cached SSH connection below
	// supplies authentication, so password and ssh_key_id can keep their defaults.
	if _, err := tasks.db.Exec(`INSERT INTO desktop_server_auth(server_id,auth_method) VALUES(?,'password')`, serverID); err != nil {
		t.Fatalf("insert fixture server auth: %v", err)
	}
	stored, err := servers.getByIDStored(serverID)
	if err != nil {
		t.Fatalf("load fixture server details: %v", err)
	}
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
	var mu sync.Mutex
	var transport net.Conn
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		mu.Lock()
		transport = conn
		mu.Unlock()
		defer conn.Close()
		server, channels, requests, err := ssh.NewServerConn(conn, config)
		if err != nil {
			return
		}
		defer server.Close()
		var workers sync.WaitGroup
		workers.Go(func() { ssh.DiscardRequests(requests) })
		for request := range channels {
			if request.ChannelType() != "session" {
				_ = request.Reject(ssh.UnknownChannelType, "session required")
				continue
			}
			channel, requests, err := request.Accept()
			if err != nil {
				continue
			}
			workers.Go(func() {
				defer channel.Close()
				for request := range requests {
					var subsystem struct{ Name string }
					if request.Type != "subsystem" || ssh.Unmarshal(request.Payload, &subsystem) != nil || subsystem.Name != "sftp" {
						_ = request.Reply(false, nil)
						continue
					}
					_ = request.Reply(true, nil)
					fileServer, err := sftp.NewServer(channel)
					if err != nil {
						return
					}
					defer fileServer.Close()
					_ = fileServer.Serve()
					return
				}
			})
		}
		workers.Wait()
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
	client, err := ssh.Dial("tcp", listener.Addr().String(), &ssh.ClientConfig{
		User: "fixture", HostKeyCallback: ssh.InsecureIgnoreHostKey(), Timeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	// Reads reuse this connection at the stored revision and do not dial through
	// the activity logger. Both tests reject writes before a mutation task starts.
	files := NewDesktopSFTPService(servers, tasks, nil)
	t.Cleanup(func() { _ = files.ServiceShutdown() })
	if err := files.setAuthenticatedSSHClient(serverID, client, func() { _ = client.Close() }, stored.connectionRevision, 0); err != nil {
		t.Fatal(err)
	}
	return &DesktopAIService{sftpService: files}, serverID
}

func TestDesktopAIWriteRejectsExpectedSHA256Mismatch(t *testing.T) {
	service, serverID := desktopAIFileFixture(t)
	for _, deleted := range []bool{false, true} {
		t.Run(map[bool]string{false: "changed since read", true: "deleted since read"}[deleted], func(t *testing.T) {
			target := filepath.Join(t.TempDir(), "file.txt")
			if !deleted {
				if err := os.WriteFile(target, []byte("concurrent edit"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			args := map[string]any{
				"server_id": serverID, "path": desktopSFTPTestPath(target),
				"content": "proposed", "expected_sha256": aiworkspace.Hash("original"),
			}
			prepared, err := service.prepareDesktopWrite(context.Background(), args)
			if prepared != nil || err == nil || !strings.Contains(err.Error(), "文件在读取后已变化或已被删除") {
				t.Fatalf("stale read was not rejected: %+v %v", prepared, err)
			}
			data, readErr := os.ReadFile(target)
			if deleted {
				if !errors.Is(readErr, os.ErrNotExist) {
					t.Fatalf("deleted file was recreated: %q %v", data, readErr)
				}
			} else if readErr != nil || string(data) != "concurrent edit" {
				t.Fatalf("remote file changed: %q %v", data, readErr)
			}
		})
	}
}

func TestDesktopAIWriteRechecksBaselineAfterPreview(t *testing.T) {
	service, serverID := desktopAIFileFixture(t)
	for _, tc := range []struct {
		name                       string
		expected, existed, deleted bool
	}{
		{"changed after preview", true, true, false},
		{"deleted after preview", true, true, true},
		{"hash omitted still checks preview", false, true, false},
		{"created after preview", false, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			target := filepath.Join(t.TempDir(), "file.txt")
			original := "\x1b[31moriginal\x1b[0m\n"
			if tc.existed {
				if err := os.WriteFile(target, []byte(original), 0600); err != nil {
					t.Fatal(err)
				}
			}
			args := map[string]any{"server_id": serverID, "path": desktopSFTPTestPath(target), "content": "proposed"}
			if tc.expected {
				read, err := service.executeDesktopAITool(context.Background(), "read_file", args)
				if err != nil || read.IsError {
					t.Fatalf("read failed: %+v %v", read, err)
				}
				_, hashPart, found := strings.Cut(read.Content, "sha256=")
				if !found || len(hashPart) < 64 {
					t.Fatalf("missing read hash: %q", read.Content)
				}
				args["expected_sha256"] = hashPart[:64]
				if args["expected_sha256"] != aiworkspace.Hash(original) {
					t.Fatal("read hash does not cover raw file")
				}
			}
			prepared, err := service.prepareDesktopWrite(context.Background(), args)
			if err != nil {
				t.Fatalf("matching read should prepare successfully: %v", err)
			}
			if tc.deleted {
				err = os.Remove(target)
			} else {
				err = os.WriteFile(target, []byte("concurrent edit"), 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			_, err = service.executeDesktopAITool(aiworkspace.WithFile(context.Background(), prepared), "write_file", args)
			if err == nil || !strings.Contains(err.Error(), "文件在预览后已变化") {
				t.Fatalf("preview baseline was not rechecked: %v", err)
			}
			data, readErr := os.ReadFile(target)
			if tc.deleted {
				if !errors.Is(readErr, os.ErrNotExist) {
					t.Fatalf("deleted file was recreated: %q %v", data, readErr)
				}
			} else if readErr != nil || string(data) != "concurrent edit" {
				t.Fatalf("concurrent edit was overwritten: %q %v", data, readErr)
			}
		})
	}
}
