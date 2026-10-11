//go:build !windows && !linux

package instanceactivation

import "os/exec"

// The control heartbeat exits the child if its launcher disappears.
func configureParentDeath(cmd *exec.Cmd) {}
