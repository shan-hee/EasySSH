package app

import (
	"context"
	"errors"
	"github.com/easyssh/shared/sshutil"
	"time"

	"github.com/easyssh/shared/sftputil"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

func (s *DesktopSFTPService) ServiceShutdown() error {
	s.stopOperations()
	// Interrupt channel creation as well as active reads/writes. Cached clients
	// cannot be republished after stopping has become visible.
	s.authenticatedMu.Lock()
	s.authenticatedVersion++
	clients := s.authenticatedSSH
	s.authenticatedSSH = make(map[string]*desktopSFTPAuthenticatedSSHClient)
	for _, entry := range clients {
		if entry.idleTimer != nil {
			entry.idleTimer.Stop()
		}
	}
	s.authenticatedMu.Unlock()
	for _, entry := range clients {
		entry.close()
	}
	s.operationWG.Wait()
	s.taskMu.Lock()
	var pending []string
	for id, task := range s.tasks {
		if task.EndedAt == "" {
			pending = append(pending, id)
		}
	}
	s.taskMu.Unlock()
	for _, id := range pending {
		s.finishCanceledTask(id, 0, 0)
	}
	return nil
}

func (s *DesktopSFTPService) bindTaskContext(parent context.Context, id string) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(parent)
	s.taskMu.Lock()
	task := s.tasks[id]
	if task == nil || task.cancelled || task.EndedAt != "" {
		cancel()
	} else {
		task.cancel = cancel
	}
	s.taskMu.Unlock()
	return ctx, cancel
}

func desktopSFTPOperationError(ctx context.Context, err error) error {
	// A confirmed remote response wins over a cancellation received afterwards.
	if err == nil || errors.Is(err, errDesktopSFTPCommitUnknown) || errors.Is(err, errDesktopSFTPDeleteUnknown) || sftputil.DefiniteStatus(err) {
		return err
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return errors.Join(context.DeadlineExceeded, err)
	}
	if ctx.Err() != nil {
		return errors.Join(errDesktopSFTPTaskCancelled, ctx.Err(), err)
	}
	return err
}

// SSH channel-open has no context API. Only during this short handshake may a
// timeout close the transport; after that cancellation closes this session.
func desktopSFTPOpenSession(ctx context.Context, client *ssh.Client) (*ssh.Session, error) {
	opening, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	stop := sftputil.CloseOnCancel(opening, client.Close)
	session, err := client.NewSession()
	stop()
	if opening.Err() != nil {
		if session != nil {
			_ = session.Close()
		}
		return nil, opening.Err()
	}
	return session, err
}

type desktopSFTPChannelWriter struct {
	*ssh.Session
	client *ssh.Client
	writer interface{ Write([]byte) (int, error) }
}

func (w desktopSFTPChannelWriter) Write(p []byte) (int, error) { return w.writer.Write(p) }
func (w desktopSFTPChannelWriter) Close() error                { return sshutil.CloseSession(w.Session, w.client) }

func desktopSFTPNewClient(ctx context.Context, sshClient *ssh.Client) (*sftp.Client, error) {
	session, err := desktopSFTPOpenSession(ctx, sshClient)
	if err != nil {
		return nil, err
	}
	opening, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	closeSession := func() error { return sshutil.CloseSession(session, sshClient) }
	stop := sftputil.CloseOnCancel(opening, closeSession)
	defer stop()
	writer, err := session.StdinPipe()
	if err != nil {
		_ = closeSession()
		return nil, err
	}
	reader, err := session.StdoutPipe()
	if err != nil {
		_ = closeSession()
		return nil, err
	}
	if err = session.RequestSubsystem("sftp"); err != nil {
		_ = closeSession()
		return nil, err
	}
	client, err := sftp.NewClientPipe(reader, desktopSFTPChannelWriter{session, sshClient, writer})
	if err != nil {
		_ = closeSession()
		return nil, err
	}
	return client, nil
}
