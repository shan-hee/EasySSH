package instanceactivation

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/shared/instancebackup"
)

// Helpers run only in the re-executed test binary and use temporary fixture files.
func TestMain(m *testing.M) {
	switch os.Getenv("EASYSSH_ACTIVATION_TEST_HELPER") {
	case "logs":
		fmt.Fprintln(os.Stdout, "child stdout is visible")
		fmt.Fprintln(os.Stderr, "child stderr is visible")
		os.Exit(0)
	case "instance":
		contents, err := os.ReadFile(os.Getenv("DB_DSN"))
		if err != nil || string(contents) == "fail-startup" {
			os.Exit(41)
		}
		client := FromEnvironment()
		ctx := context.Background()
		if client == nil || client.Ready(ctx) != nil || client.Serving(ctx) != nil {
			os.Exit(42)
		}
		if err := atomicJSON(os.Getenv("EASYSSH_TEST_BROKER"), map[string]string{"address": os.Getenv(addressEnv), "token": os.Getenv(tokenEnv)}); err != nil {
			os.Exit(43)
		}
		shutdown := client.Shutdown(ctx)
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-shutdown:
				os.Exit(0)
			case <-ticker.C:
				if _, err := os.Stat(os.Getenv("EASYSSH_TEST_EXIT")); err == nil {
					os.Exit(0)
				}
			}
		}
	}
	os.Exit(m.Run())
}

func TestHiddenChildForwardsBothOutputStreams(t *testing.T) {
	cmd := exec.Command(os.Args[0], "-test.run=^$")
	cmd.Env = append(os.Environ(), "EASYSSH_ACTIVATION_TEST_HELPER=logs")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = logForwarder{&stdout}, logForwarder{&stderr}
	child, err := startChild(cmd, false)
	if err != nil {
		t.Fatal(err)
	}
	defer child.close()
	select {
	case err := <-child.done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		child.terminate()
		<-child.done
		t.Fatal("hidden child did not exit")
	}
	if !strings.Contains(stdout.String(), "child stdout is visible") || !strings.Contains(stderr.String(), "child stderr is visible") {
		t.Fatalf("lost child logs: stdout=%q stderr=%q", stdout.String(), stderr.String())
	}
}

func TestSupervisorSwitchRollbackAndFailedCandidate(t *testing.T) {
	root := t.TempDir()
	backups := filepath.Join(root, "backups")
	original := filepath.Join(root, "original")
	state := filepath.Join(root, "runtime")
	brokerFile, exitFile := filepath.Join(root, "broker.json"), filepath.Join(root, "exit")
	key := base64.StdEncoding.EncodeToString(make([]byte, 32))
	write := func(name, contents string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(original, "easyssh.db"), "original")
	requests := make([]Request, 2)
	for i, contents := range []string{"restored", "fail-startup"} {
		id := fmt.Sprintf("%032x", i+1)
		dir := filepath.Join(backups, "restored", id)
		write(filepath.Join(dir, "easyssh.db"), contents)
		write(filepath.Join(dir, "easyssh-root.key"), key)
		if err := atomicJSON(filepath.Join(backups, id+".json"), instancebackup.Record{ID: id, Status: "ready", Driver: "sqlite", RestoredTo: dir}); err != nil {
			t.Fatal(err)
		}
		requests[i] = Request{RecordID: id, Directory: dir}
	}
	done := make(chan error, 1)
	go func() {
		done <- RunWithOptions(state, Target{DSN: filepath.Join(original, "easyssh.db"), Directory: original}, key, backups, Options{
			Environment: func(target Target, _ string, _ string) map[string]string {
				return map[string]string{"EASYSSH_ACTIVATION_TEST_HELPER": "instance", "DB_DSN": target.DSN, "EASYSSH_TEST_BROKER": brokerFile, "EASYSSH_TEST_EXIT": exitFile}
			},
		})
	}()
	t.Cleanup(func() {
		_ = os.WriteFile(exitFile, nil, 0600)
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("launcher exit: %v", err)
			}
		case <-time.After(15 * time.Second):
			t.Error("launcher did not exit after final child")
		}
	})
	await := func(id, status, directory string) *Client {
		t.Helper()
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			var address map[string]string
			b, err := os.ReadFile(brokerFile)
			if err == nil && json.Unmarshal(b, &address) == nil {
				client := &Client{address: address["address"], token: address["token"]}
				info, err := client.Info(context.Background())
				if err == nil && info.ActiveDirectory == directory && (id == "" || (info.Operation != nil && info.Operation.ID == id && info.Operation.Status == status)) {
					return client
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatalf("selection never reached %s at %s", status, directory)
		return nil
	}
	client := await("", "", original)
	for _, step := range []struct {
		request           Request
		status, directory string
	}{
		{requests[0], "succeeded", requests[0].Directory},
		{Request{Rollback: true}, "succeeded", original},
		{requests[1], "rolled_back", original},
	} {
		op, err := client.Activate(context.Background(), step.request)
		if err != nil {
			t.Fatal(err)
		}
		client = await(op.ID, step.status, step.directory)
		var persisted selection
		b, err := os.ReadFile(filepath.Join(state, "selection.json"))
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(b, &persisted); err != nil {
			t.Fatal(err)
		}
		if persisted.Pending != nil || persisted.Current.Directory != step.directory || persisted.Operation.Status != step.status {
			t.Fatal("durable selection does not match serving instance")
		}
	}
}
