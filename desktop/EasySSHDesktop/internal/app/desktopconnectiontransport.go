package app

import (
	"context"
	"errors"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/easyssh/shared/sftputil"
	"github.com/easyssh/shared/sshutil"
	"golang.org/x/crypto/ssh"
)

// The transport owns one observation until SSH actually closes. Borrowing a
// channel, refreshing a directory or reusing authentication creates no event.
// The service operation registration includes dialing, heartbeat and final
// persistence, so shutdown cannot return while an observation is still running.
func dialDesktopObservedSSH(parent context.Context, operations *desktopOperationRegistry, activity *ActivityLogService, server DesktopServer, config *ssh.ClientConfig, timeout time.Duration, action, source string) (*ssh.Client, func(), error) {
	if activity == nil {
		return nil, nil, errors.New("connection activity service is unavailable")
	}
	parent = desktopNonNilContext(parent)
	if err := parent.Err(); err != nil {
		return nil, nil, err
	}
	lifetime, release, err := operations.beginOperation(context.Background())
	if err != nil {
		return nil, nil, err
	}
	opening, cancelOpening := context.WithTimeout(lifetime, timeout)
	stopParent := context.AfterFunc(parent, cancelOpening)
	observation, err := activity.beginConnectionFor(opening, server, action, source)
	if err != nil {
		stopParent()
		cancelOpening()
		release()
		return nil, nil, err
	}
	client, err := sshutil.DialContext(opening, net.JoinHostPort(server.Host, strconv.Itoa(server.Port)), config)
	if err != nil {
		status, code := DesktopActivityLogStatus("failure"), "connection_failed"
		if errors.Is(opening.Err(), context.DeadlineExceeded) || errors.Is(parent.Err(), context.DeadlineExceeded) {
			status, code = "timeout", "connection_timeout"
		} else if opening.Err() != nil || parent.Err() != nil {
			status, code = "canceled", "connection_canceled"
		}
		stopParent()
		cancelOpening()
		observation.finish(status, code, time.Now().UTC())
		release()
		return nil, nil, err
	}
	// Transfer ownership away from the short authentication/request context.
	// A canceled caller cannot publish a late connection in the cache.
	stopParent()
	openingErr := opening.Err()
	cancelOpening()
	if err = observation.established(); err != nil {
		_ = client.Close()
		observation.finish("unknown", "connection_persistence_failed", time.Now().UTC())
		release()
		return nil, nil, err
	}
	if openingErr != nil || parent.Err() != nil || lifetime.Err() != nil {
		_ = client.Close()
		observation.finish("canceled", "connection_canceled", time.Now().UTC())
		release()
		return nil, nil, context.Canceled
	}
	var requested, storageFailed atomic.Bool
	closeTransport := func() error {
		requested.Store(true)
		return client.Close()
	}
	stopClose := sftputil.CloseOnCancel(lifetime, closeTransport)
	heartbeatCtx, cancelHeartbeat := context.WithCancel(context.Background())
	heartbeatDone, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		if err := observation.heartbeat(heartbeatCtx); err != nil {
			storageFailed.Store(true)
			desktopLogPrintf("connection heartbeat storage failed: %v", err)
			_ = client.Close()
		}
	}()
	go func() {
		defer close(done)
		defer release()
		_ = client.Wait()
		ended := time.Now().UTC()
		cancelHeartbeat()
		<-heartbeatDone
		status, code := DesktopActivityLogStatus("unknown"), "remote_transport_lost"
		if storageFailed.Load() {
			status, code = "unknown", "connection_storage_failed"
		} else if requested.Load() {
			status, code = "success", "connection_closed"
		}
		stopClose()
		observation.finish(status, code, ended)
	}()
	var once sync.Once
	closeClient := func() {
		once.Do(func() { _ = closeTransport() })
		<-done
	}
	return client, closeClient, nil
}

// Closing the stdin pipe alone sends EOF but can leave the response reader
// blocked. Retain and close the entire SSH session for deterministic cancellation.
