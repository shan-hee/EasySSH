package app

import (
	"context"
	"github.com/easyssh/shared/protocol"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	remoteFileActiveLimit    = 4
	remoteFileRecordLimit    = 128
	remoteFileSelectionLimit = 8
)

type DesktopRemoteFileSelection struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	ExpiresAt time.Time `json:"expires_at"`
}

type desktopRemoteFileSelection struct {
	info         DesktopRemoteFileSelection
	connectionID string
	file         *os.File
	snapshot     os.FileInfo
}

type DesktopRemoteTransfer struct {
	ID           string     `json:"id"`
	ConnectionID string     `json:"connection_id"`
	ServerID     string     `json:"server_id"`
	Kind         string     `json:"kind"`
	Name         string     `json:"name"`
	RemotePath   string     `json:"remote_path"`
	SourceTaskID string     `json:"source_task_id,omitempty"`
	Status       string     `json:"status"`
	Transferred  int64      `json:"transferred"`
	Total        int64      `json:"total"` // -1 until the download response fixes its size
	Error        string     `json:"error,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
}

type desktopRemoteTransfer struct {
	mu          sync.Mutex
	store       *desktopRemoteTransferStore
	persistedAt time.Time
	info        DesktopRemoteTransfer
	connection  protocol.ConnectionInfo
	ctx         context.Context
	cancel      context.CancelFunc
}

func (task *desktopRemoteTransfer) snapshot() DesktopRemoteTransfer {
	task.mu.Lock()
	defer task.mu.Unlock()
	return task.info
}

func (task *desktopRemoteTransfer) progress(n int64) error {
	task.mu.Lock()
	defer task.mu.Unlock()
	if task.info.FinishedAt == nil {
		task.info.Transferred += n
		task.info.UpdatedAt = time.Now().UTC()
		if time.Since(task.persistedAt) >= time.Second {
			return task.persistLocked()
		}
	}
	return nil
}

func (task *desktopRemoteTransfer) finish(status, code string) {
	task.mu.Lock()
	defer task.mu.Unlock()
	if task.info.FinishedAt != nil {
		return
	}
	now := time.Now().UTC()
	task.info.Status, task.info.Error, task.info.UpdatedAt, task.info.FinishedAt = status, code, now, &now
	_ = task.persistLocked()
}

func (task *desktopRemoteTransfer) stop() error {
	task.cancel()
	task.mu.Lock()
	defer task.mu.Unlock()
	if task.info.FinishedAt == nil {
		task.info.Status = "canceling"
		task.info.UpdatedAt = time.Now().UTC()
		return task.persistLocked()
	}
	return nil
}

// newFileTransferLocked requires resourcesMu; selection consumption is atomic with reservation.
func (session *desktopRemoteSession) newFileTransferLocked(connection protocol.ConnectionInfo, kind, name, remotePath string, total int64) (*desktopRemoteTransfer, error) {
	if session.stopping || session.ctx.Err() != nil {
		return nil, remoteError("workspace_closed")
	}
	if _, ok := session.connections[connection.ID]; !ok {
		return nil, remoteError("connection_unavailable")
	}
	active := 0
	for _, task := range session.transfers {
		if task.snapshot().FinishedAt == nil {
			active++
		}
	}
	if active >= remoteFileActiveLimit || len(session.transfers) >= remoteFileRecordLimit {
		return nil, remoteError("local_transfer_capacity")
	}
	ctx, cancel := context.WithCancel(session.ctx)
	now := time.Now().UTC()
	task := &desktopRemoteTransfer{ctx: ctx, cancel: cancel, connection: connection, store: session.transferStore, persistedAt: now, info: DesktopRemoteTransfer{ID: uuid.NewString(), ConnectionID: connection.ID, ServerID: connection.ServerID, Kind: kind, Name: name, RemotePath: remotePath, Total: total, Status: "running", CreatedAt: now, UpdatedAt: now}}
	if err := session.transferStore.insert(ctx, task.info); err != nil {
		cancel()
		return nil, err
	}
	if session.transfers == nil {
		session.transfers = make(map[string]*desktopRemoteTransfer)
	}
	session.transfers[task.info.ID] = task
	// Reserved before publishing the task, under the same stop lock as opens.
	session.opening.Add(1)
	return task, nil
}

func (session *desktopRemoteSession) fileTransfer(id string) (*desktopRemoteTransfer, error) {
	session.resourcesMu.Lock()
	defer session.resourcesMu.Unlock()
	task := session.transfers[id]
	if task == nil {
		if session.stopping || session.ctx.Err() != nil {
			return nil, remoteError("workspace_closed")
		}
		if len(session.transfers) >= remoteFileRecordLimit {
			return nil, remoteError("local_transfer_capacity")
		}
		if err := session.transferStore.recoverStoppedTransfer(session.ctx, id); err != nil {
			return nil, err
		}
		info, err := session.transferStore.get(session.ctx, id)
		if err != nil {
			return nil, err
		}
		// Only stopped receipts can be rehydrated. No local path, stream,
		// connection or upload capability is recovered from persisted data.
		if info.FinishedAt == nil {
			return nil, remoteError("transfer_in_progress")
		}
		ctx, cancel := context.WithCancel(session.ctx)
		cancel()
		task = &desktopRemoteTransfer{ctx: ctx, cancel: cancel, store: session.transferStore, info: info, connection: protocol.ConnectionInfo{ID: info.ConnectionID, ServerID: info.ServerID}}
		session.transfers[id] = task
	}
	return task, nil
}

func (session *desktopRemoteSession) maintainFiles() {
	session.resourcesMu.Lock()
	defer session.resourcesMu.Unlock()
	now := time.Now()
	for id, selection := range session.selections {
		if !selection.info.ExpiresAt.After(now) || session.ctx.Err() != nil {
			_ = selection.file.Close()
			delete(session.selections, id)
		}
	}
	for id, task := range session.transfers {
		info := task.snapshot()
		if info.FinishedAt != nil && now.Sub(*info.FinishedAt) > 10*time.Minute {
			delete(session.transfers, id)
		}
	}
}

func (s *DesktopRemoteWorkspaceService) ListFileTransfers(ctx context.Context, input DesktopRemoteTransferListInput) (DesktopRemoteTransferList, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteTransferList{}, err
	}
	defer done()
	if err := session.beginOpening(); err != nil {
		return DesktopRemoteTransferList{}, err
	}
	defer session.opening.Done()
	result, err := session.transferStore.list(ctx, input)
	if err != nil {
		return result, err
	}
	session.resourcesMu.Lock()
	defer session.resourcesMu.Unlock()
	for i, item := range result.Items {
		if task := session.transfers[item.ID]; task != nil {
			result.Items[i] = task.snapshot()
		} else if item.Status == "running" || item.Status == "canceling" {
			if err := session.transferStore.recoverStoppedTransfer(ctx, item.ID); err != nil {
				return DesktopRemoteTransferList{}, err
			}
			restored, err := session.transferStore.get(ctx, item.ID)
			if err != nil {
				return DesktopRemoteTransferList{}, err
			}
			result.Items[i] = restored
		}
	}
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) CancelFileTransfer(ctx context.Context, id string) error {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	if err := session.beginOpening(); err != nil {
		return err
	}
	defer session.opening.Done()
	task, err := session.fileTransfer(id)
	if err != nil {
		return err
	}
	if err := task.stop(); err != nil {
		return err
	}
	info := task.snapshot()
	if info.Status == "unknown" && info.SourceTaskID != "" {
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := session.cancelSourceTransfer(ctx, info.SourceTaskID); err != nil {
			return err
		}
		if info.Kind == "upload" {
			return session.refreshUploadResult(ctx, task)
		}
		// A source download only describes artifact preparation. It cannot
		// prove whether a previous native file commit completed before restart.
		// Keep that local receipt unknown; source details are read separately.
	}
	return nil
}

func (s *DesktopRemoteWorkspaceService) DismissFileTransfer(ctx context.Context, id string) error {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	if err := session.beginOpening(); err != nil {
		return err
	}
	defer session.opening.Done()
	session.resourcesMu.Lock()
	defer session.resourcesMu.Unlock()
	if task := session.transfers[id]; task != nil && task.snapshot().FinishedAt == nil {
		return remoteError("transfer_in_progress")
	}
	if err := session.transferStore.recoverStoppedTransfer(ctx, id); err != nil {
		return err
	}
	if err := session.transferStore.dismiss(ctx, id); err != nil {
		return err
	}
	delete(session.transfers, id)
	return nil
}

func (s *DesktopRemoteWorkspaceService) RefreshFileTransfer(ctx context.Context, id string) (DesktopRemoteTransfer, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteTransfer{}, err
	}
	defer done()
	if err := session.beginOpening(); err != nil {
		return DesktopRemoteTransfer{}, err
	}
	defer session.opening.Done()
	task, err := session.fileTransfer(id)
	if err != nil {
		return DesktopRemoteTransfer{}, err
	}
	info := task.snapshot()
	if info.Kind == "upload" && info.Status == "unknown" && info.SourceTaskID != "" {
		if err := session.refreshUploadResult(ctx, task); err != nil {
			return info, err
		}
	}
	return task.snapshot(), nil
}
