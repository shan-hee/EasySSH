package sshutil

import (
	"golang.org/x/crypto/ssh"
	"time"
)

// CloseSession bounds channel-close writes by closing a stalled transport.
func CloseSession(session *ssh.Session, client *ssh.Client) error {
	done := make(chan error, 1)
	go func() { done <- session.Close() }()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		// A channel close cannot interrupt a transport stuck writing its close
		// packet. Terminate that broken transport, then join the close worker.
		if client != nil {
			_ = client.Close()
		}
		return <-done
	}
}
