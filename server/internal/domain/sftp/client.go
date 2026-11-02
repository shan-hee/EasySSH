package sftp

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"golang.org/x/crypto/ssh"
	"io"
	"os"
	"strings"
	"sync/atomic"

	"github.com/easyssh/server/internal/domain/server"
	sshDomain "github.com/easyssh/server/internal/domain/ssh"
	"github.com/easyssh/shared/sftputil"
	"github.com/google/uuid"
	"github.com/pkg/sftp"
)

// Client SFTP 客户端封装
type Client struct {
	ctx        context.Context
	action     protocol.Action
	sftpClient *sftp.Client
	sshClient  *sshDomain.Client
	serverID   string
	closed     atomic.Bool
}

// sessionWriter closes the complete subsystem channel, including its read side.
type sessionWriter struct {
	io.WriteCloser
	session *ssh.Session
}

func (w sessionWriter) Close() error { return w.session.Close() }

// NewClient supports cancellation while opening the SSH channel and negotiating
// SFTP. Only the channel is closed after NewSession returns. SSH has no channel-
// open cancellation API, so a stalled channel-open requires closing its transport.
func NewClient(ctx context.Context, sshClient *sshDomain.Client, srv *server.Server) (*Client, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	raw := sshClient.GetRawConnection()
	if raw == nil {
		return nil, fmt.Errorf("SSH client not connected")
	}
	stopOpen := sftputil.CloseOnCancel(ctx, raw.Close)
	session, err := raw.NewSession()
	stopOpen()
	if err != nil {
		return nil, err
	}
	stop := sftputil.CloseOnCancel(ctx, session.Close)
	defer stop()
	success := false
	defer func() {
		if !success {
			_ = session.Close()
		}
	}()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := session.RequestSubsystem("sftp"); err != nil {
		return nil, err
	}
	writer, err := session.StdinPipe()
	if err != nil {
		return nil, err
	}
	reader, err := session.StdoutPipe()
	if err != nil {
		return nil, err
	}
	sftpClient, err := sftp.NewClientPipe(reader, sessionWriter{WriteCloser: writer, session: session})
	if err != nil {
		return nil, fmt.Errorf("failed to create SFTP client: %w", err)
	}
	if err := ctx.Err(); err != nil {
		_ = sftpClient.Close()
		return nil, err
	}
	client := &Client{ctx: ctx, action: access.Operation(ctx).Action, sftpClient: sftpClient, sshClient: sshClient, serverID: srv.ID.String()}
	go func() { _ = sftpClient.Wait(); client.closed.Store(true); _ = session.Close() }()
	success = true
	return client, nil
}

// Close 关闭 SFTP 连接
func (c *Client) Close() error {
	sftpErr := c.CloseSFTP()

	var sshErr error
	if c.sshClient != nil {
		sshErr = c.sshClient.Close()
		c.sshClient = nil
	}

	if sftpErr != nil {
		return sftpErr
	}
	return sshErr
}

// CloseSFTP 仅关闭 SFTP 通道，不关闭底层 SSH（用于 SSH 池化场景）
func (c *Client) CloseSFTP() error {
	c.closed.Store(true)
	if c.sftpClient != nil {
		return c.sftpClient.Close()
	}
	return nil
}

// RawClient returns the underlying package SFTP client for internal streaming workflows.
func (c *Client) RawClient() *sftp.Client {
	if c == nil {
		return nil
	}
	return c.sftpClient
}

// ListDirectory 列出目录
func (c *Client) ListDirectory(path string) (*DirectoryListing, error) {
	return c.ListDirectoryContext(c.ctx, path)
}

func (c *Client) ListDirectoryContext(ctx context.Context, path string) (*DirectoryListing, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	stop := sftputil.CloseOnCancel(ctx, c.CloseSFTP)
	defer stop()
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := c.sftpClient.RealPath(".")
		if err != nil {
			return nil, fmt.Errorf("failed to resolve home directory: %w", err)
		}
		path = home + strings.TrimPrefix(path, "~")
	}
	path = sftputil.NormalizePath(path)
	// 读取目录
	entries, err := c.sftpClient.ReadDir(path)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	files := make([]*FileInfo, 0, len(entries))

	for _, entry := range entries {
		fullPath := sftputil.JoinPath(path, entry.Name())
		isLink := entry.Mode()&os.ModeSymlink != 0
		// Link targets are fetched by GetFileInfo on demand, not serially for every row.

		fileInfo := &FileInfo{
			Name:       entry.Name(),
			Path:       fullPath,
			Size:       entry.Size(),
			Mode:       entry.Mode(),
			IsDir:      entry.IsDir(),
			IsLink:     isLink,
			ModTime:    entry.ModTime(),
			Permission: sftputil.PermissionString(entry.Mode()),
		}

		files = append(files, fileInfo)
	}

	return &DirectoryListing{
		Path:    path,
		Parent:  sftputil.ParentPath(path),
		Files:   files,
		Total:   len(files),
		CanRead: true,
	}, nil
}

