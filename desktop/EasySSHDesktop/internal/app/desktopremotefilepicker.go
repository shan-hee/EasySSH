package app

import (
	"context"
	"github.com/easyssh/shared/protocol"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type remoteFileDialogResult struct {
	path string
	err  error
}

// Native UI is the authority to select local files. Cancellation discards a
// late dialog result before a file is opened; one pending remote dialog bounds
// native calls even on platforms whose modal panel cannot be programmatically
// dismissed. No renderer can submit an absolute local path.
func (s *DesktopRemoteWorkspaceService) promptRemoteFile(ctx context.Context, prompt func() (string, error)) (string, error) {
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if !s.fileDialog.TryLock() {
		return "", remoteError("file_dialog_busy")
	}
	result := make(chan remoteFileDialogResult, 1)
	go func() {
		defer s.fileDialog.Unlock()
		if ctx.Err() != nil {
			result <- remoteFileDialogResult{err: ctx.Err()}
			return
		}
		selected, err := prompt()
		result <- remoteFileDialogResult{selected, err}
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case value := <-result:
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		if value.err != nil {
			return "", remoteError("file_dialog_failed")
		}
		if value.path == "" {
			return "", remoteError("file_selection_cancelled")
		}
		return value.path, nil
	}
}

func (session *desktopRemoteSession) fileAction(ctx context.Context, connectionID string, action protocol.Action) (protocol.ConnectionInfo, error) {
	connection, err := session.connection(connectionID)
	if err != nil {
		return connection, err
	}
	info, err := session.client.currentContext(ctx)
	if err != nil {
		if isRemoteAccessEnded(err) {
			session.cancel()
		}
		return connection, err
	}
	for _, resource := range info.Resources {
		if resource.ID.String() != connection.ServerID {
			continue
		}
		if resource.Paused {
			return connection, remoteError("resource_paused")
		}
		for _, allowed := range resource.Actions {
			if allowed == action {
				return connection, nil
			}
		}
	}
	return connection, remoteError("forbidden")
}

func (s *DesktopRemoteWorkspaceService) ChooseUploadFile(ctx context.Context, connectionID string) (DesktopRemoteFileSelection, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteFileSelection{}, err
	}
	defer done()
	if _, err = session.fileAction(ctx, connectionID, protocol.FilesUpload); err != nil {
		return DesktopRemoteFileSelection{}, err
	}
	session.maintainFiles()
	session.resourcesMu.Lock()
	full := len(session.selections) >= remoteFileSelectionLimit
	session.resourcesMu.Unlock()
	if full {
		return DesktopRemoteFileSelection{}, remoteError("file_selection_capacity")
	}
	selected, err := s.promptRemoteFile(ctx, func() (string, error) {
		return s.app.Dialog.OpenFile().AttachToWindow(session.window).CanChooseFiles(true).CanChooseDirectories(false).
			SetTitle("上传文件 · " + session.client.origin).PromptForSingleSelection()
	})
	if err != nil {
		return DesktopRemoteFileSelection{}, err
	}
	file, err := os.Open(selected)
	if err != nil {
		return DesktopRemoteFileSelection{}, remoteError("local_file_unavailable")
	}
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() || stat.Size() < 0 {
		file.Close()
		return DesktopRemoteFileSelection{}, remoteError("local_file_not_regular")
	}
	info := DesktopRemoteFileSelection{uuid.NewString(), filepath.Base(selected), stat.Size(), time.Now().Add(5 * time.Minute)}
	session.resourcesMu.Lock()
	defer session.resourcesMu.Unlock()
	if session.stopping || ctx.Err() != nil {
		file.Close()
		return DesktopRemoteFileSelection{}, remoteError("workspace_closed")
	}
	if _, ok := session.connections[connectionID]; !ok {
		file.Close()
		return DesktopRemoteFileSelection{}, remoteError("connection_unavailable")
	}
	if len(session.selections) >= remoteFileSelectionLimit {
		file.Close()
		return DesktopRemoteFileSelection{}, remoteError("file_selection_capacity")
	}
	if session.selections == nil {
		session.selections = make(map[string]*desktopRemoteFileSelection)
	}
	session.selections[info.ID] = &desktopRemoteFileSelection{info, connectionID, file, stat}
	return info, nil
}

func (s *DesktopRemoteWorkspaceService) DiscardUploadFile(ctx context.Context, id string) error {
	session, _, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	session.resourcesMu.Lock()
	defer session.resourcesMu.Unlock()
	if selection := session.selections[id]; selection != nil {
		_ = selection.file.Close()
		delete(session.selections, id)
	}
	return nil
}

