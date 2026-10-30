package app

import (
	"context"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

// These jobs execute at the source instance. Reading or canceling one does not
// create a local transfer, receipt, activity or worker. The native window fixes
// the session; the renderer cannot choose another origin or session token.
func (session *desktopRemoteSession) validTransferJob(job protocol.TransferJob) bool {
	if job.ID == uuid.Nil || !session.validTaskActor(job.Actor) || job.Runner != "server" ||
		!job.Kind.Valid() || !job.Status.Valid() || !job.Stage.Valid() ||
		job.BytesTotal < 0 || job.BytesProcessed < 0 || job.BytesCompleted < 0 || job.BytesCompleted > job.BytesTotal ||
		job.FilesTotal < 0 || job.FilesCompleted < 0 || job.FilesCompleted > job.FilesTotal ||
		job.ArtifactSize < 0 || job.SpeedBps < 0 || job.Progress < 0 || job.Progress > 100 ||
		job.CreatedAt.IsZero() || job.UpdatedAt.IsZero() || job.RetryCount < 0 || job.MaxRetries < 0 {
		return false
	}
	for _, id := range []*uuid.UUID{job.SourceServerID, job.TargetServerID, job.TaskRunID, job.ScheduledTaskID} {
		if id != nil && *id == uuid.Nil {
			return false
		}
	}
	for _, value := range []string{job.Name, job.Description, job.FileName, job.ArtifactName, job.SourcePath, job.TargetPath, job.ResultPath} {
		if !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
			return false
		}
	}
	switch job.Kind {
	case "sftp_upload":
		return job.SourceServerID == nil && job.TargetServerID != nil && validRemoteFilePath(job.TargetPath)
	case "sftp_download":
		// Batch downloads describe selections in detail_json instead of source_path.
		return job.SourceServerID != nil && job.TargetServerID == nil && (job.SourcePath == "" || validRemoteFilePath(job.SourcePath))
	case "sftp_transfer":
		return job.SourceServerID != nil && job.TargetServerID != nil && *job.SourceServerID != *job.TargetServerID &&
			validRemoteFilePath(job.SourcePath) && job.SourcePath != "/" && validRemoteFilePath(job.TargetPath) &&
			(job.ResultPath == "" || validRemoteFilePath(job.ResultPath) && job.ResultPath != job.TargetPath && path.Dir(job.ResultPath) == job.TargetPath)
	}
	return false
}

func (session *desktopRemoteSession) startRemoteRelay(ctx context.Context, input protocol.RemoteTransferRelayInput) (protocol.TransferJob, error) {
	var result protocol.TransferJob
	if !protocol.ValidConnectionID(input.SourceConnectionID) || !protocol.ValidConnectionID(input.TargetConnectionID) ||
		!validRemoteFilePath(input.SourcePath) || input.SourcePath == "/" || !validRemoteFilePath(input.TargetPath) ||
		strings.ContainsAny(input.SourcePath+input.TargetPath, "\\") || len(path.Base(input.SourcePath)) > 255 {
		return result, remoteError("invalid_transfer_request")
	}
	source, err := session.connection(input.SourceConnectionID)
	if err != nil {
		return result, err
	}
	target, err := session.connection(input.TargetConnectionID)
	if err != nil {
		return result, err
	}
	if source.Mode != protocol.FilesConnection || target.Mode != protocol.FilesConnection || source.ServerID == target.ServerID {
		return result, remoteError("invalid_transfer_endpoints")
	}
	request := protocol.TransferRelayInput{SourceServerID: source.ServerID, TargetServerID: target.ServerID, SourcePath: input.SourcePath, TargetPath: input.TargetPath}
	if err := session.requestRecord(ctx, http.MethodPost, "/api/v1/transfer-jobs/sftp/relay", nil, request, &result, "transfer_outcome_unknown"); err != nil {
		return protocol.TransferJob{}, err
	}
	if !session.validTransferJob(result) || result.Kind != "sftp_transfer" || result.SourceServerID.String() != source.ServerID ||
		result.TargetServerID.String() != target.ServerID || result.SourcePath != input.SourcePath || result.TargetPath != input.TargetPath {
		// A response that cannot be trusted does not prove admission failed.
		// Reconcile through the source list; do not automatically resubmit.
		return protocol.TransferJob{}, remoteError("transfer_outcome_unknown")
	}
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) StartRemoteRelay(ctx context.Context, input protocol.RemoteTransferRelayInput) (protocol.TransferJob, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.TransferJob{}, err
	}
	defer done()
	return session.startRemoteRelay(ctx, input)
}

