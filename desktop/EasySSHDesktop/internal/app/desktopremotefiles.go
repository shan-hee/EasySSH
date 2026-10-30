package app

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"math"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"os"
	"path"
	"strings"
	"sync/atomic"
	"unicode/utf8"

	"github.com/easyssh/shared/sftputil"
)

// The authentication stream is attached to the existing logical connection;
// finishing this short-lived stream does not close the file workspace.
func (s *DesktopRemoteWorkspaceService) OpenFileAuthentication(ctx context.Context, connectionID string) (DesktopRemoteStreamInfo, error) {
	return s.openStream(ctx, connectionID, "sftp_auth", 0, 0, 0)
}

func (s *DesktopRemoteWorkspaceService) AnswerFileChallenge(ctx context.Context, streamID, requestID string, answers []string, cancelled bool) error {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	stream, err := session.stream(streamID)
	if err != nil || stream.info.Kind != "sftp_auth" {
		return remoteError("stream_unavailable")
	}
	return stream.answerChallenge(ctx, requestID, answers, cancelled)
}

// Remote paths are POSIX paths. Query encoding keeps punctuation inside the
// path value; no renderer string participates in the API route or host.
func validRemoteFilePath(value string) bool {
	return len(value) > 0 && len(value) <= 4096 && utf8.ValidString(value) &&
		!strings.ContainsRune(value, 0) && strings.HasPrefix(value, "/") && path.Clean(value) == value
}

func validRemoteFileInfo(value *protocol.FileInfo) bool {
	if value == nil || !validRemoteFilePath(value.Path) || value.Size < 0 ||
		!utf8.ValidString(value.Name) || value.Name != path.Base(value.Path) ||
		len(value.LinkTarget) > 4096 || strings.ContainsRune(value.LinkTarget, 0) || !utf8.ValidString(value.LinkTarget) {
		return false
	}
	return value.IsDir == value.Mode.IsDir() && value.IsLink == (value.Mode&os.ModeSymlink != 0) &&
		value.Permission == sftputil.PermissionString(value.Mode)
}

func (s *DesktopRemoteWorkspaceService) fileRequest(ctx context.Context, connectionID, method, operation string, query url.Values, body, output any, text bool) error {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return err
	}
	defer done()
	if err = session.beginOpening(); err != nil {
		return err
	}
	defer session.opening.Done()
	return session.requestFile(ctx, connectionID, method, operation, query, body, output, text)
}

func (session *desktopRemoteSession) requestFile(ctx context.Context, connectionID, method, operation string, query url.Values, body, output any, text bool) error {
	if !protocol.ValidConnectionID(connectionID) {
		return remoteError("invalid_connection_id")
	}
	connection, err := session.connection(connectionID)
	if err != nil {
		return err
	}
	if connection.Mode != protocol.FilesConnection {
		return remoteError("invalid_connection_mode")
	}
	options := desktopRemoteRequestOptions{query: query, connectionID: connection.ID, rawResponse: text}
	if text {
		options.responseLimit = sftputil.MaxTextFileBytes
	}
	if operation == "delete-paths" {
		options.requestLimit = sftputil.MaxDeleteRequestBytes
	}
	if operation == "write" {
		options.requestLimit = sftputil.MaxTextFileBytes*6 + 8192
	}
	var attempted atomic.Bool
	mutation := method != http.MethodGet && method != http.MethodHead && operation != "delete-paths"
	if mutation {
		ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { attempted.Store(true) }})
	}
	err = session.client.requestWithOptions(ctx, method, "/api/v1/sftp/"+connection.ServerID+"/"+operation, body, output, true, options)
	if isRemoteAccessEnded(err) {
		session.cancel()
	}
	if err != nil && (err.Error() == "connection_unavailable" || err.Error() == "resource_paused") {
		session.dropConnection(connectionID)
	}
	if err != nil && mutation && attempted.Load() && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || err.Error() == "remote_unavailable" || err.Error() == "invalid_remote_response" || err.Error() == "remote_request_failed" || err.Error() == "remote_redirect_rejected") {
		return remoteError("file_outcome_unknown")
	}
	return err
}

