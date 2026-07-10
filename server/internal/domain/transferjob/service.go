package transferjob

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/google/uuid"
)

var (
	ErrInvalidJobRequest = errors.New("invalid transfer job request")
	ErrForbiddenJob      = errors.New("transfer job is not owned by user")
	ErrArtifactNotReady  = errors.New("transfer artifact is not ready")
	ErrArtifactInUse     = errors.New("transfer artifact is in use")
)

type Service interface {
	CreateUploadJob(ctx context.Context, userID uuid.UUID, req *CreateUploadRequest, reader io.Reader) (*TransferJob, error)
	CreateDownloadJob(ctx context.Context, userID uuid.UUID, req *CreateDownloadRequest) (*TransferJob, error)
	ValidateScheduledTask(ctx context.Context, userID uuid.UUID, scheduledTaskID uuid.UUID, taskType string, payloadJSON string) error
	RunScheduledTask(ctx context.Context, req RunScheduledRequest) (*TransferJob, error)
	ListJobs(ctx context.Context, req *ListRequest) (*ListResponse, error)
	GetStatistics(ctx context.Context, userID uuid.UUID) (*Statistics, error)
	GetJob(ctx context.Context, userID uuid.UUID, id uuid.UUID) (*TransferJob, error)
	AttachScheduledTask(ctx context.Context, userID uuid.UUID, id uuid.UUID, scheduledTaskID uuid.UUID) error
	DetachScheduledTask(ctx context.Context, userID uuid.UUID, id uuid.UUID) error
	CancelJob(ctx context.Context, userID uuid.UUID, id uuid.UUID) error
	DeleteJob(ctx context.Context, userID uuid.UUID, id uuid.UUID) error
	DeleteScheduledInputJob(ctx context.Context, userID uuid.UUID, id uuid.UUID, scheduledTaskID uuid.UUID) error
	GetArtifact(ctx context.Context, userID uuid.UUID, id uuid.UUID) (*TransferJob, string, error)
	StartMaintenance(ctx context.Context)
	Stop()
	SetTaskCenter(service taskcenter.Service)
}

type service struct {
	repo             Repository
	pool             *sftp.Pool
	serverService    server.Service
	systemConfig     systemconfig.Service
	operationRecords operationrecord.Service
	taskRuns         taskcenter.Service
	dataDir          string
	limiter          chan struct{}

	mu      sync.Mutex
	cancels map[uuid.UUID]context.CancelFunc

	stopMaintenance chan struct{}
	stopOnce        sync.Once
}

func (s *service) SetTaskCenter(service taskcenter.Service) { s.taskRuns = service }

type ServiceOptions struct {
	DataDir string
}

func NewService(
	repo Repository,
	pool *sftp.Pool,
	serverService server.Service,
	systemConfig systemconfig.Service,
	operationRecords operationrecord.Service,
	options ServiceOptions,
) Service {
	maxConcurrency := systemconfig.DefaultTransferMaxConcurrency()
	if systemConfig != nil {
		if cfg, err := systemConfig.Get(context.Background()); err == nil && cfg != nil {
			maxConcurrency = cfg.TransferMaxConcurrency
		}
	}
	if maxConcurrency <= 0 {
		maxConcurrency = systemconfig.DefaultTransferMaxConcurrency()
	}

	return &service{
		repo:             repo,
		pool:             pool,
		serverService:    serverService,
		systemConfig:     systemConfig,
		operationRecords: operationRecords,
		dataDir:          options.DataDir,
		limiter:          make(chan struct{}, maxConcurrency),
		cancels:          make(map[uuid.UUID]context.CancelFunc),
		stopMaintenance:  make(chan struct{}),
	}
}

func (s *service) CreateUploadJob(ctx context.Context, userID uuid.UUID, req *CreateUploadRequest, reader io.Reader) (*TransferJob, error) {
	if req == nil || reader == nil {
		return nil, ErrInvalidJobRequest
	}
	targetServerID, err := uuid.Parse(strings.TrimSpace(req.ServerID))
	if err != nil {
		return nil, fmt.Errorf("%w: invalid server_id", ErrInvalidJobRequest)
	}
	if _, err := s.serverService.GetByID(ctx, userID, targetServerID); err != nil {
		return nil, err
	}

	fileName := sanitizeFileName(req.FileName)
	if fileName == "" {
		return nil, fmt.Errorf("%w: file_name is required", ErrInvalidJobRequest)
	}
	targetDir := cleanRemoteDir(req.TargetPath)
	targetPath := path.Join(targetDir, fileName)
	cfg, err := s.config(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.ensureQuota(ctx, cfg, req.FileSize, true); err != nil {
		return nil, err
	}

	now := time.Now()
	expireTime := now.AddDate(0, 0, retentionDays(req.RetentionDays, cfg))
	expiresAt := &expireTime
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = fmt.Sprintf("上传 %s", fileName)
	}
	job := &TransferJob{
		UserID:            userID,
		Name:              name,
		Kind:              JobKindSFTPUpload,
		Runner:            "server",
		Status:            JobStatusStaging,
		Stage:             JobStageStaging,
		TargetServerID:    &targetServerID,
		SourcePath:        fileName,
		TargetPath:        targetPath,
		FileName:          fileName,
		ArtifactName:      fileName,
		ArtifactManaged:   true,
		BytesTotal:        req.FileSize,
		ArtifactExpiresAt: expiresAt,
		Description:       req.Description,
		ScheduledTaskID:   req.ScheduledTaskID,
		TaskRunID:         req.TaskRunID,
	}
	if err := s.repo.Create(ctx, job); err != nil {
		return nil, err
	}

	localPath, err := s.artifactPath(ctx, cfg, job, "upload", fileName)
	if err != nil {
		_ = s.failJob(context.Background(), job.ID, err, JobStageStaging)
		return nil, err
	}
	if err := s.stageReader(ctx, job, reader, localPath); err != nil {
		_ = os.Remove(localPath)
		_ = s.failJob(context.Background(), job.ID, err, JobStageStaging)
		return nil, err
	}

	if info, statErr := os.Stat(localPath); statErr == nil {
		job.ArtifactSize = info.Size()
		if job.BytesTotal <= 0 {
			job.BytesTotal = info.Size()
		}
	}
	if err := s.ensureQuota(ctx, cfg, 0, false); err != nil {
		_ = os.Remove(localPath)
		_ = s.failJob(context.Background(), job.ID, err, JobStageStaging)
		return nil, err
	}
	job.ArtifactPath = localPath
	if req.DeferStart {
		job.Status = JobStatusCreated
		job.Stage = JobStageStaging
		job.Progress = 100
		job.BytesProcessed = job.BytesTotal
	} else {
		job.Status = JobStatusQueued
		job.Stage = JobStageTransferToRemote
		job.Progress = 0
		job.BytesProcessed = 0
	}
	updated, err := s.repo.UpdateIfStatus(ctx, job.ID, []JobStatus{JobStatusStaging}, map[string]interface{}{
		"artifact_path":   job.ArtifactPath,
		"artifact_size":   job.ArtifactSize,
		"bytes_total":     job.BytesTotal,
		"bytes_processed": job.BytesProcessed,
		"progress":        job.Progress,
		"status":          job.Status,
		"stage":           job.Stage,
	})
	if err != nil {
		_ = os.Remove(localPath)
		_ = s.failJob(context.Background(), job.ID, err, JobStageStaging)
		return nil, err
	}
	if !updated {
		_ = os.Remove(localPath)
		return nil, fmt.Errorf("%w: transfer job was cancelled during staging", ErrInvalidJobRequest)
	}

	if !req.DeferStart {
		s.ensureTaskRun(ctx, job)
		s.runUpload(job.ID)
	}
	return s.repo.GetByID(ctx, job.ID)
}

