package app

import (
	"context"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"sync"
	"time"
)

const desktopRemoteMaxConnections = 100

func (session *desktopRemoteSession) beginOpening() error {
	session.resourcesMu.Lock()
	defer session.resourcesMu.Unlock()
	if session.stopping || session.ctx.Err() != nil {
		return remoteError("workspace_closed")
	}
	session.opening.Add(1)
	return nil
}

func (session *desktopRemoteSession) connection(id string) (protocol.ConnectionInfo, error) {
	session.resourcesMu.Lock()
	defer session.resourcesMu.Unlock()
	value, ok := session.connections[id]
	if !ok || session.stopping {
		return value, remoteError("connection_unavailable")
	}
	return value, nil
}

func (session *desktopRemoteSession) dropConnection(id string) {
	session.resourcesMu.Lock()
	delete(session.connections, id)
	var streams []*desktopRemoteStream
	for _, stream := range session.streams {
		if stream.connection.ID == id {
			streams = append(streams, stream)
		}
	}
	var transfers []*desktopRemoteTransfer
	for _, task := range session.transfers {
		if task.connection.ID == id {
			transfers = append(transfers, task)
		}
	}
	for key, selection := range session.selections {
		if selection.connectionID == id {
			_ = selection.file.Close()
			delete(session.selections, key)
		}
	}
	session.resourcesMu.Unlock()
	for _, stream := range streams {
		stream.finish("connection_closed")
	}
	for _, task := range transfers {
		task.stop()
	}
}

func (session *desktopRemoteSession) run() {
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-session.ctx.Done():
			session.resourcesMu.Lock()
			session.stopping = true
			session.resourcesMu.Unlock()
			session.maintainFiles()
			session.opening.Wait() // no new opens may enter after stopping
			session.resourcesMu.Lock()
			ids := make([]string, 0, len(session.connections))
			for id := range session.connections {
				ids = append(ids, id)
			}
			streams := make([]*desktopRemoteStream, 0, len(session.streams))
			for _, stream := range session.streams {
				streams = append(streams, stream)
			}
			clear(session.connections)
			clear(session.streams)
			clear(session.transfers)
			session.resourcesMu.Unlock()
			for _, stream := range streams {
				stream.finish("workspace_closed")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			var wg sync.WaitGroup
			for _, id := range ids {
				wg.Add(1)
				go func() {
					defer wg.Done()
					_ = session.client.request(ctx, http.MethodDelete, "/api/v1/connections/"+id, nil, nil, true)
				}()
			}
			wg.Wait()
			cancel()
			session.client.close()
			return
		case <-ticker.C:
			session.maintainFiles()
			session.resourcesMu.Lock()
			ids := make([]string, 0, len(session.connections))
			for id := range session.connections {
				ids = append(ids, id)
			}
			activeStreams := make([]*desktopRemoteStream, 0, len(session.streams))
			for id, stream := range session.streams {
				if stream.expired() {
					delete(session.streams, id)
				} else {
					activeStreams = append(activeStreams, stream)
				}
			}
			session.resourcesMu.Unlock()
			ctx, cancel := context.WithTimeout(session.ctx, 20*time.Second)
			var wg sync.WaitGroup
			for _, id := range ids {
				wg.Add(1)
				go func() { defer wg.Done(); _, _ = session.heartbeat(ctx, id) }()
			}
			for _, stream := range activeStreams {
				wg.Add(1)
				go func() { defer wg.Done(); stream.keepAlive(ctx) }()
			}
			wg.Wait()
			cancel()
		}
	}
}

func (session *desktopRemoteSession) heartbeat(ctx context.Context, id string) (protocol.ConnectionInfo, error) {
	expected, err := session.connection(id)
	if err != nil {
		return protocol.ConnectionInfo{}, err
	}
	var result protocol.ConnectionInfo
	err = session.client.request(ctx, http.MethodPost, "/api/v1/connections/"+id+"/heartbeat", nil, &result, true)
	if err == nil && (result.ID != id || result.ServerID != expected.ServerID || result.Mode != expected.Mode || result.HeartbeatSeconds != expected.HeartbeatSeconds) {
		err = remoteError("invalid_remote_response")
	}
	if err != nil {
		if isRemoteAccessEnded(err) {
			session.cancel()
		}
		if remoteConnectionEnded(err) {
			session.dropConnection(id)
		}
		return protocol.ConnectionInfo{}, err
	}
	return result, nil
}

func remoteConnectionEnded(err error) bool {
	if err == nil {
		return false
	}
	switch err.Error() {
	case "forbidden", "connection_unavailable", "resource_paused", "invalid_access", "access_ended", "invalid_remote_response":
		return true
	}
	return false
}

func (s *DesktopRemoteWorkspaceService) CreateConnection(ctx context.Context, serverID string, mode protocol.ConnectionMode) (protocol.ConnectionInfo, error) {
	var result protocol.ConnectionInfo
	if !validRemoteUUID(serverID) {
		return result, remoteError("invalid_server_id")
	}
	switch mode {
	case protocol.TerminalConnection, protocol.FilesConnection, protocol.MonitorConnection, protocol.DockerConnection:
	default:
		return result, remoteError("invalid_connection_mode")
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return result, err
	}
	defer done()
	if err := session.beginOpening(); err != nil {
		return result, err
	}
	defer session.opening.Done()
	session.resourcesMu.Lock()
	if len(session.connections)+session.pendingConnections >= desktopRemoteMaxConnections {
		session.resourcesMu.Unlock()
		return result, remoteError("local_connection_capacity")
	}
	session.pendingConnections++
	session.resourcesMu.Unlock()
	defer func() { session.resourcesMu.Lock(); session.pendingConnections--; session.resourcesMu.Unlock() }()
	err = session.client.request(ctx, http.MethodPost, "/api/v1/connections", struct {
		ServerID string                  `json:"server_id"`
		Mode     protocol.ConnectionMode `json:"mode"`
	}{serverID, mode}, &result, true)
	if err != nil {
		return protocol.ConnectionInfo{}, err
	}
	valid := protocol.ValidConnectionID(result.ID) && result.ServerID == serverID && result.Mode == mode && result.HeartbeatSeconds == 30
	if !valid {
		return protocol.ConnectionInfo{}, remoteError("invalid_remote_response")
	}
	session.resourcesMu.Lock()
	// Record even if cancellation raced the response: the lifecycle worker
	// waits for this call, then closes every known source-side connection.
	session.connections[result.ID] = result
	stopping := session.stopping || session.ctx.Err() != nil || ctx.Err() != nil
	session.resourcesMu.Unlock()
	if stopping {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = session.client.request(cleanup, http.MethodDelete, "/api/v1/connections/"+result.ID, nil, nil, true)
		session.dropConnection(result.ID)
		return protocol.ConnectionInfo{}, remoteError("connection_cancelled")
	}
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) HeartbeatConnection(ctx context.Context, id string) (protocol.ConnectionInfo, error) {
	if !protocol.ValidConnectionID(id) {
		return protocol.ConnectionInfo{}, remoteError("invalid_connection_id")
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.ConnectionInfo{}, err
	}
	defer done()
	return session.heartbeat(ctx, id)
}

func (s *DesktopRemoteWorkspaceService) CloseConnection(ctx context.Context, id string) error {
	if !protocol.ValidConnectionID(id) {
		return remoteError("invalid_connection_id")
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	if _, err := session.connection(id); err != nil {
		return err
	}
	session.dropConnection(id)
	return session.client.request(ctx, http.MethodDelete, "/api/v1/connections/"+id, nil, nil, true)
}