func (s *DesktopRemoteWorkspaceService) ListRemoteDirectory(ctx context.Context, connectionID, remotePath string) (protocol.DirectoryListing, error) {
	var result protocol.DirectoryListing
	if remotePath == "" {
		remotePath = "~"
	}
	if remotePath != "~" && !validRemoteFilePath(remotePath) {
		return result, remoteError("invalid_path")
	}
	err := s.fileRequest(ctx, connectionID, http.MethodGet, "list", url.Values{"path": {remotePath}}, nil, &result, false)
	if err != nil {
		return protocol.DirectoryListing{}, err
	}
	if !validRemoteFilePath(result.Path) || (remotePath != "~" && result.Path != remotePath) || result.Parent != sftputil.ParentPath(result.Path) ||
		result.Total != len(result.Files) || len(result.Files) > 20000 || !result.CanRead {
		return protocol.DirectoryListing{}, remoteError("invalid_remote_response")
	}
	seen := make(map[string]bool, len(result.Files))
	for _, file := range result.Files {
		if !validRemoteFileInfo(file) || file.Path == result.Path || path.Dir(file.Path) != result.Path || seen[file.Path] {
			return protocol.DirectoryListing{}, remoteError("invalid_remote_response")
		}
		seen[file.Path] = true
	}
	if result.Files == nil {
		result.Files = make([]*protocol.FileInfo, 0)
	}
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) StatRemoteFile(ctx context.Context, connectionID, remotePath string) (protocol.FileInfo, error) {
	var result protocol.FileInfo
	if !validRemoteFilePath(remotePath) {
		return result, remoteError("invalid_path")
	}
	err := s.fileRequest(ctx, connectionID, http.MethodGet, "stat", url.Values{"path": {remotePath}}, nil, &result, false)
	return checkedRemoteFile(result, remotePath, err)
}

func checkedRemoteFile(result protocol.FileInfo, expected string, err error) (protocol.FileInfo, error) {
	if err != nil {
		return protocol.FileInfo{}, err
	}
	if !validRemoteFileInfo(&result) || result.Path != expected {
		return protocol.FileInfo{}, remoteError("invalid_remote_response")
	}
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) ReadRemoteFile(ctx context.Context, connectionID, remotePath string) ([]byte, error) {
	if !validRemoteFilePath(remotePath) {
		return nil, remoteError("invalid_path")
	}
	var result []byte
	err := s.fileRequest(ctx, connectionID, http.MethodGet, "read", url.Values{"path": {remotePath}}, nil, &result, true)
	return result, err
}

func (s *DesktopRemoteWorkspaceService) WriteRemoteFile(ctx context.Context, connectionID, remotePath, content string) (protocol.FileInfo, error) {
	var result protocol.FileInfo
	if !validRemoteFilePath(remotePath) {
		return result, remoteError("invalid_path")
	}
	if len(content) > sftputil.MaxTextFileBytes || !utf8.ValidString(content) {
		return result, remoteError("invalid_file_content")
	}
	err := s.fileRequest(ctx, connectionID, http.MethodPost, "write", nil, protocol.SFTPWriteRequest{Path: remotePath, Content: &content}, &result, false)
	return checkedRemoteFile(result, remotePath, err)
}

func (s *DesktopRemoteWorkspaceService) CreateRemoteDirectory(ctx context.Context, connectionID, remotePath string, recursive bool) (protocol.FileInfo, error) {
	var result protocol.FileInfo
	if !validRemoteFilePath(remotePath) {
		return result, remoteError("invalid_path")
	}
	err := s.fileRequest(ctx, connectionID, http.MethodPost, "mkdir", nil, protocol.SFTPCreateDirectoryRequest{Path: remotePath, Recursive: recursive}, &result, false)
	return checkedRemoteFile(result, remotePath, err)
}

