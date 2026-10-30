package app

import (
	"context"
	"golang.org/x/crypto/ssh"
	"time"
)

func (s *DesktopSFTPService) dialFileSSH(ctx context.Context, server DesktopServer, config *ssh.ClientConfig, timeout time.Duration) (*ssh.Client, func(), error) {
	return dialDesktopObservedSSH(ctx, &s.desktopOperationRegistry, s.activity, server, config, timeout, "sftp_connect", "manual")
}