func (s *service) CreateDownloadJob(ctx context.Context, userID uuid.UUID, req *CreateDownloadRequest) (*TransferJob, error) {
	if req == nil {
		return nil, ErrInvalidJobRequest
	}
	sourceServerID, err := uuid.Parse(strings.TrimSpace(req.ServerID))
	if err != nil {
		return nil, fmt.Errorf("%w: invalid server_id", ErrInvalidJobRequest)
	}
	if _, err := s.serverService.GetByID(ctx, userID, sourceServerID); err != nil {
		return nil, err
	}
	sourcePath := strings.TrimSpace(req.SourcePath)
	if sourcePath == "" {
		return nil, fmt.Errorf("%w: source_path is required", ErrInvalidJobRequest)
	}
	fileName := sanitizeFileName(path.Base(sourcePath))
	if fileName == "" {
		fileName = "download"
	}
	cfg, err := s.config(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	expiresAt := now.AddDate(0, 0, retentionDays(req.RetentionDays, cfg))
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = fmt.Sprintf("下载 %s", fileName)
	}
	job := &TransferJob{
		UserID:            userID,
		Name:              name,
		Kind:              JobKindSFTPDownload,
		Runner:            "server",
		Status:            JobStatusQueued,
		Stage:             JobStageDownloadFromRemote,
		SourceServerID:    &sourceServerID,
		SourcePath:        sourcePath,
		TargetPath:        fileName,
		FileName:          fileName,
		ArtifactName:      fileName,
		ArtifactManaged:   true,
		ArtifactExpiresAt: &expiresAt,
		Description:       req.Description,
		ScheduledTaskID:   req.ScheduledTaskID,
		TaskRunID:         req.TaskRunID,
	}
	if err := s.repo.Create(ctx, job); err != nil {
		return nil, err
	}

	s.ensureTaskRun(ctx, job)
	s.runDownload(job.ID)
	return job, nil
}

func (s *service) RunScheduledTask(ctx context.Context, req RunScheduledRequest) (*TransferJob, error) {
	var payload ScheduledPayload
	if strings.TrimSpace(req.PayloadJSON) != "" {
		if err := json.Unmarshal([]byte(req.PayloadJSON), &payload); err != nil {
			return nil, fmt.Errorf("%w: invalid payload_json", ErrInvalidJobRequest)
		}
	}

	switch req.TaskType {
	case string(JobKindSFTPUpload):
		return s.runScheduledUpload(ctx, req, payload)
	case string(JobKindSFTPDownload):
		return s.runScheduledDownload(ctx, req, payload)
	default:
		return nil, fmt.Errorf("%w: unsupported transfer task type %s", ErrInvalidJobRequest, req.TaskType)
	}
}

func (s *service) ValidateScheduledTask(ctx context.Context, userID uuid.UUID, scheduledTaskID uuid.UUID, taskType string, payloadJSON string) error {
	if taskType != string(JobKindSFTPUpload) && taskType != string(JobKindSFTPDownload) {
		return nil
	}

	var payload ScheduledPayload
	if strings.TrimSpace(payloadJSON) == "" {
		return fmt.Errorf("%w: payload_json must be a valid JSON object for SFTP tasks", ErrInvalidJobRequest)
	}
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return fmt.Errorf("%w: payload_json must be a valid JSON object for SFTP tasks", ErrInvalidJobRequest)
	}

	switch taskType {
	case string(JobKindSFTPUpload):
		return s.validateScheduledUploadPayload(ctx, userID, scheduledTaskID, payload)
	case string(JobKindSFTPDownload):
		return s.validateScheduledDownloadPayload(ctx, userID, payload)
	default:
		return nil
	}
}

func (s *service) validateScheduledUploadPayload(ctx context.Context, userID uuid.UUID, scheduledTaskID uuid.UUID, payload ScheduledPayload) error {
	stagedID, err := uuid.Parse(strings.TrimSpace(payload.StagedJobID))
	if err != nil {
		return fmt.Errorf("%w: staged_job_id is required for SFTP upload tasks", ErrInvalidJobRequest)
	}
	job, err := s.GetJob(ctx, userID, stagedID)
	if err != nil {
		return err
	}
	if job.Kind != JobKindSFTPUpload || job.Status != JobStatusCreated || !job.ArtifactManaged {
		return fmt.Errorf("%w: staged_job_id must reference a staged upload job", ErrInvalidJobRequest)
	}
	if job.ScheduledTaskID != nil && (scheduledTaskID == uuid.Nil || *job.ScheduledTaskID != scheduledTaskID) {
		return fmt.Errorf("%w: staged upload job is already attached to another scheduled task", ErrInvalidJobRequest)
	}
	if strings.TrimSpace(job.ArtifactPath) == "" {
		return fmt.Errorf("%w: staged artifact is missing", ErrInvalidJobRequest)
	}
	if _, err := os.Stat(job.ArtifactPath); err != nil {
		return fmt.Errorf("%w: staged artifact is missing", ErrInvalidJobRequest)
	}
	if strings.TrimSpace(payload.ServerID) != "" {
		serverID, err := uuid.Parse(strings.TrimSpace(payload.ServerID))
		if err != nil {
			return fmt.Errorf("%w: invalid server_id", ErrInvalidJobRequest)
		}
		if _, err := s.serverService.GetByID(ctx, userID, serverID); err != nil {
			return err
		}
	} else if job.TargetServerID == nil {
		return fmt.Errorf("%w: server_id is required for SFTP upload tasks", ErrInvalidJobRequest)
	}
	return nil
}