func (s *DesktopRemoteWorkspaceService) RenameRemoteFile(ctx context.Context, connectionID, oldPath, newPath string) (protocol.FileInfo, error) {
	var result protocol.FileInfo
	if !validRemoteFilePath(oldPath) || !validRemoteFilePath(newPath) || oldPath == "/" || newPath == "/" {
		return result, remoteError("invalid_path")
	}
	err := s.fileRequest(ctx, connectionID, http.MethodPost, "rename", nil, protocol.SFTPRenameRequest{OldPath: oldPath, NewPath: newPath}, &result, false)
	return checkedRemoteFile(result, newPath, err)
}

func (s *DesktopRemoteWorkspaceService) DeleteRemoteFile(ctx context.Context, connectionID, remotePath string) (protocol.FileInfo, error) {
	var result protocol.FileInfo
	if !validRemoteFilePath(remotePath) || remotePath == "/" {
		return result, remoteError("invalid_path")
	}
	err := s.fileRequest(ctx, connectionID, http.MethodDelete, "delete", nil, protocol.SFTPPathRequest{Path: remotePath}, &result, false)
	return checkedRemoteFile(result, remotePath, err)
}

func (s *DesktopRemoteWorkspaceService) ChmodRemoteFile(ctx context.Context, connectionID, remotePath, mode string) (protocol.ChmodResponse, error) {
	var result protocol.ChmodResponse
	if !validRemoteFilePath(remotePath) {
		return result, remoteError("invalid_path")
	}
	if _, err := sftputil.ParsePermissionMode(mode); err != nil {
		return result, remoteError("invalid_mode")
	}
	err := s.fileRequest(ctx, connectionID, http.MethodPost, "chmod", nil, protocol.SFTPChmodRequest{Path: remotePath, Mode: mode}, &result, false)
	if err != nil {
		return protocol.ChmodResponse{}, err
	}
	if result.Path != remotePath || result.Mode != mode {
		return protocol.ChmodResponse{}, remoteError("invalid_remote_response")
	}
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) RemoteDiskUsage(ctx context.Context, connectionID, remotePath string) (protocol.DiskUsage, error) {
	var result protocol.DiskUsage
	if !validRemoteFilePath(remotePath) {
		return result, remoteError("invalid_path")
	}
	err := s.fileRequest(ctx, connectionID, http.MethodGet, "disk-usage", url.Values{"path": {remotePath}}, nil, &result, false)
	if err != nil {
		return protocol.DiskUsage{}, err
	}
	if result.Path != remotePath || result.Used > result.Total || result.Available > result.Total-result.Used ||
		math.IsNaN(result.UsedPercent) || math.IsInf(result.UsedPercent, 0) || result.UsedPercent < 0 || result.UsedPercent > 100 {
		return protocol.DiskUsage{}, remoteError("invalid_remote_response")
	}
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) BatchDeleteRemoteFiles(ctx context.Context, connectionID string, paths []string) (protocol.BatchDeleteResponse, error) {
	var result protocol.BatchDeleteResponse
	if len(paths) < 1 || len(paths) > 100 {
		return result, remoteError("invalid_paths")
	}
	expected := make(map[string]bool, len(paths))
	for _, value := range paths {
		if !validRemoteFilePath(value) || value == "/" || expected[value] {
			return result, remoteError("invalid_paths")
		}
		expected[value] = true
	}
	err := s.fileRequest(ctx, connectionID, http.MethodPost, "batch-delete", nil, protocol.SFTPBatchDeleteRequest{Paths: paths}, &result, false)
	if err != nil {
		return protocol.BatchDeleteResponse{}, err
	}
	if result.Total != len(paths) || len(result.Success)+len(result.Failed) != len(paths) {
		return protocol.BatchDeleteResponse{}, remoteError("invalid_remote_response")
	}
	for _, value := range result.Success {
		if !expected[value] {
			return protocol.BatchDeleteResponse{}, remoteError("invalid_remote_response")
		}
		delete(expected, value)
	}
	for _, value := range result.Failed {
		if !expected[value.Path] || !remoteText(value.Error, 128) || len(value.Message) > 4096 {
			return protocol.BatchDeleteResponse{}, remoteError("invalid_remote_response")
		}
		delete(expected, value.Path)
	}
	return result, nil
}
