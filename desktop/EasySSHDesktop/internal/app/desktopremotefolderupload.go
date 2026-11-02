package app

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sftputil"
	"github.com/google/uuid"
)

// Bounds the local walk only; the remote instance applies its own limits.
var remoteFolderLimits = sftputil.FolderLimits{MaxEntries: 100000, MaxDepth: 256}

type desktopRemoteFolder struct {
	header []byte
	files  []desktopRemoteFolderFile // manifest order
}

type desktopRemoteFolderFile struct {
	path     string
	snapshot os.FileInfo
}

func (s *DesktopRemoteWorkspaceService) ChooseUploadFolder(ctx context.Context, connectionID string) (DesktopRemoteFileSelection, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return DesktopRemoteFileSelection{}, err
	}
	defer done()
	if err = session.prepareSelection(ctx, connectionID, protocol.FilesUpload, protocol.FilesWrite); err != nil {
		return DesktopRemoteFileSelection{}, err
	}
	selected, err := s.promptRemoteFile(ctx, func() (string, error) {
		return s.app.Dialog.OpenFile().AttachToWindow(session.window).CanChooseFiles(false).CanChooseDirectories(true).
			SetTitle("上传文件夹 · " + session.client.origin).PromptForSingleSelection()
	})
	if err != nil {
		return DesktopRemoteFileSelection{}, err
	}
	folder, size, skipped, err := readDesktopRemoteFolder(selected)
	if err != nil {
		return DesktopRemoteFileSelection{}, err
	}
	info := DesktopRemoteFileSelection{ID: uuid.NewString(), Name: filepath.Base(selected), Size: size, ExpiresAt: time.Now().Add(5 * time.Minute), Skipped: skipped}
	if err = session.storeSelection(ctx, &desktopRemoteFileSelection{info: info, connectionID: connectionID, folder: folder}); err != nil {
		return DesktopRemoteFileSelection{}, err
	}
	return info, nil
}

// StartFolderUpload refuses an existing remotePath unless merge is set, so the
// caller can ask before any file is sent.
func (s *DesktopRemoteWorkspaceService) StartFolderUpload(ctx context.Context, connectionID, selectionID, remotePath string, merge bool) (DesktopRemoteTransfer, error) {
	return s.startUpload(ctx, connectionID, selectionID, remotePath, true, merge)
}

func (session *desktopRemoteSession) requireFreeRemotePath(ctx context.Context, connectionID, remotePath string) error {
	if err := session.beginOpening(); err != nil {
		return err
	}
	defer session.opening.Done()
	var existing protocol.FileInfo
	err := session.requestFile(ctx, connectionID, http.MethodGet, "stat", url.Values{"path": {remotePath}}, nil, &existing, false)
	switch {
	case err == nil:
		return remoteError("target_exists")
	case err.Error() == "file_not_found":
		return nil
	default:
		return err
	}
}

// The walk never follows links: links and special files are skipped and
// counted, so only regular files below the chosen folder are sent.
func readDesktopRemoteFolder(root string) (*desktopRemoteFolder, int64, int, error) {
	folder := &desktopRemoteFolder{}
	var manifest sftputil.FolderManifest
	skipped := 0
	err := filepath.WalkDir(root, func(local string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if local == root {
			if !entry.IsDir() {
				return errors.New("selection is not a folder")
			}
			return nil
		}
		relative, err := filepath.Rel(root, local)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(relative)
		switch {
		case entry.IsDir():
			manifest.Directories = append(manifest.Directories, name)
		case entry.Type().IsRegular():
			info, err := entry.Info()
			if err != nil {
				return err
			}
			manifest.Files = append(manifest.Files, sftputil.FolderManifestFile{Path: name, Size: info.Size()})
			folder.files = append(folder.files, desktopRemoteFolderFile{path: local, snapshot: info})
		default:
			skipped++
		}
		if len(manifest.Directories)+len(manifest.Files) > remoteFolderLimits.MaxEntries {
			return errors.New("folder entry limit exceeded")
		}
		return nil
	})
	if err != nil {
		return nil, 0, 0, remoteError("local_folder_unavailable")
	}
	content, err := manifest.Validate(remoteFolderLimits)
	if err != nil {
		return nil, 0, 0, remoteError("local_folder_unsupported")
	}
	if folder.header, err = sftputil.EncodeFolderBundleHeader(manifest); err != nil {
		return nil, 0, 0, remoteError("local_folder_unsupported")
	}
	return folder, int64(len(folder.header)) + content, skipped, nil
}

func (folder *desktopRemoteFolder) write(w io.Writer) error {
	if _, err := w.Write(folder.header); err != nil {
		return err
	}
	for _, file := range folder.files {
		if err := file.write(w); err != nil {
			return err
		}
	}
	return nil
}

func (file desktopRemoteFolderFile) write(w io.Writer) error {
	handle, err := os.Open(file.path)
	if err != nil {
		return remoteError("local_file_unavailable")
	}
	defer handle.Close()
	if !sameDesktopUploadFile(handle, file.snapshot) {
		return remoteError("local_file_changed")
	}
	if _, err := io.CopyN(w, io.NewSectionReader(handle, 0, file.snapshot.Size()), file.snapshot.Size()); err != nil {
		return err
	}
	if !sameDesktopUploadFile(handle, file.snapshot) {
		return remoteError("local_file_changed")
	}
	return nil
}