func (s *service) validateScheduledDownloadPayload(ctx context.Context, userID uuid.UUID, payload ScheduledPayload) error {
	serverID, err := uuid.Parse(strings.TrimSpace(payload.ServerID))
	if err != nil {
		return fmt.Errorf("%w: server_id is required for SFTP download tasks", ErrInvalidJobRequest)
	}
	if strings.TrimSpace(payload.SourcePath) == "" {
		return fmt.Errorf("%w: source_path is required for SFTP download tasks", ErrInvalidJobRequest)
	}
	if _, err := s.serverService.GetByID(ctx, userID, serverID); err != nil {
		return err
	}
	return nil
}

func (s *service) ListJobs(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	return s.repo.List(ctx, req)
}

func (s *service) GetStatistics(ctx context.Context, userID uuid.UUID) (*Statistics, error) {
	stats, err := s.repo.GetStatistics(ctx, userID)
	if err != nil {
		return nil, err
	}
	cfg, err := s.config(ctx)
	if err != nil {
		return nil, err
	}
	if used, err := dirSize(s.storageRoot(cfg)); err == nil {
		stats.StorageBytes = used
	}
	return stats, nil
}

func (s *service) GetJob(ctx context.Context, userID uuid.UUID, id uuid.UUID) (*TransferJob, error) {
	return s.repo.GetByUserAndID(ctx, userID, id)
}

func (s *service) AttachScheduledTask(ctx context.Context, userID uuid.UUID, id uuid.UUID, scheduledTaskID uuid.UUID) error {
	if scheduledTaskID == uuid.Nil {
		return fmt.Errorf("%w: scheduled_task_id is required", ErrInvalidJobRequest)
	}
	job, err := s.GetJob(ctx, userID, id)
	if err != nil {
		return err
	}
	if job.Kind != JobKindSFTPUpload || job.Status != JobStatusCreated || !job.ArtifactManaged {
		return fmt.Errorf("%w: scheduled input must be a staged upload job", ErrInvalidJobRequest)
	}
	if job.ScheduledTaskID != nil && *job.ScheduledTaskID != scheduledTaskID {
		return fmt.Errorf("%w: staged upload job is already attached to another scheduled task", ErrInvalidJobRequest)
	}
	if strings.TrimSpace(job.ArtifactPath) == "" {
		return fmt.Errorf("%w: staged artifact is missing", ErrInvalidJobRequest)
	}
	if _, err := os.Stat(job.ArtifactPath); err != nil {
		return fmt.Errorf("%w: staged artifact is missing", ErrInvalidJobRequest)
	}
	attached, err := s.repo.AttachScheduledTask(ctx, id, scheduledTaskID)
	if err != nil {
		return err
	}
	if !attached {
		return fmt.Errorf("%w: staged upload job is already attached to another scheduled task", ErrInvalidJobRequest)
	}
	return nil
}

func (s *service) DetachScheduledTask(ctx context.Context, userID uuid.UUID, id uuid.UUID) error {
	if _, err := s.GetJob(ctx, userID, id); err != nil {
		return err
	}
	expiresAt := s.defaultExpiration(ctx)
	return s.repo.Update(ctx, id, map[string]interface{}{
		"scheduled_task_id":   nil,
		"artifact_expires_at": expiresAt,
	})
}

func (s *service) CancelJob(ctx context.Context, userID uuid.UUID, id uuid.UUID) error {
	job, err := s.GetJob(ctx, userID, id)
	if err != nil {
		return err
	}
	if isScheduledStagedInput(job) {
		return fmt.Errorf("%w: scheduled transfer inputs are managed by their scheduled task", ErrInvalidJobRequest)
	}
	if job.Status != JobStatusCreated &&
		job.Status != JobStatusStaging &&
		job.Status != JobStatusQueued &&
		job.Status != JobStatusRunning {
		return fmt.Errorf("%w: transfer job is not cancellable", ErrInvalidJobRequest)
	}

	s.mu.Lock()
	cancel := s.cancels[id]
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	now := time.Now()
	updated, err := s.repo.UpdateIfStatus(ctx, job.ID, []JobStatus{
		JobStatusCreated,
		JobStatusStaging,
		JobStatusQueued,
		JobStatusRunning,
	}, map[string]interface{}{
		"status":        JobStatusCancelled,
		"error_message": "cancelled",
		"finished_at":   &now,
	})
	if err != nil {
		return err
	}
	if !updated {
		return fmt.Errorf("%w: transfer job is not cancellable", ErrInvalidJobRequest)
	}
	s.upsertOperationRecord(context.Background(), job.ID)
	s.syncTaskRun(context.Background(), job.ID)
	return err
}

func (s *service) DeleteJob(ctx context.Context, userID uuid.UUID, id uuid.UUID) error {
	job, err := s.GetJob(ctx, userID, id)
	if err != nil {
		return err
	}
	if isScheduledStagedInput(job) {
		return fmt.Errorf("%w: scheduled transfer inputs are managed by their scheduled task", ErrInvalidJobRequest)
	}
	return s.deleteLoadedJob(ctx, job)
}

func (s *service) DeleteScheduledInputJob(ctx context.Context, userID uuid.UUID, id uuid.UUID, scheduledTaskID uuid.UUID) error {
	if scheduledTaskID == uuid.Nil {
		return fmt.Errorf("%w: scheduled_task_id is required", ErrInvalidJobRequest)
	}
	job, err := s.GetJob(ctx, userID, id)
	if err != nil {
		return err
	}
	if job.ScheduledTaskID != nil && *job.ScheduledTaskID != scheduledTaskID {
		return fmt.Errorf("%w: staged upload job is attached to another scheduled task", ErrInvalidJobRequest)
	}
	if job.Kind != JobKindSFTPUpload || job.Status != JobStatusCreated || !job.ArtifactManaged {
		return fmt.Errorf("%w: scheduled input must be a staged upload job", ErrInvalidJobRequest)
	}
	return s.deleteLoadedJob(ctx, job)
}