func (s *DesktopRemoteWorkspaceService) StartFileUpload(ctx context.Context, connectionID, selectionID, remotePath string) (DesktopRemoteTransfer, error) {
	if !validRemoteFilePath(remotePath) || remotePath == "/" {
		return DesktopRemoteTransfer{}, remoteError("invalid_path")
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteTransfer{}, err
	}
	defer done()
	connection, err := session.fileAction(ctx, connectionID, protocol.FilesUpload)
	if err != nil {
		return DesktopRemoteTransfer{}, err
	}
	session.resourcesMu.Lock()
	if ctx.Err() != nil {
		session.resourcesMu.Unlock()
		return DesktopRemoteTransfer{}, ctx.Err()
	}
	selection := session.selections[selectionID]
	if selection == nil || selection.connectionID != connectionID {
		session.resourcesMu.Unlock()
		return DesktopRemoteTransfer{}, remoteError("file_selection_unavailable")
	}
	if !selection.info.ExpiresAt.After(time.Now()) || !sameDesktopUploadFile(selection.file, selection.snapshot) {
		delete(session.selections, selectionID)
		session.resourcesMu.Unlock()
		selection.file.Close()
		return DesktopRemoteTransfer{}, remoteError("local_file_changed")
	}
	task, err := session.newFileTransferLocked(connection, "upload", selection.info.Name, remotePath, selection.info.Size)
	if err == nil {
		delete(session.selections, selectionID)
	}
	session.resourcesMu.Unlock()
	if err != nil {
		return DesktopRemoteTransfer{}, err
	}
	go func() {
		defer session.opening.Done()
		defer task.cancel()
		defer selection.file.Close()
		stopRead := context.AfterFunc(task.ctx, func() { _ = selection.file.Close() })
		defer stopRead()
		session.runFileUpload(task, selection)
	}()
	return task.snapshot(), nil
}

// Suggested names are display defaults only, never local directory selectors.
func remoteDownloadName(remotePath string) string {
	name := path.Base(remotePath)
	var out strings.Builder
	for _, ch := range name {
		if out.Len() > 160 {
			break
		}
		if unicode.IsControl(ch) || strings.ContainsRune(`/\:*?"<>|`, ch) {
			ch = '_'
		}
		out.WriteRune(ch)
	}
	name = strings.Trim(out.String(), " .")
	upper := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	if name == "" || upper == "CON" || upper == "PRN" || upper == "AUX" || upper == "NUL" || (len(upper) == 4 && (strings.HasPrefix(upper, "COM") || strings.HasPrefix(upper, "LPT")) && upper[3] >= '1' && upper[3] <= '9') {
		return "download"
	}
	return name
}

func (s *DesktopRemoteWorkspaceService) StartFileDownload(ctx context.Context, connectionID, remotePath string) (DesktopRemoteTransfer, error) {
	if !validRemoteFilePath(remotePath) || remotePath == "/" {
		return DesktopRemoteTransfer{}, remoteError("invalid_path")
	}
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteTransfer{}, err
	}
	defer done()
	connection, err := session.fileAction(ctx, connectionID, protocol.FilesDownload)
	if err != nil {
		return DesktopRemoteTransfer{}, err
	}
	name := remoteDownloadName(remotePath)
	selected, err := s.promptRemoteFile(ctx, func() (string, error) {
		return s.app.Dialog.SaveFileWithOptions(&application.SaveFileDialogOptions{Window: session.window, Title: "保存下载 · " + session.client.origin, Filename: name, CanCreateDirectories: true}).PromptForSingleSelection()
	})
	if err != nil {
		return DesktopRemoteTransfer{}, err
	}
	save, err := prepareDesktopFileSave(selected)
	if err != nil {
		return DesktopRemoteTransfer{}, err
	}
	session.resourcesMu.Lock()
	if ctx.Err() != nil {
		session.resourcesMu.Unlock()
		save.root.Close()
		return DesktopRemoteTransfer{}, ctx.Err()
	}
	task, err := session.newFileTransferLocked(connection, "download", name, remotePath, -1)
	session.resourcesMu.Unlock()
	if err != nil {
		save.root.Close()
		return DesktopRemoteTransfer{}, err
	}
	go func() {
		defer session.opening.Done()
		defer task.cancel()
		defer save.root.Close()
		session.runFileDownload(task, save)
	}()
	return task.snapshot(), nil
}
