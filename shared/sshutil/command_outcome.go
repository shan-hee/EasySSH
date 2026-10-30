package sshutil

import (
	"errors"
	"fmt"

	"golang.org/x/crypto/ssh"
)

var ErrCommandOutcomeUnknown = errors.New("remote command outcome unknown")

// Once an exec request has been attempted, transport errors cannot prove that
// the remote command did not run. Only a remote exit confirms its outcome.
func CommandOutcome(err error) (string, *int, string) {
	code := 0
	if err == nil {
		return "succeeded", &code, ""
	}
	var exit *ssh.ExitError
	if errors.As(err, &exit) {
		code = exit.ExitStatus()
		return "failed", &code, fmt.Sprintf("command exited with code %d", code)
	}
	return "unknown", nil, "命令结果未知，远端可能已执行；请先核对结果，不能直接重试：" + err.Error()
}