func (s *service) deleteLoadedJob(ctx context.Context, job *TransferJob) error {
	if job == nil {
		return ErrJobNotFound
	}
	if job.Status == JobStatusStaging || job.Status == JobStatusQueued || job.Status == JobStatusRunning {
		return fmt.Errorf("%w: active transfer jobs must be cancelled before deletion", ErrInvalidJobRequest)
	}
	if job.ArtifactManaged && strings.TrimSpace(job.ArtifactPath) != "" {
		inUse, err := s.repo.HasActiveArtifactReference(ctx, job.ArtifactPath, job.ID)
		if err != nil {
			return err
		}
		if inUse {
			return fmt.Errorf("%w: transfer artifact is in use by an active job", ErrArtifactInUse)
		}
	}
	_ = s.removeJobFiles(ctx, job)
	if err := s.repo.Delete(ctx, job.ID); err != nil {
		return err
	}
	if s.operationRecords != nil {
		_ = s.operationRecords.DeleteBySource(ctx, "transfer_jobs", job.ID.String())
	}
	return nil
}

func (s *service) GetArtifact(ctx context.Context, userID uuid.UUID, id uuid.UUID) (*TransferJob, string, error) {
	job, err := s.GetJob(ctx, userID, id)
	if err != nil {
		return nil, "", err
	}
	if job.ArtifactPath == "" || job.Status != JobStatusCompleted {
		return nil, "", ErrArtifactNotReady
	}
	if job.ArtifactExpiresAt != nil && time.Now().After(*job.ArtifactExpiresAt) {
		_ = s.repo.Update(ctx, job.ID, map[string]interface{}{
			"status": JobStatusExpired,
			"stage":  JobStageCleanup,
		})
		return nil, "", ErrArtifactNotReady
	}
	if _, err := os.Stat(job.ArtifactPath); err != nil {
		return nil, "", ErrArtifactNotReady
	}
	return job, job.ArtifactPath, nil
}

func (s *service) StartMaintenance(ctx context.Context) {
	if err := s.repo.MarkInterrupted(ctx); err != nil {
		fmt.Printf("[TransferJob] mark interrupted jobs failed: %v\n", err)
	}
	go func() {
		s.cleanupExpired(context.Background())
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s.cleanupExpired(context.Background())
			case <-s.stopMaintenance:
				return
			}
		}
	}()
}

func (s *service) Stop() {
	s.stopOnce.Do(func() {
		close(s.stopMaintenance)
		s.mu.Lock()
		for _, cancel := range s.cancels {
			cancel()
		}
		s.cancels = make(map[uuid.UUID]context.CancelFunc)
		s.mu.Unlock()
	})
}

func (s *service) runScheduledUpload(ctx context.Context, req RunScheduledRequest, payload ScheduledPayload) (*TransferJob, error) {
	stagedID, err := uuid.Parse(strings.TrimSpace(payload.StagedJobID))
	if err != nil {
		return nil, fmt.Errorf("%w: staged_job_id is required for scheduled upload", ErrInvalidJobRequest)
	}
	stagedJob, err := s.repo.GetByUserAndID(ctx, req.UserID, stagedID)
	if err != nil {
		return nil, err
	}
	if stagedJob.Kind != JobKindSFTPUpload {
		return nil, fmt.Errorf("%w: staged job must be an upload job", ErrInvalidJobRequest)
	}
	if stagedJob.Status != JobStatusCreated && stagedJob.Status != JobStatusCompleted && stagedJob.Status != JobStatusFailed {
		return nil, fmt.Errorf("%w: staged job is not ready for scheduled upload", ErrInvalidJobRequest)
	}
	if stagedJob.ArtifactPath == "" {
		return nil, fmt.Errorf("%w: staged artifact is missing", ErrInvalidJobRequest)
	}
	if _, err := os.Stat(stagedJob.ArtifactPath); err != nil {
		return nil, fmt.Errorf("%w: staged artifact is missing", ErrInvalidJobRequest)
	}

	targetServerID := stagedJob.TargetServerID
	if strings.TrimSpace(payload.ServerID) != "" {
		parsed, err := uuid.Parse(strings.TrimSpace(payload.ServerID))
		if err != nil {
			return nil, fmt.Errorf("%w: invalid server_id", ErrInvalidJobRequest)
		}
		if _, err := s.serverService.GetByID(ctx, req.UserID, parsed); err != nil {
			return nil, err
		}
		targetServerID = &parsed
	}
	if targetServerID == nil {
		return nil, fmt.Errorf("%w: upload target server is required", ErrInvalidJobRequest)
	}

	fileName := stagedJob.FileName
	if fileName == "" {
		fileName = stagedJob.ArtifactName
	}
	if fileName == "" {
		fileName = sanitizeFileName(filepath.Base(stagedJob.ArtifactPath))
	}
	if fileName == "" {
		return nil, fmt.Errorf("%w: staged artifact file name is missing", ErrInvalidJobRequest)
	}

	targetPath := stagedJob.TargetPath
	if strings.TrimSpace(payload.TargetPath) != "" {
		targetPath = path.Join(cleanRemoteDir(payload.TargetPath), fileName)
	}
	if strings.TrimSpace(targetPath) == "" {
		return nil, fmt.Errorf("%w: upload target is incomplete", ErrInvalidJobRequest)
	}

	name := strings.TrimSpace(payload.Name)
	if name == "" {
		name = strings.TrimSpace(req.TaskName)
	}
	if name == "" {
		name = fmt.Sprintf("上传 %s", fileName)
	}
	description := strings.TrimSpace(payload.Description)
	if description == "" {
		description = stagedJob.Description
	}
	cfg, err := s.config(ctx)
	if err != nil {
		return nil, err
	}
	expireTime := time.Now().AddDate(0, 0, retentionDays(payload.RetentionDays, cfg))

	detail, _ := json.Marshal(map[string]interface{}{
		"staged_job_id": stagedJob.ID,
	})
	job := &TransferJob{
		UserID:            req.UserID,
		Name:              name,
		Kind:              JobKindSFTPUpload,
		Runner:            "server",
		Status:            JobStatusQueued,
		Stage:             JobStageTransferToRemote,
		TargetServerID:    targetServerID,
		SourcePath:        stagedJob.SourcePath,
		TargetPath:        targetPath,
		FileName:          fileName,
		ArtifactName:      fileName,
		ArtifactPath:      stagedJob.ArtifactPath,
		ArtifactSize:      stagedJob.ArtifactSize,
		ArtifactManaged:   false,
		ArtifactExpiresAt: &expireTime,
		BytesTotal:        stagedJob.BytesTotal,
		Description:       description,
		ScheduledTaskID:   &req.ScheduledTaskID,
		TaskRunID:         &req.TaskRunID,
		DetailJSON:        string(detail),
	}
	if job.BytesTotal <= 0 {
		job.BytesTotal = stagedJob.ArtifactSize
	}
	if job.SourcePath == "" {
		job.SourcePath = fileName
	}
	if err := s.repo.Create(ctx, job); err != nil {
		return nil, err
	}
	s.ensureTaskRun(ctx, job)
	s.runUpload(job.ID)
	return s.repo.GetByID(ctx, job.ID)
}

