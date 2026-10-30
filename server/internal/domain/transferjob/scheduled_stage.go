package transferjob

import (
	"context"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

// Scheduled preparation can wait in another queue before SFTP starts. Recheck
// its original definition at this boundary, using the persisted task identity.
func (r *repository) CheckScheduledStage(ctx context.Context, job *TransferJob) error {
	if job.ScheduledTaskID == nil {
		return nil
	}
	if job.TaskRunID == nil || job.Actor.Kind != protocol.Owner || access.Current(ctx).Actor() != job.Actor {
		return access.ErrForbidden
	}
	var run taskcenter.TaskRun
	if err := r.db.WithContext(ctx).First(&run, "id=?", *job.TaskRunID).Error; err != nil {
		return err
	}
	if run.Actor != job.Actor || run.DefinitionID == nil || *run.DefinitionID != *job.ScheduledTaskID || run.SourceType != "transfer_job" || run.SourceID != job.ID.String() {
		return access.ErrForbidden
	}
	ownerID, err := uuid.Parse(job.Actor.ID)
	if err != nil {
		return access.ErrForbidden
	}
	serverID := ""
	if job.Kind == JobKindSFTPUpload && job.TargetServerID != nil {
		serverID = job.TargetServerID.String()
	}
	if job.Kind == JobKindSFTPDownload && job.SourceServerID != nil {
		serverID = job.SourceServerID.String()
	}
	if serverID == "" {
		return access.ErrForbidden
	}
	return scheduledtask.NewRepository(r.db).CheckStage(ctx, *job.ScheduledTaskID, run.DefinitionVersion, ownerID, run.TriggerType == taskcenter.TriggerScheduled, serverID)
}