// GetFileInfo 获取文件信息
func (c *Client) GetFileInfo(path string) (*FileInfo, error) {
	path = sftputil.NormalizePath(path)
	// 使用 Lstat 保留符号链接信息（Stat 会跟随链接）
	stat, err := c.sftpClient.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	isLink := stat.Mode()&os.ModeSymlink != 0
	var linkTarget string
	if isLink {
		if t, err := c.sftpClient.ReadLink(path); err == nil {
			linkTarget = t
		}
	}

	fileInfo := &FileInfo{
		Name:       stat.Name(),
		Path:       sftputil.NormalizePath(path),
		Size:       stat.Size(),
		Mode:       stat.Mode(),
		IsDir:      stat.IsDir(),
		IsLink:     isLink,
		LinkTarget: linkTarget,
		ModTime:    stat.ModTime(),
		Permission: sftputil.PermissionString(stat.Mode()),
	}

	return fileInfo, nil
}

// UploadFileWithProgressWithContext 上传文件并报告进度，支持上下文取消
func (c *Client) UploadFileWithProgressWithContext(ctx context.Context, localReader io.Reader, remotePath string, onProgress func(int64)) error {
	req := access.Requirement{Action: protocol.FilesUpload, ServerID: c.serverID}
	if err := access.Current(ctx).Check(ctx, req); err != nil {
		return err
	}
	remotePath = sftputil.NormalizePath(remotePath)
	temporary := remotePath + ".easyssh-" + uuid.NewString()
	file, err := c.sftpClient.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close(); _ = c.sftpClient.Remove(temporary) }()
	if err := c.sftpClient.Chmod(temporary, 0600); err != nil {
		return err
	}
	stop := sftputil.CloseOnCancel(ctx, c.CloseSFTP)
	defer stop()
	metered, finish := access.MeterWriter(ctx, req, file)
	defer finish()
	writer := &progressWriter{writer: metered, onProgress: onProgress}
	_, err = io.Copy(writer, &ctxReader{ctx: ctx, reader: localReader})
	writer.report()
	err = errors.Join(err, finish())
	if err != nil {
		return fmt.Errorf("failed to upload file: %w", err)
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := access.Current(ctx).Check(ctx, req); err != nil {
		return err
	}
	return c.commitReplacement(temporary, remotePath, 0600)
}

// ctxReader 在每次读取前检查上下文是否已取消
type ctxReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *ctxReader) Read(p []byte) (int, error) {
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	default:
	}
	return r.reader.Read(p)
}

// Progress counts bytes accepted by the destination, not source read-ahead.
type progressWriter struct {
	writer             io.Writer
	onProgress         func(int64)
	loaded, lastReport int64
}

func (w *progressWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	w.loaded += int64(n)
	if w.loaded-w.lastReport >= 65536 {
		w.report()
	}
	return n, err
}
func (w *progressWriter) report() {
	if w.onProgress != nil {
		w.onProgress(w.loaded)
	}
	w.lastReport = w.loaded
}

// DownloadFileToArtifactWithContext prepares a host-managed artifact. It keeps
// all permission and cancellation checks, but delivery to the recipient owns
// the download quota; the host's staging hop must not consume it a second time.
func (c *Client) DownloadFileToArtifactWithContext(ctx context.Context, remotePath string, localWriter io.Writer, onProgress func(int64)) error {
	req := access.Requirement{Action: protocol.FilesDownload, ServerID: c.serverID}
	if err := access.Current(ctx).Check(ctx, req); err != nil {
		return err
	}
	file, err := c.sftpClient.Open(sftputil.NormalizePath(remotePath))
	if err != nil {
		return err
	}
	defer file.Close()
	stop := sftputil.CloseOnCancel(ctx, c.CloseSFTP)
	defer stop()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() < 0 {
		return fmt.Errorf("not a regular file")
	}
	writer := &progressWriter{writer: localWriter, onProgress: onProgress}
	_, err = io.CopyN(writer, &ctxReader{ctx: ctx, reader: file}, info.Size())
	writer.report()
	return err
}