func (session *desktopRemoteSession) getRemoteTransfer(ctx context.Context, id string) (protocol.TransferJob, error) {
	if !validRemoteUUID(id) {
		return protocol.TransferJob{}, remoteError("invalid_source_task")
	}
	var result protocol.TransferJob
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/transfer-jobs/"+id, nil, nil, &result, ""); err != nil {
		return protocol.TransferJob{}, err
	}
	if result.ID.String() != id || !session.validTransferJob(result) {
		return protocol.TransferJob{}, remoteError("invalid_remote_response")
	}
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) GetRemoteTransfer(ctx context.Context, id string) (protocol.TransferJob, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.TransferJob{}, err
	}
	defer done()
	return session.getRemoteTransfer(ctx, id)
}

func (session *desktopRemoteSession) listRemoteTransfers(ctx context.Context, input protocol.TransferListInput) (protocol.TransferJobList, error) {
	if input.Page == 0 {
		input.Page = 1
	}
	if input.PageSize == 0 {
		input.PageSize = 20
	}
	if input.Page < 1 || input.Page > 1000000 || input.PageSize < 1 || input.PageSize > 100 || input.Kind != "" && !protocol.TransferJobKind(input.Kind).Valid() {
		return protocol.TransferJobList{}, remoteError("invalid_transfer_query")
	}
	query := url.Values{"page": {strconv.Itoa(input.Page)}, "page_size": {strconv.Itoa(input.PageSize)}}
	if input.Kind != "" {
		query.Set("kind", input.Kind)
	}
	var result protocol.TransferJobList
	if err := session.requestRecord(ctx, http.MethodGet, "/api/v1/transfer-jobs", query, nil, &result, ""); err != nil {
		return protocol.TransferJobList{}, err
	}
	if result.Page != input.Page || result.PageSize != input.PageSize || result.Total < 0 || len(result.Jobs) > input.PageSize ||
		int64(len(result.Jobs)) > result.Total || int64(result.TotalPages) != remoteTaskPages(result.Total, result.PageSize) {
		return protocol.TransferJobList{}, remoteError("invalid_remote_response")
	}
	seen := make(map[uuid.UUID]bool, len(result.Jobs))
	for _, job := range result.Jobs {
		if !session.validTransferJob(job) || seen[job.ID] || input.Kind != "" && string(job.Kind) != input.Kind {
			return protocol.TransferJobList{}, remoteError("invalid_remote_response")
		}
		seen[job.ID] = true
	}
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) ListRemoteTransfers(ctx context.Context, input protocol.TransferListInput) (protocol.TransferJobList, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.TransferJobList{}, err
	}
	defer done()
	return session.listRemoteTransfers(ctx, input)
}

func (session *desktopRemoteSession) cancelRemoteTransfer(ctx context.Context, id string) (protocol.TransferMutationResult, error) {
	job, err := session.getRemoteTransfer(ctx, id)
	if err != nil {
		return protocol.TransferMutationResult{}, err
	}
	switch job.Status {
	case "created", "staging", "queued", "running", "canceling", "cancelled":
	default:
		return protocol.TransferMutationResult{}, remoteError("transfer_not_cancelable")
	}
	var result protocol.TransferMutationResult
	if err := session.requestRecord(ctx, http.MethodPost, "/api/v1/transfer-jobs/"+id+"/cancel", nil, nil, &result, "transfer_cancel_outcome_unknown"); err != nil {
		return protocol.TransferMutationResult{}, err
	}
	if !result.Success {
		return protocol.TransferMutationResult{}, remoteError("transfer_cancel_outcome_unknown")
	}
	return result, nil
}

func (s *DesktopRemoteWorkspaceService) CancelRemoteTransfer(ctx context.Context, id string) (protocol.TransferMutationResult, error) {
	session, ctx, done, err := s.session(ctx)
	if err != nil {
		return protocol.TransferMutationResult{}, err
	}
	defer done()
	return session.cancelRemoteTransfer(ctx, id)
}