func (s *service) runScheduledDownload(ctx context.Context, req RunScheduledRequest, payload ScheduledPayload) (*TransferJob, error) {
	if strings.TrimSpace(payload.ServerID) == "" || strings.TrimSpace(payload.SourcePath) == "" {
		return nil, fmt.Errorf("%w: server_id and source_path are required for scheduled download", ErrInvalidJobRequest)
	}
	name := strings.TrimSpace(payload.Name)
	if name == "" {
		name = strings.TrimSpace(req.TaskName)
	}
	job, err := s.CreateDownloadJob(ctx, req.UserID, &CreateDownloadRequest{
		Name:            name,
		ServerID:        payload.ServerID,
		SourcePath:      payload.SourcePath,
		RetentionDays:   payload.RetentionDays,
		Description:     payload.Description,
		ScheduledTaskID: &req.ScheduledTaskID,
		TaskRunID:       &req.TaskRunID,
	})
	if err != nil {
		return nil, err
	}
	return s.repo.GetByID(ctx, job.ID)
}

func (s *service) runUpload(jobID uuid.UUID) {
	go func() {
		s.limiter <- struct{}{}
		defer func() { <-s.limiter }()

		ctx, cancel := context.WithCancel(context.Background())
		s.registerCancel(jobID, cancel)
		defer s.unregisterCancel(jobID)
		defer cancel()

		job, err := s.repo.GetByID(ctx, jobID)
		if err != nil || job.Status == JobStatusCancelled {
			return
		}
		s.executeUpload(ctx, job)
	}()
}

func (s *service) runDownload(jobID uuid.UUID) {
	go func() {
		s.limiter <- struct{}{}
		defer func() { <-s.limiter }()

		ctx, cancel := context.WithCancel(context.Background())
		s.registerCancel(jobID, cancel)
		defer s.unregisterCancel(jobID)
		defer cancel()

		job, err := s.repo.GetByID(ctx, jobID)
		if err != nil || job.Status == JobStatusCancelled {
			return
		}
		s.executeDownload(ctx, job)
	}()
}

func (s *service) executeUpload(ctx context.Context, job *TransferJob) {
	startedAt := time.Now()
	updated, err := s.repo.UpdateIfStatus(ctx, job.ID, []JobStatus{JobStatusQueued}, map[string]interface{}{
		"status":     JobStatusRunning,
		"stage":      JobStageTransferToRemote,
		"started_at": &startedAt,
	})
	if err != nil {
		_ = s.failJob(ctx, job.ID, err, JobStageTransferToRemote)
		return
	}
	if !updated {
		return
	}
	s.syncTaskRun(context.Background(), job.ID)

	if job.TargetServerID == nil {
		_ = s.failJob(ctx, job.ID, errors.New("target server is required"), JobStageTransferToRemote)
		return
	}
	file, err := os.Open(job.ArtifactPath)
	if err != nil {
		_ = s.failJob(ctx, job.ID, err, JobStageTransferToRemote)
		return
	}
	defer file.Close()

	client, err := s.pool.Get(ctx, job.UserID, *job.TargetServerID)
	if err != nil {
		_ = s.failJob(ctx, job.ID, err, JobStageTransferToRemote)
		return
	}
	defer client.Release()

	total := job.BytesTotal
	if total <= 0 {
		total = job.ArtifactSize
	}
	startTime := time.Now()
	lastProgress := startTime
	err = client.UploadFileWithProgressWithContext(ctx, file, job.TargetPath, func(loaded int64) {
		now := time.Now()
		if now.Sub(lastProgress) < 500*time.Millisecond && loaded < total {
			return
		}
		s.updateProgress(context.Background(), job.ID, JobStageTransferToRemote, loaded, total, startTime)
		lastProgress = now
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			_ = s.cancelledJob(context.Background(), job.ID)
			return
		}
		_ = s.failJob(context.Background(), job.ID, err, JobStageTransferToRemote)
		return
	}

	if s.completeJob(context.Background(), job.ID, JobStageTransferToRemote, total) {
		s.upsertOperationRecord(context.Background(), job.ID)
	}
}

