//go:build !windows

package instanceactivation

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func secureDirectory(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	return os.Chmod(path, 0700)
}

func replaceFile(source, destination string) error {
	if err := os.Rename(source, destination); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(destination))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func startChild(cmd *exec.Cmd, _ bool) (*childProcess, error) {
	// Keep the child and its helpers in a group so forced shutdown cannot
	// leave a sync engine or transfer helper running against the old instance.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	configureParentDeath(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	kill := func() { _ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	child := &childProcess{done: make(chan error, 1), terminate: kill, close: kill}
	go func() { child.done <- cmd.Wait() }()
	return child, nil
}
