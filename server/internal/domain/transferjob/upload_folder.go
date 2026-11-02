package transferjob

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sftputil"
)

// A folder upload expands its staged bundle into a tree. Bundle offsets are the
// progress unit, so bytes_total and bytes_processed keep their upload meaning.
func (s *service) executeFolderUpload(ctx context.Context, job *TransferJob, merge bool) error {
	finish := func(err error) error { return s.finishExecution(ctx, job, err, JobStageTransferToRemote) }
	uploadReq := access.Requirement{Action: protocol.FilesUpload, ServerID: job.TargetServerID.String()}
	writeReq := access.Requirement{Action: protocol.FilesWrite, ServerID: job.TargetServerID.String()}
	lease, err := access.Current(ctx).OpenWork(ctx, access.Task, uploadReq, writeReq)
	if err != nil {
		return finish(err)
	}
	defer lease.Close(nil)
	ctx = lease.Context()
	cfg, err := s.config(ctx)
	if err != nil {
		return finish(err)
	}
	file, err := os.Open(job.ArtifactPath)
	if err != nil {
		return finish(err)
	}
	defer file.Close()
	manifest, headerSize, contentSize, err := sftputil.ReadFolderBundleHeader(file, sftputil.FolderLimits{MaxEntries: cfg.TransferMaxEntries, MaxDepth: cfg.TransferMaxDepth})
	if err != nil {
		return finish(err)
	}
	if headerSize+contentSize != job.ArtifactSize {
		return finish(fmt.Errorf("%w: folder bundle does not match its manifest", ErrInvalidJobRequest))
	}
	// Save the destination before any remote mutation, like relays.
	job.ResultPath, job.FilesTotal = job.TargetPath, len(manifest.Files)
	changed, err := s.repo.UpdateIfStatus(ctx, job.ID, []JobStatus{JobStatusRunning}, map[string]interface{}{
		"result_path": job.ResultPath, "files_total": job.FilesTotal,
	})
	if err != nil {
		return finish(err)
	}
	if !changed {
		return finish(context.Canceled)
	}
	client, err := s.pool.Get(ctx, *job.TargetServerID, protocol.FilesUpload)
	if err != nil {
		return finish(err)
	}
	defer client.Release()
	content, finishRead := access.MeterReader(ctx, uploadReq, file)
	defer finishRead()
	progress := s.newTreeProgress(ctx, job)
	job.BytesProcessed = headerSize
	err = sftputil.WriteFolder(ctx, client.RawClient(), manifest, content, sftputil.FolderWrite{
		Target: job.TargetPath,
		Merge:  merge,
		Check: func() error {
			for _, req := range []access.Requirement{uploadReq, writeReq} {
				if err := access.Current(ctx).Check(ctx, req); err != nil {
					return err
				}
			}
			return nil
		},
		Progress: func(written sftputil.FolderProgress) error {
			job.BytesProcessed = headerSize + written.Written
			job.FilesCompleted, job.BytesCompleted = written.Files, written.Bytes
			progress.publish(false)
			return nil
		},
	})
	return finish(errors.Join(err, finishRead()))
}

// treeProgress persists throttled progress for transfers that write many files.
type treeProgress struct {
	service *service
	ctx     context.Context
	job     *TransferJob
	start   time.Time
	last    time.Time
}

func (s *service) newTreeProgress(ctx context.Context, job *TransferJob) *treeProgress {
	return &treeProgress{service: s, ctx: ctx, job: job, start: time.Now()}
}

func (p *treeProgress) publish(force bool) {
	if !force && time.Since(p.last) < 500*time.Millisecond {
		return
	}
	p.last = time.Now()
	job := p.job
	job.Progress = transferProgress(job.BytesProcessed, job.BytesTotal)
	ctx, cancel := context.WithTimeout(context.WithoutCancel(p.ctx), 5*time.Second)
	defer cancel()
	_, err := p.service.repo.UpdateIfStatus(ctx, job.ID, []JobStatus{JobStatusRunning, JobStatusCanceling}, map[string]interface{}{
		"bytes_processed": job.BytesProcessed, "bytes_completed": job.BytesCompleted,
		"files_completed": job.FilesCompleted, "progress": job.Progress,
		"speed_bps": int64(float64(job.BytesProcessed) / max(time.Since(p.start).Seconds(), 0.001)),
	})
	if err == nil {
		err = p.service.syncTaskRun(ctx, job.ID)
	}
	if err != nil {
		log.Printf("[TransferJob] progress persistence: job=%s error=%v", job.ID, err)
	}
}
