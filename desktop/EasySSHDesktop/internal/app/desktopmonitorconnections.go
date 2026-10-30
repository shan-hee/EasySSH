package app

import (
	"context"
	"errors"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

type desktopMonitorConnection struct {
	busy       sync.Mutex
	client     *ssh.Client
	close      func()
	revision   int64
	idle       *time.Timer
	generation uint64
}

// One bounded collection borrows one channel from a persistent per-server
// transport. Concurrent samples for the same server are rejected, not queued.
func (s *DesktopMonitorService) acquireConnection(ctx context.Context, server DesktopServer) (*ssh.Client, func(), error) {
	for {
		s.operationMu.Lock()
		if s.stopping {
			s.operationMu.Unlock()
			return nil, nil, errors.New("monitor service is stopping")
		}
		if s.connections == nil {
			s.connections = make(map[string]*desktopMonitorConnection)
		}
		entry := s.connections[server.ID]
		fresh := entry == nil
		if fresh {
			if len(s.connections) >= 64 {
				s.operationMu.Unlock()
				return nil, nil, errors.New("monitor connection capacity reached")
			}
			entry = &desktopMonitorConnection{revision: server.connectionRevision}
			s.connections[server.ID] = entry
		}
		if !entry.busy.TryLock() {
			s.operationMu.Unlock()
			return nil, nil, errors.New("a monitor sample for this server is already running")
		}
		entry.generation++
		if entry.idle != nil {
			entry.idle.Stop()
		}
		if entry.revision != server.connectionRevision {
			delete(s.connections, server.ID)
			s.operationMu.Unlock()
			entry.close()
			entry.busy.Unlock()
			continue
		}
		s.operationMu.Unlock()
		if fresh {
			client, closeClient, err := s.openConnection(ctx, server)
			if err != nil {
				s.discardConnection(server.ID, entry)
				entry.busy.Unlock()
				return nil, nil, err
			}
			s.operationMu.Lock()
			if s.stopping || s.connections[server.ID] != entry || ctx.Err() != nil {
				s.operationMu.Unlock()
				closeClient()
				s.discardConnection(server.ID, entry)
				entry.busy.Unlock()
				return nil, nil, errors.New("monitor operation stopped")
			}
			entry.client, entry.close = client, closeClient
			s.operationWG.Add(1)
			go func() {
				defer s.operationWG.Done()
				_ = client.Wait()
				s.discardConnection(server.ID, entry)
			}()
			s.operationMu.Unlock()
		}
		var once sync.Once
		release := func() {
			once.Do(func() {
				s.operationMu.Lock()
				if !s.stopping && s.connections[server.ID] == entry {
					entry.generation++
					generation := entry.generation
					entry.idle = time.AfterFunc(5*time.Minute, func() {
						s.operationMu.Lock()
						if s.connections[server.ID] != entry || entry.generation != generation || !entry.busy.TryLock() {
							s.operationMu.Unlock()
							return
						}
						delete(s.connections, server.ID)
						s.operationMu.Unlock()
						entry.close()
						entry.busy.Unlock()
					})
				}
				entry.busy.Unlock()
				s.operationMu.Unlock()
			})
		}
		return entry.client, release, nil
	}
}

func (s *DesktopMonitorService) discardConnection(id string, entry *desktopMonitorConnection) {
	s.operationMu.Lock()
	defer s.operationMu.Unlock()
	if s.connections[id] == entry {
		delete(s.connections, id)
		if entry.idle != nil {
			entry.idle.Stop()
		}
	}
}

func (s *DesktopMonitorService) openConnection(ctx context.Context, server DesktopServer) (*ssh.Client, func(), error) {
	credential, _ := s.serverService.getTemporaryCredential(server.ID, server.connectionRevision, server.credentialDigest())
	auth, err := buildDesktopServerSSHAuthMethodsWithCredential(server, credential)
	if err != nil {
		return nil, nil, err
	}
	if len(auth) == 0 {
		return nil, nil, errors.New("server credential is required")
	}
	config := &ssh.ClientConfig{User: server.Username, Auth: auth, HostKeyCallback: desktopHostKeyCallback(), Timeout: 12 * time.Second}
	if err = configureDesktopHostKeyAlgorithms(config, server.Host, server.Port); err != nil {
		return nil, nil, err
	}
	client, closeClient, err := dialDesktopObservedSSH(ctx, &s.desktopOperationRegistry, s.activity, server, config, 12*time.Second, "monitor_connect", "automation")
	if err != nil {
		return nil, nil, err
	}
	current, err := s.serverService.getByIDRaw(server.ID)
	if err != nil || current.connectionRevision != server.connectionRevision || current.credentialDigest() != server.credentialDigest() {
		closeClient()
		return nil, nil, errors.New("server connection configuration changed; reconnect")
	}
	return client, closeClient, nil
}

func (s *DesktopMonitorService) ServiceShutdown() error {
	s.stopOperations()
	s.operationMu.Lock()
	entries := s.connections
	s.connections = make(map[string]*desktopMonitorConnection)
	closers := []func(){}
	for _, entry := range entries {
		if entry.idle != nil {
			entry.idle.Stop()
		}
		if entry.close != nil {
			closers = append(closers, entry.close)
		}
	}
	s.operationMu.Unlock()
	for _, closeClient := range closers {
		closeClient()
	}
	s.operationWG.Wait()
	return nil
}