func (s *service) executeDownload(ctx context.Context, job *TransferJob) {
	startedAt := time.Now()
	updated, err := s.repo.UpdateIfStatus(ctx, job.ID, []JobStatus{JobStatusQueued}, map[string]interface{}{
		"status":     JobStatusRunning,
		"stage":      JobStageDownloadFromRemote,
		"started_at": &startedAt,
	})
	if err != nil {
		_ = s.failJob(ctx, job.ID, err, JobStageDownloadFromRemote)
		return
	}
	if !updated {
		return
	}
	s.syncTaskRun(context.Background(), job.ID)

	if job.SourceServerID == nil {
		_ = s.failJob(ctx, job.ID, errors.New("source server is required"), JobStageDownloadFromRemote)
		return
	}
	client, err := s.pool.Get(ctx, job.UserID, *job.SourceServerID)
	if err != nil {
		_ = s.failJob(ctx, job.ID, err, JobStageDownloadFromRemote)
		return
	}
	defer client.Release()

	info, err := client.GetFileInfo(job.SourcePath)
	if err != nil {
		_ = s.failJob(ctx, job.ID, err, JobStageDownloadFromRemote)
		return
	}
	if info.IsDir {
		_ = s.failJob(ctx, job.ID, errors.New("background download currently supports single files"), JobStageDownloadFromRemote)
		return
	}

	cfg, err := s.config(ctx)
	if err != nil {
		_ = s.failJob(ctx, job.ID, err, JobStageDownloadFromRemote)
		return
	}
	if err := s.ensureQuota(ctx, cfg, info.Size, false); err != nil {
		_ = s.failJob(ctx, job.ID, err, JobStageDownloadFromRemote)
		return
	}
	localPath, err := s.artifactPath(ctx, cfg, job, "download", sanitizeFileName(info.Name))
	if err != nil {
		_ = s.failJob(ctx, job.ID, err, JobStageDownloadFromRemote)
		return
	}
	file, err := os.Create(localPath)
	if err != nil {
		_ = s.failJob(ctx, job.ID, err, JobStageDownloadFromRemote)
		return
	}
	defer file.Close()

	total := info.Size
	_ = s.repo.Update(ctx, job.ID, map[string]interface{}{
		"artifact_path": localPath,
		"artifact_name": info.Name,
		"bytes_total":   total,
	})

	startTime := time.Now()
	lastProgress := startTime
	err = client.DownloadFileWithProgressWithContext(ctx, job.SourcePath, file, func(loaded int64) {
		now := time.Now()
		if now.Sub(lastProgress) < 500*time.Millisecond && loaded < total {
			return
		}
		s.updateProgress(context.Background(), job.ID, JobStageDownloadFromRemote, loaded, total, startTime)
		lastProgress = now
	})
	if err != nil {
		_ = file.Close()
		_ = os.Remove(localPath)
		if errors.Is(err, context.Canceled) {
			_ = s.cancelledJob(context.Background(), job.ID)
			return
		}
		_ = s.failJob(context.Background(), job.ID, err, JobStageDownloadFromRemote)
		return
	}

	if info, statErr := os.Stat(localPath); statErr == nil {
		total = info.Size()
	}
	if err := s.ensureQuota(context.Background(), cfg, 0, false); err != nil {
		_ = file.Close()
		_ = os.Remove(localPath)
		_ = s.failJob(context.Background(), job.ID, err, JobStageDownloadFromRemote)
		return
	}
	if s.completeJob(context.Background(), job.ID, JobStageReadyForDownload, total) {
		s.upsertOperationRecord(context.Background(), job.ID)
	}
}

func (s *service) stageReader(ctx context.Context, job *TransferJob, reader io.Reader, localPath string) error {
	if err := os.MkdirAll(filepath.Dir(localPath), 0750); err != nil {
		return err
	}
	file, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer file.Close()

	startTime := time.Now()
	lastProgress := startTime
	progressReader := &progressReader{
		reader: reader,
		onProgress: func(loaded int64) {
			now := time.Now()
			if now.Sub(lastProgress) < 500*time.Millisecond && (job.BytesTotal <= 0 || loaded < job.BytesTotal) {
				return
			}
			s.updateProgress(context.Background(), job.ID, JobStageStaging, loaded, job.BytesTotal, startTime)
			lastProgress = now
		},
		reportEvery: 65536,
	}
	copyReader := io.Reader(progressReader)
	cfg, cfgErr := s.config(ctx)
	if cfgErr != nil {
		return cfgErr
	}
	limit := int64(cfg.MaxFileUploadSize)<<20 + 1
	if limit > 1 {
		copyReader = &limitReader{
			reader: copyReader,
			remain: limit,
			onExceeded: func() error {
				return fmt.Errorf("file exceeds max upload size: %d MB", cfg.MaxFileUploadSize)
			},
		}
	}
	_, err = io.Copy(file, &ctxReader{ctx: ctx, reader: copyReader})
	if err != nil {
		return err
	}
	return nil
}

func (s *service) updateProgress(ctx context.Context, id uuid.UUID, stage JobStage, loaded int64, total int64, start time.Time) {
	progress := 0
	if total > 0 {
		progress = int(float64(loaded) / float64(total) * 100)
		if progress > 100 {
			progress = 100
		}
	}
	speed := int64(0)
	elapsed := time.Since(start).Seconds()
	if elapsed > 0 {
		speed = int64(float64(loaded) / elapsed)
	}
	_, _ = s.repo.UpdateIfStatus(ctx, id, []JobStatus{
		JobStatusStaging,
		JobStatusQueued,
		JobStatusRunning,
	}, map[string]interface{}{
		"stage":           stage,
		"bytes_processed": loaded,
		"bytes_total":     total,
		"progress":        progress,
		"speed_bps":       speed,
	})
	s.syncTaskRun(context.Background(), id)
}

func (s *service) completeJob(ctx context.Context, id uuid.UUID, stage JobStage, total int64) bool {
	now := time.Now()
	updated, err := s.repo.UpdateIfStatus(ctx, id, []JobStatus{JobStatusRunning}, map[string]interface{}{
		"status":          JobStatusCompleted,
		"stage":           stage,
		"progress":        100,
		"bytes_processed": total,
		"bytes_total":     total,
		"finished_at":     &now,
	})
	if err == nil && updated {
		s.syncTaskRun(context.Background(), id)
	}
	return err == nil && updated
}

func (s *service) failJob(ctx context.Context, id uuid.UUID, err error, stage JobStage) error {
	now := time.Now()
	updated, updateErr := s.repo.UpdateIfStatus(ctx, id, []JobStatus{
		JobStatusCreated,
		JobStatusStaging,
		JobStatusQueued,
		JobStatusRunning,
	}, map[string]interface{}{
		"status":        JobStatusFailed,
		"stage":         stage,
		"error_message": err.Error(),
		"finished_at":   &now,
	})
	if updated {
		s.upsertOperationRecord(context.Background(), id)
		s.syncTaskRun(context.Background(), id)
	}
	return updateErr
}

func (s *service) cancelledJob(ctx context.Context, id uuid.UUID) error {
	now := time.Now()
	updated, updateErr := s.repo.UpdateIfStatus(ctx, id, []JobStatus{
		JobStatusCreated,
		JobStatusStaging,
		JobStatusQueued,
		JobStatusRunning,
	}, map[string]interface{}{
		"status":        JobStatusCancelled,
		"error_message": "cancelled",
		"finished_at":   &now,
	})
	if updated {
		s.upsertOperationRecord(context.Background(), id)
		s.syncTaskRun(context.Background(), id)
	}
	return updateErr
}

