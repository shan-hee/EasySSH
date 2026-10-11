package updater

import (
	"os/exec"
	"testing"
)

func TestOnlyManagedUpdaterRequestsJobBreakaway(t *testing.T) {
	for _, managed := range []bool{false, true} {
		value := ""
		if managed {
			value = "2002"
		}
		t.Setenv("EASYSSH_LAUNCHER_PID", value)
		cmd := exec.Command("not-started.exe")
		applyDetachAttrs(cmd)
		if (cmd.SysProcAttr.CreationFlags&0x01000000 != 0) != managed {
			t.Fatal("incorrect Job breakaway flags")
		}
	}
}