// CreateDirectory 创建目录
func (c *Client) CreateDirectory(path string) error {
	if err := c.ctx.Err(); err != nil {
		return err
	}
	path = sftputil.NormalizePath(path)
	err := c.sftpClient.Mkdir(path)
	if err != nil {
		return fmt.Errorf("failed to create directory: %w", sftputil.MutationError(err))
	}
	return nil
}

// CreateDirectories 创建多级目录
func (c *Client) CreateDirectories(path string) error {
	if err := c.ctx.Err(); err != nil {
		return err
	}
	path = sftputil.NormalizePath(path)
	err := c.sftpClient.MkdirAll(path)
	if err != nil {
		return fmt.Errorf("directory creation may be partial: %w", errors.Join(sftputil.ErrMutationOutcomeUnknown, err))
	}
	return nil
}

// DeleteFile 删除文件（直接删除）
func (c *Client) DeleteFile(path string) error {
	var err error
	path, err = sftputil.ValidateDeletePath(path)
	if err != nil {
		return err
	}
	if err := c.ctx.Err(); err != nil {
		return err
	}
	if c.sftpClient == nil {
		return fmt.Errorf("sftp client not initialized")
	}
	if err := c.sftpClient.Remove(path); err != nil {
		return fmt.Errorf("failed to delete file: %w", sftputil.MutationError(err))
	}
	return nil
}

// DeleteTree records each observed child result, including partial deletion.
func (c *Client) DeleteTree(path string, report *sftputil.DeleteReport, observe sftputil.DeleteObserver) error {
	if c.sftpClient == nil {
		return fmt.Errorf("sftp client not initialized")
	}
	return sftputil.DeleteTree(c.ctx, c.sftpClient, path, report, observe)
}

// RemoveFile 永久删除文件（用于清理半文件/后台清理等）
func (c *Client) RemoveFile(path string) error {
	path = sftputil.NormalizePath(path)
	if c.sftpClient == nil {
		return fmt.Errorf("sftp client not initialized")
	}
	if err := c.sftpClient.Remove(path); err != nil {
		return fmt.Errorf("failed to remove file: %w", sftputil.MutationError(err))
	}
	return nil
}

// RenameFile 重命名文件或目录
func (c *Client) RenameFile(oldPath, newPath string) error {
	if err := c.ctx.Err(); err != nil {
		return err
	}
	oldPath = sftputil.NormalizePath(oldPath)
	newPath = sftputil.NormalizePath(newPath)
	err := c.sftpClient.Rename(oldPath, newPath)
	if err != nil {
		return fmt.Errorf("failed to rename: %w", sftputil.MutationError(err))
	}
	return nil
}

// Chmod 修改文件或目录权限
func (c *Client) Chmod(path string, mode os.FileMode) error {
	if err := c.ctx.Err(); err != nil {
		return err
	}
	path = sftputil.NormalizePath(path)
	err := c.sftpClient.Chmod(path, mode)
	if err != nil {
		return fmt.Errorf("failed to chmod: %w", sftputil.MutationError(err))
	}
	return nil
}

// GetWorkingDirectory 获取当前工作目录
func (c *Client) GetWorkingDirectory() (string, error) {
	wd, err := c.sftpClient.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get working directory: %w", err)
	}
	return wd, nil
}

// ChangeDirectory 切换目录
func (c *Client) ChangeDirectory(path string) error {
	path = sftputil.NormalizePath(path)
	// SFTP 客户端没有 Chdir 方法，我们可以验证目录存在
	stat, err := c.sftpClient.Stat(path)
	if err != nil {
		return fmt.Errorf("failed to change directory: %w", err)
	}

	if !stat.IsDir() {
		return fmt.Errorf("not a directory: %s", path)
	}

	return nil
}

// ReadFile 读取文件内容
func (c *Client) ReadFile(path string) ([]byte, error) {
	file, err := c.openRead(path, protocol.FilesRead)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > sftputil.MaxTextFileBytes {
		return nil, fmt.Errorf("file exceeds text read limit")
	}
	return io.ReadAll(file)
}