func (s *service) config(ctx context.Context) (*systemconfig.SystemConfig, error) {
	if s.systemConfig == nil {
		return &systemconfig.SystemConfig{
			TransferRetentionDays:  systemconfig.DefaultTransferRetentionDays(),
			TransferMaxStorageGB:   systemconfig.DefaultTransferMaxStorageGB(),
			TransferMaxConcurrency: systemconfig.DefaultTransferMaxConcurrency(),
			MaxFileUploadSize:      100,
		}, nil
	}
	cfg, err := s.systemConfig.Get(ctx)
	if err != nil {
		return nil, err
	}
	cfg.ApplyTransferDefaults()
	return cfg, nil
}

func (s *service) storageRoot(cfg *systemconfig.SystemConfig) string {
	configured := strings.TrimSpace(cfg.TransferStoragePath)
	if configured != "" {
		if abs, err := filepath.Abs(configured); err == nil {
			return abs
		}
		return configured
	}
	base := strings.TrimSpace(s.dataDir)
	if base == "" {
		base = "./data"
	}
	return filepath.Join(base, "transfers")
}

func (s *service) artifactPath(ctx context.Context, cfg *systemconfig.SystemConfig, job *TransferJob, group string, fileName string) (string, error) {
	root := s.storageRoot(cfg)
	dir := filepath.Join(root, job.UserID.String(), job.ID.String(), group)
	if err := os.MkdirAll(dir, 0750); err != nil {
		return "", err
	}
	return filepath.Join(dir, fileName), nil
}

func (s *service) jobDir(cfg *systemconfig.SystemConfig, job *TransferJob) string {
	if job != nil && strings.TrimSpace(job.ArtifactPath) != "" {
		candidate := filepath.Dir(filepath.Dir(filepath.Clean(job.ArtifactPath)))
		if filepath.Base(candidate) == job.ID.String() {
			return candidate
		}
	}
	return filepath.Join(s.storageRoot(cfg), job.UserID.String(), job.ID.String())
}

func (s *service) removeJobFiles(ctx context.Context, job *TransferJob) error {
	cfg, err := s.config(ctx)
	if err != nil {
		return err
	}
	if job == nil {
		return nil
	}
	if !job.ArtifactManaged {
		return nil
	}
	dir := s.jobDir(cfg, job)
	if strings.TrimSpace(dir) == "" || dir == "." || dir == string(filepath.Separator) {
		return nil
	}
	return os.RemoveAll(dir)
}

func (s *service) ensureQuota(ctx context.Context, cfg *systemconfig.SystemConfig, incomingBytes int64, enforceFileLimit bool) error {
	if incomingBytes < 0 {
		incomingBytes = 0
	}
	if enforceFileLimit && cfg.MaxFileUploadSize > 0 && incomingBytes > int64(cfg.MaxFileUploadSize)<<20 {
		return fmt.Errorf("file exceeds max upload size: %d MB", cfg.MaxFileUploadSize)
	}
	root := s.storageRoot(cfg)
	maxBytes := int64(cfg.TransferMaxStorageGB) << 30
	if maxBytes <= 0 {
		return nil
	}
	used, err := dirSize(root)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if used+incomingBytes > maxBytes {
		return fmt.Errorf("transfer storage quota exceeded")
	}
	return nil
}

func (s *service) cleanupExpired(ctx context.Context) {
	cfg, err := s.config(ctx)
	if err != nil || cfg == nil {
		return
	}
	jobs, err := s.repo.FindExpired(ctx, time.Now(), 100)
	if err != nil {
		fmt.Printf("[TransferJob] find expired jobs failed: %v\n", err)
		return
	}
	for _, job := range jobs {
		if cfg.TransferCleanupEnabled && job.ArtifactManaged {
			if strings.TrimSpace(job.ArtifactPath) != "" {
				inUse, err := s.repo.HasActiveArtifactReference(ctx, job.ArtifactPath, job.ID)
				if err != nil {
					fmt.Printf("[TransferJob] check artifact references failed: %v\n", err)
					continue
				}
				if inUse {
					continue
				}
			}
			_ = os.RemoveAll(s.jobDir(cfg, job))
		}
		now := time.Now()
		if err := s.repo.Update(ctx, job.ID, map[string]interface{}{
			"status":      JobStatusExpired,
			"stage":       JobStageCleanup,
			"finished_at": &now,
		}); err != nil {
			fmt.Printf("[TransferJob] mark expired job failed: %v\n", err)
			continue
		}
		s.upsertOperationRecord(ctx, job.ID)
	}
}

func (s *service) registerCancel(id uuid.UUID, cancel context.CancelFunc) {
	s.mu.Lock()
	s.cancels[id] = cancel
	s.mu.Unlock()
}

func (s *service) unregisterCancel(id uuid.UUID) {
	s.mu.Lock()
	delete(s.cancels, id)
	s.mu.Unlock()
}

func (s *service) upsertOperationRecord(ctx context.Context, id uuid.UUID) {
	if s.operationRecords == nil {
		return
	}
	job, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return
	}
	status := operationrecord.StatusRunning
	switch job.Status {
	case JobStatusCompleted:
		status = operationrecord.StatusSuccess
	case JobStatusFailed:
		status = operationrecord.StatusFailure
	case JobStatusCancelled:
		status = operationrecord.StatusCanceled
	case JobStatusQueued, JobStatusCreated, JobStatusStaging:
		status = operationrecord.StatusPending
	}
	detail, _ := json.Marshal(map[string]interface{}{
		"job_id":              job.ID,
		"kind":                job.Kind,
		"stage":               job.Stage,
		"artifact_name":       job.ArtifactName,
		"artifact_expires_at": job.ArtifactExpiresAt,
	})
	resource := job.SourcePath
	if job.TargetPath != "" {
		resource = fmt.Sprintf("%s -> %s", job.SourcePath, job.TargetPath)
	}
	var serverID *uuid.UUID
	if job.SourceServerID != nil {
		serverID = job.SourceServerID
	}
	if job.TargetServerID != nil {
		serverID = job.TargetServerID
	}
	durationMs := int64(0)
	if job.StartedAt != nil && job.FinishedAt != nil {
		durationMs = job.FinishedAt.Sub(*job.StartedAt).Milliseconds()
	}
	record := &operationrecord.OperationRecord{
		UserID:         job.UserID,
		Type:           operationrecord.TypeTransfer,
		Action:         string(job.Kind),
		Status:         status,
		ServerID:       serverID,
		Title:          job.Name,
		Resource:       resource,
		Source:         "transfer_job",
		StartedAt:      job.StartedAt,
		FinishedAt:     job.FinishedAt,
		DurationMs:     durationMs,
		Progress:       job.Progress,
		BytesTotal:     job.BytesTotal,
		BytesProcessed: job.BytesProcessed,
		SpeedBps:       job.SpeedBps,
		ErrorMessage:   job.ErrorMessage,
		DetailJSON:     string(detail),
		SourceTable:    "transfer_jobs",
		SourceID:       job.ID.String(),
		CreatedAt:      job.CreatedAt,
		UpdatedAt:      time.Now(),
	}
	_ = s.operationRecords.Upsert(ctx, record)
}

