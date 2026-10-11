package updater

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

type checkedLauncher struct{ launchFunc func(string) error }

func (l checkedLauncher) launch(path string) error { return l.launchFunc(path) }

func TestUpdateWaitsForLauncherAndClearsPrivateChildEnvironment(t *testing.T) {
	root := t.TempDir()
	target, staged := filepath.Join(root, "app.exe"), filepath.Join(root, "new.exe")
	for path, contents := range map[string]string{target: "old", staged: "new"} {
		if err := os.WriteFile(path, []byte(contents), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("EASYSSH_LAUNCHER_PID", "2002")
	t.Setenv("EASYSSH_LAUNCHER_ADDRESS", "http://127.0.0.1:1")
	t.Setenv("EASYSSH_LAUNCHER_TOKEN", "fixture-token")
	t.Setenv("EASYSSH_INSTANCE_STATE_DIR", filepath.Join(root, "state"))
	t.Setenv("EASYSSH_DESKTOP_DATA_DIR", filepath.Join(root, "data"))
	for _, key := range []string{envHelperMode, envHelperTarget, envHelperNew, envHelperPID, envHelperLog} {
		t.Setenv(key, "fixture")
	}
	var waited []int
	launched := false
	wait := func(pid int, _ time.Duration) error {
		waited = append(waited, pid)
		b, err := os.ReadFile(target)
		if err != nil || string(b) != "old" {
			t.Fatal("replaced executable before both processes exited")
		}
		return nil
	}
	code := runHelperSwap(target, staged, 1001, filepath.Join(root, "helper.log"), wait, checkedLauncher{func(path string) error {
		launched = true
		if path != target {
			t.Fatal("wrong relaunch target")
		}
		for _, key := range []string{envHelperMode, "EASYSSH_LAUNCHER_PID", "EASYSSH_LAUNCHER_ADDRESS", "EASYSSH_LAUNCHER_TOKEN"} {
			if os.Getenv(key) != "" {
				t.Fatalf("retained private child environment: %s", key)
			}
		}
		if os.Getenv("EASYSSH_INSTANCE_STATE_DIR") != filepath.Join(root, "state") {
			t.Fatal("lost persistent instance selection")
		}
		return nil
	}})
	if code != 0 || !launched || !reflect.DeepEqual(waited, []int{1001, 2002}) {
		t.Fatalf("code=%d launched=%v waits=%v", code, launched, waited)
	}
	if b, err := os.ReadFile(target); err != nil || string(b) != "new" {
		t.Fatal("new executable was not installed")
	}
}

func TestUpdateDoesNotReplaceBinaryWhileLauncherIsRunning(t *testing.T) {
	root := t.TempDir()
	target, staged := filepath.Join(root, "app.exe"), filepath.Join(root, "new.exe")
	for path, contents := range map[string]string{target: "old", staged: "new"} {
		if err := os.WriteFile(path, []byte(contents), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("EASYSSH_LAUNCHER_PID", "2002")
	t.Setenv("EASYSSH_DESKTOP_DATA_DIR", filepath.Join(root, "data"))
	code := runHelperSwap(target, staged, 1001, filepath.Join(root, "helper.log"), func(pid int, _ time.Duration) error {
		if pid == 2002 {
			return errors.New("still running")
		}
		return nil
	}, checkedLauncher{func(string) error { t.Fatal("relaunched before launcher exited"); return nil }})
	if code != 17 {
		t.Fatalf("unexpected exit code: %d", code)
	}
	if b, err := os.ReadFile(target); err != nil || string(b) != "old" {
		t.Fatal("changed original executable on wait failure")
	}
}