func (c *Client) WriteFile(path string, data []byte, perm os.FileMode) error {
	if len(data) > sftputil.MaxTextFileBytes {
		return fmt.Errorf("file exceeds text write limit")
	}
	req := access.Requirement{Action: protocol.FilesWrite, ServerID: c.serverID}
	if err := access.Current(c.ctx).Check(c.ctx, req); err != nil {
		return err
	}
	path = sftputil.NormalizePath(path)
	temporary := path + ".easyssh-" + uuid.NewString()
	file, err := c.sftpClient.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close(); _ = c.sftpClient.Remove(temporary) }()
	if err := c.sftpClient.Chmod(temporary, 0600); err != nil {
		return err
	}
	metered, finish := access.MeterWriter(c.ctx, req, file)
	defer finish()
	_, copyErr := io.Copy(metered, bytes.NewReader(data))
	if err := errors.Join(copyErr, finish()); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := access.Current(c.ctx).Check(c.ctx, req); err != nil {
		return err
	}
	return c.commitReplacement(temporary, path, perm)
}

// commitReplacement keeps the existing target's permissions, including 0000.
// Replacing links or special files is deliberately rejected.
func (c *Client) commitReplacement(temporary, target string, newMode os.FileMode) error {
	info, err := c.sftpClient.Lstat(target)
	setMode := newMode != 0
	if err == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("target is not a regular file")
		}
		newMode, setMode = info.Mode().Perm(), true
	} else if !os.IsNotExist(err) {
		return err
	}
	if setMode {
		if err := c.sftpClient.Chmod(temporary, newMode.Perm()); err != nil {
			return err
		}
	}
	if _, supported := c.sftpClient.HasExtension("posix-rename@openssh.com"); supported {
		return sftputil.MutationError(c.sftpClient.PosixRename(temporary, target))
	}
	return sftputil.MutationError(c.sftpClient.Rename(temporary, target))
}

// Exists 检查文件或目录是否存在
func (c *Client) Exists(path string) (bool, error) {
	path = sftputil.NormalizePath(path)
	_, err := c.sftpClient.Stat(path)
	if err != nil {
		if strings.Contains(err.Error(), "not exist") || strings.Contains(err.Error(), "no such file") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// GetDiskUsage 获取磁盘使用情况
func (c *Client) GetDiskUsage(path string) (*DiskUsage, error) {
	path = sftputil.NormalizePath(path)
	// SFTP 协议没有直接获取磁盘使用情况的方法
	// 需要通过 SSH 执行命令获取
	// 这里返回一个简化的实现
	statvfs, err := c.sftpClient.StatVFS(path)
	if err != nil {
		return nil, fmt.Errorf("failed to get disk usage: %w", err)
	}

	usage, err := sftputil.FilesystemUsage(path, statvfs.Blocks, statvfs.Bfree, statvfs.Bavail, statvfs.Frsize)
	if err != nil {
		return nil, err
	}
	return &usage, nil
}

// File exposes only metered I/O; embedding the raw SFTP file would accidentally
// expose ReaderFrom/WriteTo and allow io.Copy to bypass quota accounting.
type File struct {
	snapshot os.FileInfo
	file     *sftp.File
	reader   io.Reader
	settle   func() error
}

func (f *File) Read(p []byte) (int, error) {
	if f.reader == nil {
		return 0, access.ErrForbidden
	}
	return f.reader.Read(p)
}
func (f *File) Close() error               { return errors.Join(f.file.Close(), f.settle()) }
func (f *File) Stat() (os.FileInfo, error) { return f.snapshot, nil }

func (c *Client) openRead(path string, action protocol.Action) (*File, error) {
	req := access.Requirement{Action: action, ServerID: c.serverID}
	if err := access.Current(c.ctx).Check(c.ctx, req); err != nil {
		return nil, err
	}
	file, err := c.sftpClient.Open(sftputil.NormalizePath(path))
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 0 {
		_ = file.Close()
		return nil, fmt.Errorf("not a regular file")
	}
	// Read a bounded snapshot. Exact quota exhaustion at EOF is successful, and
	// a growing log cannot evade a caller's earlier size/preview check.
	metered, finish := access.MeterReader(c.ctx, req, file)
	reader := io.LimitReader(metered, info.Size())
	return &File{file: file, reader: reader, snapshot: info, settle: finish}, nil
}

// A text write reads the baseline it replaces; that read is files.read, not a download.
func (c *Client) OpenFile(path string) (*File, error) {
	action := protocol.FilesDownload
	if c.action == protocol.FilesRead || c.action == protocol.FilesWrite {
		action = protocol.FilesRead
	}
	return c.openRead(path, action)
}