func (s *service) ensureTaskRun(ctx context.Context, job *TransferJob) {
	if s.taskRuns == nil || job == nil || job.Status == JobStatusCreated || job.Status == JobStatusStaging {
		return
	}
	if job.TaskRunID != nil && *job.TaskRunID != uuid.Nil {
		return
	}
	run := &taskcenter.TaskRun{
		UserID:      job.UserID,
		TaskType:    string(job.Kind),
		Title:       job.Name,
		Description: job.Description,
		TriggerType: taskcenter.TriggerManual,
		Runner:      job.Runner,
		Status:      taskcenter.StatusQueued,
		SourceType:  "transfer_job",
		SourceID:    job.ID.String(),
		Resource:    transferJobResource(job),
		Cancelable:  false,
		Retryable:   job.ScheduledTaskID != nil,
		BytesTotal:  job.BytesTotal,
	}
	if job.ScheduledTaskID != nil {
		run.DefinitionID = job.ScheduledTaskID
		run.TriggerType = taskcenter.TriggerScheduled
	}
	if err := s.taskRuns.Create(ctx, run); err != nil {
		return
	}
	job.TaskRunID = &run.ID
	_ = s.repo.Update(ctx, job.ID, map[string]interface{}{"task_run_id": run.ID})
}

func (s *service) syncTaskRun(ctx context.Context, jobID uuid.UUID) {
	if s.taskRuns == nil {
		return
	}
	job, err := s.repo.GetByID(ctx, jobID)
	if err != nil {
		return
	}
	s.ensureTaskRun(ctx, job)
	if job.TaskRunID == nil || *job.TaskRunID == uuid.Nil {
		return
	}
	progressJSON, _ := json.Marshal(map[string]interface{}{
		"bytes_total":     job.BytesTotal,
		"bytes_processed": job.BytesProcessed,
		"speed_bps":       job.SpeedBps,
	})
	switch job.Status {
	case JobStatusRunning:
		_ = s.taskRuns.Start(ctx, *job.TaskRunID, string(job.Stage))
		_ = s.taskRuns.UpdateProgress(ctx, *job.TaskRunID, job.Progress, string(job.Stage), string(progressJSON), 0, 0)
	case JobStatusQueued, JobStatusStaging:
		_ = s.taskRuns.UpdateProgress(ctx, *job.TaskRunID, job.Progress, string(job.Stage), string(progressJSON), 0, 0)
	case JobStatusCompleted:
		_ = s.taskRuns.Complete(ctx, *job.TaskRunID, taskcenter.StatusSucceeded, job.DetailJSON, "", "", 1, 0)
	case JobStatusFailed:
		_ = s.taskRuns.Complete(ctx, *job.TaskRunID, taskcenter.StatusFailed, job.DetailJSON, "transfer_failed", job.ErrorMessage, 0, 1)
	case JobStatusCancelled:
		_ = s.taskRuns.Complete(ctx, *job.TaskRunID, taskcenter.StatusCanceled, job.DetailJSON, "", job.ErrorMessage, 0, 0)
	case JobStatusExpired:
		_ = s.taskRuns.AppendEvent(ctx, *job.TaskRunID, job.UserID, "info", "传输制品已过期清理", "")
	}
}

func transferJobResource(job *TransferJob) string {
	if job == nil {
		return ""
	}
	if job.TargetPath != "" {
		return fmt.Sprintf("%s -> %s", job.SourcePath, job.TargetPath)
	}
	return job.SourcePath
}

func retentionDays(requested int, cfg *systemconfig.SystemConfig) int {
	if requested > 0 {
		return requested
	}
	if cfg.TransferRetentionDays > 0 {
		return cfg.TransferRetentionDays
	}
	return systemconfig.DefaultTransferRetentionDays()
}

func (s *service) defaultExpiration(ctx context.Context) *time.Time {
	cfg, err := s.config(ctx)
	days := systemconfig.DefaultTransferRetentionDays()
	if err == nil && cfg != nil {
		days = retentionDays(0, cfg)
	}
	expiresAt := time.Now().AddDate(0, 0, days)
	return &expiresAt
}

func isScheduledStagedInput(job *TransferJob) bool {
	return job != nil &&
		job.ScheduledTaskID != nil &&
		job.Kind == JobKindSFTPUpload &&
		job.Status == JobStatusCreated &&
		job.ArtifactManaged
}

func cleanRemoteDir(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "/"
	}
	cleaned := path.Clean(trimmed)
	if !strings.HasPrefix(cleaned, "/") {
		cleaned = "/" + cleaned
	}
	return cleaned
}

func sanitizeFileName(value string) string {
	name := path.Base(filepath.ToSlash(strings.TrimSpace(value)))
	if name == "." || name == "/" || name == ".." {
		return ""
	}
	return name
}

func dirSize(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(item string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		return nil
	})
	if err != nil {
		return 0, err
	}
	return total, nil
}

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

type progressReader struct {
	reader      io.Reader
	onProgress  func(loaded int64)
	loaded      int64
	lastReport  int64
	reportEvery int64
}

func (r *progressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.loaded += int64(n)
	if r.loaded-r.lastReport >= r.reportEvery {
		r.onProgress(r.loaded)
		r.lastReport = r.loaded
	}
	return n, err
}

type limitReader struct {
	reader     io.Reader
	remain     int64
	onExceeded func() error
}

func (r *limitReader) Read(p []byte) (int, error) {
	if r.remain <= 0 {
		if r.onExceeded != nil {
			return 0, r.onExceeded()
		}
		return 0, fmt.Errorf("read limit exceeded")
	}
	if int64(len(p)) > r.remain {
		p = p[:r.remain]
	}
	n, err := r.reader.Read(p)
	r.remain -= int64(n)
	if r.remain <= 0 && err == nil {
		if r.onExceeded != nil {
			return n, r.onExceeded()
		}
		return n, fmt.Errorf("read limit exceeded")
	}
	return n, err
}
