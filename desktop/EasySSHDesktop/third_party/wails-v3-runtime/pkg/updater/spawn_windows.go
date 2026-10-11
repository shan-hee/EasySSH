//go:build windows

package updater

import (
	"os"
	"os/exec"
	"syscall"
)

// applyDetachAttrs marks the child as a detached process so it survives the
// parent's exit and does not flash a console window.
func applyDetachAttrs(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	const (
		detachedProcess    = 0x00000008
		createNoWindow     = 0x08000000
		createNewProcGroup = 0x00000200
	)
	cmd.SysProcAttr.CreationFlags |= detachedProcess | createNoWindow | createNewProcGroup
	// A managed EasySSH child lives in a kill-on-close Job. Only the
	// detached updater helper must outlive that Job to replace both processes.
	if os.Getenv("EASYSSH_LAUNCHER_PID") != "" {
		cmd.SysProcAttr.CreationFlags |= 0x01000000
	} // CREATE_BREAKAWAY_FROM_JOB
	cmd.SysProcAttr.HideWindow = true
}
