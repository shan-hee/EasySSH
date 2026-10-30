package app

import (
	"context"
	"net/http"
	"path"
	"time"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func (session *desktopRemoteSession) validDownloadJob(task *desktopRemoteTransfer, job *protocol.TransferJob) bool {
	info := task.snapshot()
	return job != nil && job.ID != uuid.Nil && (info.SourceTaskID == "" || job.ID.String() == info.SourceTaskID) &&
		session.validTaskActor(job.Actor) && job.Kind == "sftp_download" && job.Runner == "server" &&
		job.SourceServerID != nil && job.SourceServerID.String() == task.connection.ServerID && job.TargetServerID == nil &&
		job.SourcePath == path.Clean(info.RemotePath) && job.Status.Valid() && job.Stage.Valid() &&
		job.BytesTotal >= 0 && job.BytesProcessed >= 0 && job.ArtifactSize >= 0 && job.Progress >= 0 && job.Progress <= 100 &&
		!job.CreatedAt.IsZero() && !job.UpdatedAt.IsZero()
}

// Preparing the remote artifact and receiving it locally are separate stages.
// Preserve the source ID before waiting; never recreate or replay a source task
// when a status request fails or the local workspace closes.
func (session *desktopRemoteSession) prepareFileDownload(task *desktopRemoteTransfer) (ready *protocol.TransferJob, resultErr error) {
	info := task.snapshot()
	var job protocol.TransferJob
	sourceID := info.SourceTaskID
	defer func() {
		if resultErr != nil && validRemoteUUID(sourceID) && (job.Status == "" || job.Status == "queued" || job.Status == "running" || job.Status == "canceling") {
			ctx, cancel := context.WithTimeout(context.WithoutCancel(task.ctx), 5*time.Second)
			defer cancel()
			// This only requests cancellation of the already validated source.
			// A completed artifact remains a completed source even if saving the
			// local destination later fails.
			_ = session.cancelSourceTransfer(ctx, sourceID)
		}
	}()
	if info.SourceTaskID == "" {
		input := protocol.TransferDownloadInput{ServerID: task.connection.ServerID, SourcePath: info.RemotePath}
		if err := session.client.request(task.ctx, http.MethodPost, "/api/v1/transfer-jobs/sftp/download", input, &job, true); err != nil {
			return nil, err
		}
	} else {
		if !validRemoteUUID(info.SourceTaskID) {
			return nil, remoteError("invalid_source_task")
		}
		if err := session.client.request(task.ctx, http.MethodGet, "/api/v1/transfer-jobs/"+info.SourceTaskID, nil, &job, true); err != nil {
			return nil, err
		}
	}
	if !session.validDownloadJob(task, &job) {
		return nil, remoteError("invalid_remote_response")
	}
	sourceID = job.ID.String()
	task.mu.Lock()
	task.info.SourceTaskID = sourceID
	task.info.UpdatedAt = time.Now().UTC()
	err := task.persistLocked()
	task.mu.Unlock()
	if err != nil {
		return nil, err
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := task.ctx.Err(); err != nil {
			return nil, err
		}
		switch job.Status {
		case "completed":
			if job.Stage != "ready_for_download" || !job.ArtifactManaged || job.ArtifactCleanedAt != nil || job.ArtifactName == "" || job.FinishedAt == nil ||
				job.ArtifactExpiresAt == nil || !time.Now().Before(*job.ArtifactExpiresAt) {
				return nil, remoteError("artifact_not_ready")
			}
			return &job, nil
		case "failed":
			return nil, remoteError("download_preparation_failed")
		case "cancelled":
			return nil, remoteError("transfer_cancelled")
		case "unknown":
			return nil, remoteError("download_outcome_unknown")
		case "queued", "running", "canceling":
		default:
			return nil, remoteError("invalid_remote_response")
		}
		select {
		case <-task.ctx.Done():
			return nil, task.ctx.Err()
		case <-ticker.C:
		}
		var next protocol.TransferJob
		if err := session.client.request(task.ctx, http.MethodGet, "/api/v1/transfer-jobs/"+sourceID, nil, &next, true); err != nil {
			return nil, err
		}
		if !session.validDownloadJob(task, &next) {
			return nil, remoteError("invalid_remote_response")
		}
		job = next
	}
}

func (session *desktopRemoteSession) cancelSourceTransfer(ctx context.Context, id string) error {
	if !validRemoteUUID(id) {
		return remoteError("invalid_source_task")
	}
	var result protocol.TransferMutationResult
	if err := session.client.request(ctx, http.MethodPost, "/api/v1/transfer-jobs/"+id+"/cancel", nil, &result, true); err != nil {
		return err
	}
	if !result.Success {
		return remoteError("invalid_remote_response")
	}
	return nil
}
