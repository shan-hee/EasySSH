package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptrace"
	"sync/atomic"
	"time"

	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sftputil"
)

func (s *DesktopRemoteWorkspaceService) DeleteRemotePaths(ctx context.Context, connectionID string, paths []string) (protocol.SFTPDeletePathsResult, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.SFTPDeletePathsResult{}, err
	}
	defer done()
	return session.deleteRemotePaths(ctx, connectionID, paths)
}
func (session *desktopRemoteSession) deleteRemotePaths(ctx context.Context, connectionID string, paths []string) (protocol.SFTPDeletePathsResult, error) {
	var result protocol.SFTPDeletePathsResult
	if len(paths) == 0 || len(paths) > 100 {
		return result, remoteError("invalid_path")
	}
	input := protocol.SFTPDeletePathsRequest{Paths: make([]string, 0, len(paths))}
	seen := make(map[string]bool, len(paths))
	for _, p := range paths {
		clean, err := sftputil.ValidateDeletePath(p)
		if err != nil || clean != p {
			return result, remoteError("invalid_path")
		}
		if !seen[p] {
			input.Paths = append(input.Paths, p)
			seen[p] = true
		}
	}
	if err := session.beginOpening(); err != nil {
		return result, err
	}
	defer session.opening.Done()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var attempted atomic.Bool
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { attempted.Store(true) }})
	err := session.requestFile(ctx, connectionID, http.MethodPost, "delete-paths", nil, input, &result, false)
	if err != nil {
		if attempted.Load() && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || err.Error() == "remote_unavailable" || err.Error() == "invalid_remote_response" || err.Error() == "remote_request_failed" || err.Error() == "remote_redirect_rejected") {
			return protocol.SFTPDeletePathsResult{}, remoteError("remote_delete_submission_unknown")
		}
		return protocol.SFTPDeletePathsResult{}, err
	}
	if _, err := remoteTaskID(result.TaskID); err != nil || result.Mode != "recursive_task" || len(result.DeletedPaths) != 0 {
		// Submission may already have created a task. A malformed response is
		// never permission to submit the same destructive operation a second time.
		return protocol.SFTPDeletePathsResult{}, remoteError("remote_delete_submission_unknown")
	}
	return result, nil
}
