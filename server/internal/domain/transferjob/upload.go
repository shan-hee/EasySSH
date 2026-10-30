package transferjob

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

type uploadInput struct {
	DeferStart bool `json:"defer_start"`
}

// Persist the target before accepting bytes. Awaiting input is distinct from a
// fully staged scheduled-task input, even though neither has been dispatched.
func (s *service) CreateUploadJob(ctx context.Context, req *CreateUploadRequest) (*TransferJob, error) {
	ctx, done, err := s.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	if req == nil || req.FileSize < 0 || req.RetentionDays < 0 || req.RetentionDays > 30 ||
		!path.IsAbs(req.TargetPath) || strings.ContainsAny(req.TargetPath, "\x00\\") || len(req.TargetPath) > 4096 ||
		req.FileName == "" || req.FileName == "." || req.FileName == ".." || len(req.FileName) > 255 || strings.ContainsAny(req.FileName, "/\\\x00") {
		return nil, ErrInvalidJobRequest
	}
	targetPath := path.Join(req.TargetPath, req.FileName)
	if len(targetPath) > 4096 || len([]rune(strings.TrimSpace(req.Name))) > 160 {
		return nil, ErrInvalidJobRequest
	}
	scope := access.Current(ctx)
	if req.DeferStart && !scope.IsOwner() {
		return nil, access.ErrForbidden
	}
	serverID, err := uuid.Parse(req.ServerID)
	if err != nil || serverID == uuid.Nil {
		return nil, ErrInvalidJobRequest
	}
	requirement := access.Requirement{Action: protocol.FilesUpload, ServerID: serverID.String()}
	if err := scope.CheckBytes(ctx, requirement, req.FileSize); err != nil {
		return nil, err
	}
	if _, err := s.serverService.GetByID(ctx, scope, serverID); err != nil {
		return nil, err
	}
	cfg, err := s.config(ctx)
	if err != nil {
		return nil, err
	}
	if cfg.MaxFileUploadSize > 0 && req.FileSize > int64(cfg.MaxFileUploadSize)<<20 {
		return nil, fmt.Errorf("%w: file exceeds configured upload limit", ErrInvalidJobRequest)
	}
	days := retentionDays(req.RetentionDays, cfg)
	if !scope.IsOwner() {
		days = cfg.TransferRetentionDays
	}
	expires := time.Now().UTC().AddDate(0, 0, days)
	name := strings.TrimSpace(req.Name)
	if name == "" {
		label := []rune("上传 " + req.FileName)
		name = string(label[:min(len(label), 160)])
	}
	detail, err := json.Marshal(uploadInput{DeferStart: req.DeferStart})
	if err != nil {
		return nil, err
	}
	job := &TransferJob{
		Actor: scope.Actor(), Name: name, Kind: JobKindSFTPUpload, Runner: "server",
		Status: JobStatusCreated, Stage: JobStageAwaitingInput, TargetServerID: &serverID,
		SourcePath: req.FileName, TargetPath: targetPath, FileName: req.FileName,
		ArtifactName: req.FileName, ArtifactManaged: true, ArtifactExpiresAt: &expires,
		BytesTotal: req.FileSize, FilesTotal: 1, Description: req.Description, DetailJSON: string(detail),
	}
	return s.saveAdmission(ctx, job)
}

func (s *service) UploadJobContent(ctx context.Context, id uuid.UUID, reader io.ReadCloser) (*TransferJob, error) {
	if reader == nil {
		return nil, ErrInvalidJobRequest
	}
	defer reader.Close()
	ctx, done, err := s.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	s.storageMu.RLock()
	defer s.storageMu.RUnlock()
	release, err := s.limiter.Acquire(ctx, false)
	if err != nil {
		return nil, err
	}
	defer release()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	s.stagingMu.Lock()
	if s.staging[id] != nil {
		s.stagingMu.Unlock()
		return nil, ErrArtifactInUse
	}
	s.staging[id] = cancel
	s.stagingMu.Unlock()
	defer func() { s.stagingMu.Lock(); delete(s.staging, id); s.stagingMu.Unlock() }()
	job, err := s.GetJob(ctx, id)
	if err != nil {
		return nil, err
	}
	if job.Actor != access.Current(ctx).Actor() {
		return nil, access.ErrForbidden
	}
	if job.Kind != JobKindSFTPUpload || job.Status != JobStatusCreated || job.Stage != JobStageAwaitingInput ||
		job.TargetServerID == nil || job.ArtifactPath != "" || job.ScheduledTaskID != nil || job.ArtifactCleanedAt != nil ||
		job.ArtifactExpiresAt == nil || !time.Now().Before(*job.ArtifactExpiresAt) {
		return nil, fmt.Errorf("%w: job is not awaiting upload input", ErrInvalidJobRequest)
	}
	var input uploadInput
	if err := json.Unmarshal([]byte(job.DetailJSON), &input); err != nil {
		return nil, err
	}
	requirement := access.Requirement{Action: protocol.FilesUpload, ServerID: job.TargetServerID.String()}
	lease, err := access.Current(ctx).OpenWork(ctx, access.Task, requirement)
	if err != nil {
		return nil, err
	}
	defer lease.Close(nil)
	ctx = lease.Context()
	if err := access.Current(ctx).CheckBytes(ctx, requirement, job.BytesTotal); err != nil {
		return nil, err
	}
	cfg, err := s.config(ctx)
	if err != nil {
		return nil, err
	}
	reservation, err := s.reserveStorage(cfg, job.BytesTotal, true)
	if err != nil {
		return nil, err
	}
	defer reservation.Close()
	started := time.Now().UTC()
	changed, err := s.repo.ClaimUploadInput(ctx, id, started)
	if err != nil {
		return nil, err
	}
	if !changed {
		return nil, ErrArtifactInUse
	}
	job.Status, job.Stage, job.StartedAt = JobStatusStaging, JobStageStaging, &started
	stop := context.AfterFunc(ctx, func() { _ = reader.Close() })
	defer stop()
	localPath, err := s.artifactPath(ctx, cfg, job, "upload", job.FileName)
	if err != nil {
		return s.savePreparationFailure(ctx, job, err)
	}
	job.ArtifactPath = localPath
	if err := s.stageReader(ctx, job, reader, localPath, reservation); err != nil {
		if info, statErr := os.Stat(localPath); statErr == nil {
			job.ArtifactSize = info.Size()
		}
		return s.savePreparationFailure(ctx, job, err)
	}
	job.ArtifactSize = job.BytesTotal
	if err := ctx.Err(); err != nil {
		return s.savePreparationFailure(ctx, job, err)
	}
	if input.DeferStart {
		job.Status, job.Progress, job.BytesProcessed = JobStatusCreated, 100, job.BytesTotal
	} else {
		job.Status, job.Stage, job.Progress, job.BytesProcessed = JobStatusQueued, JobStageTransferToRemote, 0, 0
	}
	return s.saveStaged(ctx, job)
}
