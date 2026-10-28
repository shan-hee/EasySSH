package main

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/pkg/sftp"
)

type desktopSFTPBrowserClient struct {
	client *sftp.Client
	closed atomic.Bool
}

func (s *DesktopSFTPService) watchAuthenticatedSSHClient(serverID string, entry *desktopSFTPAuthenticatedSSHClient) {
	_ = entry.client.Wait()
	s.authenticatedMu.Lock()
	defer s.authenticatedMu.Unlock()
	if s.authenticatedSSH[serverID] == entry {
		delete(s.authenticatedSSH, serverID)
		if entry.idleTimer != nil {
			entry.idleTimer.Stop()
		}
	}
}

// Only directory browsing retains idle SFTP channels. Transfers still borrow
// independent channels so cancellation and large transfers cannot occupy these.
func (s *DesktopSFTPService) openDirectoryClientContext(ctx context.Context, serverID string) (*sftp.Client, func(), error) {
	serverID = strings.TrimSpace(serverID)
	sshClient, releaseSSH, err := s.openSSHClientContext(ctx, serverID)
	if err != nil {
		return nil, nil, err
	}
	var borrowed *desktopSFTPBrowserClient
	s.authenticatedMu.Lock()
	entry := s.authenticatedSSH[serverID]
	if entry != nil && entry.client == sshClient {
		for len(entry.idleSFTP) > 0 {
			last := len(entry.idleSFTP) - 1
			candidate := entry.idleSFTP[last]
			entry.idleSFTP[last] = nil
			entry.idleSFTP = entry.idleSFTP[:last]
			if !candidate.closed.Load() {
				borrowed = candidate
				break
			}
		}
	}
	s.authenticatedMu.Unlock()
	if borrowed == nil {
		client, err := sftp.NewClient(sshClient)
		if err != nil {
			releaseSSH()
			return nil, nil, err
		}
		borrowed = &desktopSFTPBrowserClient{client: client}
		go func() {
			_ = client.Wait()
			borrowed.closed.Store(true)
		}()
	}
	var once sync.Once
	return borrowed.client, func() {
		once.Do(func() {
			s.authenticatedMu.Lock()
			keep := ctx.Err() == nil && !borrowed.closed.Load() && entry != nil &&
				entry.client == sshClient && s.authenticatedSSH[serverID] == entry && len(entry.idleSFTP) < 2
			if keep {
				entry.idleSFTP = append(entry.idleSFTP, borrowed)
			}
			s.authenticatedMu.Unlock()
			if !keep {
				_ = borrowed.client.Close()
			}
			releaseSSH()
		})
	}, nil
}
