package transferjob

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sftputil"
	"io"
	"log"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/google/uuid"
)

var (
	ErrInvalidJobRequest = errors.New("invalid transfer job request")
	ErrForbiddenJob      = errors.New("transfer job is outside the access scope")
	ErrArtifactNotReady  = errors.New("transfer artifact is not ready")
	ErrArtifactInUse     = errors.New("transfer artifact is in use")
)

type Service interface {
	ArtifactRequirements(context.Context, access.Scope, string) ([]access.Requirement, error)
	SnapshotStorage(fn func() error) error
	ConfigureStorage(context.Context, *systemconfig.SystemConfig) error
	CreateUploadJob(ctx context.Context, req *CreateUploadRequest) (*TransferJob, error)
	UploadJobContent(ctx context.Context, id uuid.UUID, reader io.ReadCloser) (*TransferJob, error)
	CreateRelayJob(context.Context, *protocol.TransferRelayInput) (*TransferJob, error)
	CreateDownloadJob(ctx context.Context, req *CreateDownloadRequest) (*TransferJob, error)
	ValidateScheduledTask(ctx context.Context, scheduledTaskID uuid.UUID, taskType string, payloadJSON string) error
	RunScheduledTask(ctx context.Context, req RunScheduledRequest) (*TransferJob, error)
	ListJobs(ctx context.Context, req *ListRequest) (*ListResponse, error)
	GetStatistics(ctx context.Context) (*protocol.TransferStatistics, error)
	GetJob(ctx context.Context, id uuid.UUID) (*TransferJob, error)
	AttachScheduledTask(ctx context.Context, id uuid.UUID, scheduledTaskID uuid.UUID) error
	DetachScheduledTask(ctx context.Context, id uuid.UUID) error
	CancelJob(ctx context.Context, id uuid.UUID) error
	DeleteJob(ctx context.Context, id uuid.UUID) error
	DeleteScheduledInputJob(ctx context.Context, id uuid.UUID, scheduledTaskID uuid.UUID) error
	GetArtifact(ctx context.Context, id uuid.UUID) (*TransferJob, string, error)
	RecoverInterrupted(ctx context.Context) error
	StartMaintenance(ctx context.Context)
	Stop(context.Context) error
	SetTaskCenter(service taskcenter.Service)
	SetQueue(queue jobqueue.Enqueuer)
	HandleQueueJob(ctx context.Context, job *jobqueue.Job) error
	RejectQueueJob(context.Context, *jobqueue.Job, error) error
}

type service struct {
	artifactMu    sync.Mutex
	budget        storageBudget
	stagingMu     sync.Mutex
	staging       map[uuid.UUID]context.CancelFunc
	storageMu     sync.RWMutex
	repo          Repository
	pool          *sftp.Pool
	serverService server.Service
	systemConfig  systemconfig.Service
	taskRuns      taskcenter.Service
	queue         jobqueue.Enqueuer
	dataDir       string
	limiter       *sftp.TransferLimiter

	lifecycleMu sync.Mutex
	operations  map[uuid.UUID]context.CancelFunc
	workers     sync.WaitGroup
	stopped     bool
	startOnce   sync.Once
	stopOnce    sync.Once
	stopDone    chan struct{}
}

func (s *service) SetTaskCenter(service taskcenter.Service) { s.taskRuns = service }

func (s *service) SetQueue(queue jobqueue.Enqueuer) { s.queue = queue }

type ServiceOptions struct {
	DataDir string
	Limiter *sftp.TransferLimiter
}

func NewService(
	repo Repository,
	pool *sftp.Pool,
	serverService server.Service,
	systemConfig systemconfig.Service,
	options ServiceOptions,
) Service {
	return &service{staging: make(map[uuid.UUID]context.CancelFunc),
		repo:          repo,
		pool:          pool,
		serverService: serverService,
		systemConfig:  systemConfig,
		dataDir:       options.DataDir,
		limiter:       options.Limiter,
	}
}

func (s *service) CreateDownloadJob(ctx context.Context, req *CreateDownloadRequest) (*TransferJob, error) {
	ctx, finishOperation, err := s.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finishOperation()

	if req == nil {
		return nil, ErrInvalidJobRequest
	}
	sourceServerID, err := uuid.Parse(strings.TrimSpace(req.ServerID))
	if err != nil {
		return nil, fmt.Errorf("%w: invalid server_id", ErrInvalidJobRequest)
	}
	lease, err := access.Current(ctx).OpenWork(ctx, access.Task, access.Requirement{Action: protocol.FilesDownload, ServerID: sourceServerID.String()})
	if err != nil {
		return nil, err
	}
	defer lease.Close(nil)
	ctx = lease.Context()
	if err := access.Current(ctx).CheckBytes(ctx, access.Requirement{Action: protocol.FilesDownload, ServerID: sourceServerID.String()}, 1); err != nil {
		return nil, err
	}
	if _, err := s.serverService.GetByID(ctx, access.Current(ctx), sourceServerID); err != nil {
		return nil, err
	}
	cfg, err := s.config(ctx)
	if err != nil {
		return nil, err
	}
	selection, err := normalizeDownloadSelection(req, cfg)
	if err != nil {
		return nil, err
	}
	detail, err := json.Marshal(selection)
	if err != nil {
		return nil, err
	}
	sourcePath := selection.Paths[0]
	fileName := sanitizeFileName(path.Base(sourcePath))
	if selection.Archive {
		fileName = "files.zip"
	}

	if !access.Current(ctx).IsOwner() {
		req.RetentionDays = cfg.TransferRetentionDays
	}
	now := time.Now()
	expiresAt := now.AddDate(0, 0, retentionDays(req.RetentionDays, cfg))
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = fmt.Sprintf("下载 %s", fileName)
	}
	job := &TransferJob{
		Actor:             access.Current(ctx).Actor(),
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
	job.DetailJSON = string(detail)

	return s.saveAdmission(ctx, job)
}

func (s *service) RunScheduledTask(ctx context.Context, req RunScheduledRequest) (*TransferJob, error) {
	if req.TaskRunID == uuid.Nil || req.ScheduledTaskID == uuid.Nil {
		return nil, ErrInvalidJobRequest
	}
	ctx, finishOperation, err := s.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer finishOperation()

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

func (s *service) ValidateScheduledTask(ctx context.Context, scheduledTaskID uuid.UUID, taskType string, payloadJSON string) error {
	if err := access.Current(ctx).RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
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
		return s.validateScheduledUploadPayload(ctx, scheduledTaskID, payload)
	case string(JobKindSFTPDownload):
		return s.validateScheduledDownloadPayload(ctx, payload)
	default:
		return nil
	}
}

func (s *service) validateScheduledUploadPayload(ctx context.Context, scheduledTaskID uuid.UUID, payload ScheduledPayload) error {
	stagedID, err := uuid.Parse(strings.TrimSpace(payload.StagedJobID))
	if err != nil {
		return fmt.Errorf("%w: staged_job_id is required for SFTP upload tasks", ErrInvalidJobRequest)
	}
	job, err := s.GetJob(ctx, stagedID)
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
		if _, err := s.serverService.GetByID(ctx, access.Current(ctx), serverID); err != nil {
			return err
		}
	} else if job.TargetServerID == nil {
		return fmt.Errorf("%w: server_id is required for SFTP upload tasks", ErrInvalidJobRequest)
	}
	return nil
}

func (s *service) validateScheduledDownloadPayload(ctx context.Context, payload ScheduledPayload) error {
	serverID, err := uuid.Parse(strings.TrimSpace(payload.ServerID))
	if err != nil {
		return fmt.Errorf("%w: server_id is required for SFTP download tasks", ErrInvalidJobRequest)
	}
	if strings.TrimSpace(payload.SourcePath) == "" {
		return fmt.Errorf("%w: source_path is required for SFTP download tasks", ErrInvalidJobRequest)
	}
	if _, err := s.serverService.GetByID(ctx, access.Current(ctx), serverID); err != nil {
		return err
	}
	return nil
}

func (s *service) ListJobs(ctx context.Context, req *ListRequest) (*ListResponse, error) {
	return s.repo.List(ctx, req)
}

func (s *service) GetStatistics(ctx context.Context) (*protocol.TransferStatistics, error) {
	stats, err := s.repo.GetStatistics(ctx)
	if err != nil {
		return nil, err
	}
	return stats, nil
}

func (s *service) GetJob(ctx context.Context, id uuid.UUID) (*TransferJob, error) {
	return s.repo.GetVisible(ctx, id)
}

func (s *service) AttachScheduledTask(ctx context.Context, id uuid.UUID, scheduledTaskID uuid.UUID) error {
	ctx, finishOperation, admissionErr := s.beginOperation(ctx)
	if admissionErr != nil {
		return admissionErr
	}
	defer finishOperation()

	if err := access.Current(ctx).RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	if scheduledTaskID == uuid.Nil {
		return fmt.Errorf("%w: scheduled_task_id is required", ErrInvalidJobRequest)
	}
	job, err := s.GetJob(ctx, id)
	if err != nil {
		return err
	}
	s.storageMu.RLock()
	defer s.storageMu.RUnlock()
	s.artifactMu.Lock()
	defer s.artifactMu.Unlock()
	job, err = s.repo.GetByID(ctx, id)
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

func (s *service) DetachScheduledTask(ctx context.Context, id uuid.UUID) error {
	ctx, finishOperation, admissionErr := s.beginOperation(ctx)
	if admissionErr != nil {
		return admissionErr
	}
	defer finishOperation()

	if err := access.Current(ctx).RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	job, err := s.GetJob(ctx, id)
	if err != nil {
		return err
	}
	s.storageMu.RLock()
	defer s.storageMu.RUnlock()
	s.artifactMu.Lock()
	defer s.artifactMu.Unlock()
	job, err = s.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if job.Kind != JobKindSFTPUpload || job.Status != JobStatusCreated || !job.ArtifactManaged {
		return ErrInvalidJobRequest
	}
	expiresAt := s.defaultExpiration(ctx)
	return s.repo.Update(ctx, id, map[string]interface{}{
		"scheduled_task_id":   nil,
		"artifact_expires_at": expiresAt,
	})
}

func (s *service) CancelJob(ctx context.Context, id uuid.UUID) error {
	ctx, finishOperation, admissionErr := s.beginOperation(ctx)
	if admissionErr != nil {
		return admissionErr
	}
	defer finishOperation()
	ctx, cancelDeadline := context.WithTimeout(ctx, 5*time.Second)
	defer cancelDeadline()

	job, err := s.GetJob(ctx, id)
	if err != nil {
		return err
	}
	if isScheduledStagedInput(job) {
		return fmt.Errorf("%w: scheduled transfer inputs are managed by their scheduled task", ErrInvalidJobRequest)
	}
	// The source CAS arbitrates with executor admission. Only work which has
	// not started can become cancelled immediately; running work must settle.
	for {
		status, ok := cancellationStatus(job.Status)
		if !ok {
			return fmt.Errorf("%w: transfer job is not cancellable", ErrInvalidJobRequest)
		}
		if job.Status == JobStatusCanceling || job.Status == JobStatusCancelled {
			break
		}
		updates := map[string]interface{}{"status": status, "error_message": "cancellation requested"}
		if status == JobStatusCancelled {
			now := time.Now().UTC()
			updates["finished_at"], updates["speed_bps"] = &now, 0
		}
		updated, err := s.repo.UpdateIfStatus(ctx, id, []JobStatus{job.Status}, updates)
		if err != nil {
			return err
		}
		if updated {
			break
		}
		job, err = s.GetJob(ctx, id)
		if err != nil {
			return err
		}
	}
	s.stagingMu.Lock()
	if cancel := s.staging[id]; cancel != nil {
		cancel()
	}
	s.stagingMu.Unlock()
	var queueErr error
	if s.queue != nil {
		queueErr = s.queue.CancelBySource(ctx, "transfer_job", id.String())
	}
	finishCtx, cancelFinish := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancelFinish()
	return errors.Join(queueErr, s.syncTaskRun(finishCtx, id))
}

func cancellationStatus(status JobStatus) (JobStatus, bool) {
	switch status {
	case JobStatusCreated, JobStatusQueued, JobStatusCancelled:
		return JobStatusCancelled, true
	case JobStatusStaging, JobStatusRunning, JobStatusCanceling:
		return JobStatusCanceling, true
	default:
		return status, false
	}
}

func (s *service) DeleteJob(ctx context.Context, id uuid.UUID) error {
	ctx, finishOperation, admissionErr := s.beginOperation(ctx)
	if admissionErr != nil {
		return admissionErr
	}
	defer finishOperation()

	job, err := s.GetJob(ctx, id)
	if err != nil {
		return err
	}
	if isScheduledStagedInput(job) {
		return fmt.Errorf("%w: scheduled transfer inputs are managed by their scheduled task", ErrInvalidJobRequest)
	}
	return s.deleteLoadedJob(ctx, job, nil)
}

func (s *service) DeleteScheduledInputJob(ctx context.Context, id uuid.UUID, scheduledTaskID uuid.UUID) error {
	ctx, finishOperation, admissionErr := s.beginOperation(ctx)
	if admissionErr != nil {
		return admissionErr
	}
	defer finishOperation()

	if err := access.Current(ctx).RequireOwner(ctx, protocol.ResourcesManage); err != nil {
		return err
	}
	if scheduledTaskID == uuid.Nil {
		return fmt.Errorf("%w: scheduled_task_id is required", ErrInvalidJobRequest)
	}
	job, err := s.GetJob(ctx, id)
	if err != nil {
		return err
	}
	if job.ScheduledTaskID != nil && *job.ScheduledTaskID != scheduledTaskID {
		return fmt.Errorf("%w: staged upload job is attached to another scheduled task", ErrInvalidJobRequest)
	}
	if job.Kind != JobKindSFTPUpload || job.Status != JobStatusCreated || !job.ArtifactManaged {
		return fmt.Errorf("%w: scheduled input must be a staged upload job", ErrInvalidJobRequest)
	}
	return s.deleteLoadedJob(ctx, job, &scheduledTaskID)
}

func (s *service) deleteLoadedJob(ctx context.Context, job *TransferJob, scheduledTaskID *uuid.UUID) error {
	s.storageMu.RLock()
	defer s.storageMu.RUnlock()
	if job == nil {
		return ErrJobNotFound
	}
	s.artifactMu.Lock()
	defer s.artifactMu.Unlock()
	current, err := s.repo.GetByID(ctx, job.ID)
	if err != nil {
		return err
	}
	job = current
	if scheduledTaskID == nil && isScheduledStagedInput(job) {
		return ErrInvalidJobRequest
	}
	if scheduledTaskID != nil {
		if job.Kind != JobKindSFTPUpload || job.Status != JobStatusCreated || !job.ArtifactManaged || job.ScheduledTaskID != nil && *job.ScheduledTaskID != *scheduledTaskID {
			return ErrInvalidJobRequest
		}
	}
	if job.Status == JobStatusStaging || job.Status == JobStatusQueued || job.Status == JobStatusRunning || job.Status == JobStatusCanceling {
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
	if err := s.removeJobFiles(ctx, job); err != nil {
		return err
	}
	if err := s.repo.Delete(ctx, job.ID); err != nil {
		return err
	}

	return nil
}

func (s *service) GetArtifact(ctx context.Context, id uuid.UUID) (*TransferJob, string, error) {
	job, err := s.GetJob(ctx, id)
	if err != nil {
		return nil, "", err
	}
	if job.ArtifactPath == "" || job.Status != JobStatusCompleted {
		return nil, "", ErrArtifactNotReady
	}
	if job.ArtifactExpiresAt != nil && time.Now().After(*job.ArtifactExpiresAt) {
		return nil, "", ErrArtifactNotReady
	}
	if _, err := os.Stat(job.ArtifactPath); err != nil {
		return nil, "", ErrArtifactNotReady
	}
	return job, job.ArtifactPath, nil
}

func (s *service) RecoverInterrupted(ctx context.Context) error {
	jobs, err := s.repo.RecoverInterrupted(ctx)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		if err := s.syncTaskRun(ctx, job.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *service) runScheduledUpload(ctx context.Context, req RunScheduledRequest, payload ScheduledPayload) (*TransferJob, error) {
	s.storageMu.RLock()
	defer s.storageMu.RUnlock()
	stagedID, err := uuid.Parse(strings.TrimSpace(payload.StagedJobID))
	if err != nil {
		return nil, fmt.Errorf("%w: staged_job_id is required for scheduled upload", ErrInvalidJobRequest)
	}
	stagedJob, err := s.GetJob(ctx, stagedID)
	if err != nil {
		return nil, err
	}
	actor := access.Current(ctx).Actor()
	if actor.Kind != protocol.Owner || stagedJob.Actor.Kind != protocol.Owner || actor.ID != stagedJob.Actor.ID || stagedJob.ScheduledTaskID == nil || *stagedJob.ScheduledTaskID != req.ScheduledTaskID {
		return nil, ErrForbiddenJob
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
		if _, err := s.serverService.GetByID(ctx, access.Current(ctx), parsed); err != nil {
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
		Actor:             access.Current(ctx).Actor(),
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
		FilesTotal:        1,
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
	return s.saveAdmission(ctx, job)
}

func (s *service) runScheduledDownload(ctx context.Context, req RunScheduledRequest, payload ScheduledPayload) (*TransferJob, error) {
	if strings.TrimSpace(payload.ServerID) == "" || strings.TrimSpace(payload.SourcePath) == "" {
		return nil, fmt.Errorf("%w: server_id and source_path are required for scheduled download", ErrInvalidJobRequest)
	}
	name := strings.TrimSpace(payload.Name)
	if name == "" {
		name = strings.TrimSpace(req.TaskName)
	}
	return s.CreateDownloadJob(ctx, &CreateDownloadRequest{
		Name:            name,
		ServerID:        payload.ServerID,
		SourcePath:      payload.SourcePath,
		RetentionDays:   payload.RetentionDays,
		Description:     payload.Description,
		ScheduledTaskID: &req.ScheduledTaskID,
		TaskRunID:       &req.TaskRunID,
	})
}

func (s *service) HandleQueueJob(ctx context.Context, queuedJob *jobqueue.Job) error {
	ctx, finishOperation, err := s.beginOperation(ctx)
	if err != nil {
		return err
	}
	defer finishOperation()

	s.storageMu.RLock()
	defer s.storageMu.RUnlock()
	var payload struct {
		JobID uuid.UUID `json:"job_id"`
	}
	if queuedJob == nil {
		return ErrInvalidJobRequest
	}
	if err := json.Unmarshal([]byte(queuedJob.PayloadJSON), &payload); err != nil {
		return err
	}
	job, err := s.repo.GetByID(ctx, payload.JobID)
	if err != nil {
		return err
	}
	if job.Actor != queuedJob.Actor || job.Actor != access.Current(ctx).Actor() {
		return access.ErrForbidden
	}

	// Register before checking source state. Lease redelivery must never run a
	// second executor while the first still owns its SFTP connection.
	ctx, cancel := context.WithCancel(ctx)
	s.stagingMu.Lock()
	if s.staging[job.ID] != nil {
		s.stagingMu.Unlock()
		cancel()
		return errors.New("transfer executor is still active")
	}
	if s.staging == nil {
		s.staging = make(map[uuid.UUID]context.CancelFunc)
	}
	s.staging[job.ID] = cancel
	s.stagingMu.Unlock()
	defer func() {
		cancel()
		s.stagingMu.Lock()
		delete(s.staging, job.ID)
		s.stagingMu.Unlock()
	}()

	// Read again after registration: cancellation or a prior worker may have
	// changed the record while this delivery was waiting.
	job, err = s.repo.GetByID(ctx, job.ID)
	if err != nil {
		return err
	}
	switch job.Status {
	case JobStatusCompleted, JobStatusFailed, JobStatusCancelled, JobStatusUnknown:
		return s.syncTaskRun(ctx, job.ID)
	case JobStatusRunning, JobStatusCanceling:
		return s.finishExecution(ctx, job, fmt.Errorf("%w: executor no longer owns an observed result; transfer was not replayed", sftputil.ErrMutationOutcomeUnknown), job.Stage)
	case JobStatusQueued:
	default:
		return fmt.Errorf("%w: transfer job is not queued", ErrInvalidJobRequest)
	}
	release, err := s.limiter.Acquire(ctx, true)
	if err != nil {
		return err
	}
	defer release()
	stage := JobStageTransferToRemote
	if job.Kind == JobKindSFTPDownload {
		stage = JobStageDownloadFromRemote
	}
	if job.Kind != JobKindSFTPUpload && job.Kind != JobKindSFTPDownload && job.Kind != JobKindSFTPTransfer {
		_, err := s.savePreparationFailure(ctx, job, errors.New("unsupported transfer kind"))
		return err
	}
	startedAt := time.Now().UTC()
	updated, err := s.repo.UpdateIfStatus(ctx, job.ID, []JobStatus{JobStatusQueued}, map[string]interface{}{
		"status": JobStatusRunning, "stage": stage, "started_at": &startedAt,
	})
	if err != nil {
		// This worker still owns the local execution slot and has not touched
		// SFTP. Preserve that known fact even if the running CAS committed but
		// its reply was lost; a retry must not invent an unknown remote effect.
		job.Stage, job.StartedAt = stage, &startedAt
		observed := observedOutcome(ctx, job, fmt.Errorf("transfer admission failed before remote I/O: %w", err), stage)
		_, saveErr := s.saveTerminal(ctx, observed, []JobStatus{JobStatusQueued, JobStatusRunning, JobStatusCanceling}, true)
		return saveErr
	}
	if !updated {
		return nil
	}
	job.Status, job.Stage, job.StartedAt = JobStatusRunning, stage, &startedAt
	job.BytesProcessed, job.Progress = 0, 0
	if err := s.syncTaskRun(ctx, job.ID); err != nil {
		return s.finishExecution(ctx, job, err, stage)
	}
	if job.Kind == JobKindSFTPUpload {
		return s.executeUpload(ctx, job)
	}
	if job.Kind == JobKindSFTPTransfer {
		return s.executeRelay(ctx, job)
	}
	return s.executeDownload(ctx, job)
}

func (s *service) executeUpload(ctx context.Context, job *TransferJob) error {
	finish := func(err error) error { return s.finishExecution(ctx, job, err, JobStageTransferToRemote) }
	if err := s.repo.CheckScheduledStage(ctx, job); err != nil {
		return finish(err)
	}
	if err := ctx.Err(); err != nil {
		return finish(err)
	}
	if job.TargetServerID == nil {
		return finish(errors.New("target server is required"))
	}
	if err := access.Current(ctx).CheckBytes(ctx, access.Requirement{Action: protocol.FilesUpload, ServerID: job.TargetServerID.String()}, job.ArtifactSize); err != nil {
		return finish(err)
	}
	file, err := os.Open(job.ArtifactPath)
	if err != nil {
		return finish(err)
	}
	defer file.Close()
	client, err := s.pool.Get(ctx, *job.TargetServerID, protocol.FilesUpload)
	if err != nil {
		return finish(err)
	}
	defer client.Release()
	if job.BytesTotal <= 0 {
		job.BytesTotal = job.ArtifactSize
	}
	startTime, lastProgress := time.Now(), time.Now()
	err = client.UploadFileWithProgressWithContext(ctx, file, job.TargetPath, func(loaded int64) {
		job.BytesProcessed = loaded
		job.Progress = transferProgress(loaded, job.BytesTotal)
		now := time.Now()
		if now.Sub(lastProgress) < 500*time.Millisecond && loaded < job.BytesTotal {
			return
		}
		s.updateProgress(ctx, job.ID, JobStageTransferToRemote, loaded, job.BytesTotal, startTime)
		lastProgress = now
	})
	// A successful commit wins a late cancellation; a lost commit reply is
	// unknown even when the local context was cancelled at the same time.
	return finish(err)
}

func (s *service) executeDownload(ctx context.Context, job *TransferJob) error {
	finish := func(err error) error {
		stage := JobStageDownloadFromRemote
		if err == nil {
			stage = JobStageReadyForDownload
		}
		return s.finishExecution(ctx, job, err, stage)
	}
	if err := ctx.Err(); err != nil {
		return finish(err)
	}
	if err := s.repo.CheckScheduledStage(ctx, job); err != nil {
		return finish(err)
	}
	if job.SourceServerID == nil {
		return finish(errors.New("source server is required"))
	}
	client, err := s.pool.Get(ctx, *job.SourceServerID, protocol.FilesDownload)
	if err != nil {
		return finish(err)
	}
	defer client.Release()
	return s.downloadToArtifact(ctx, job, client.Client, finish)
}

func transferProgress(loaded, total int64) int {
	if total <= 0 {
		return 0
	}
	return min(100, int(float64(loaded)/float64(total)*100))
}

func (s *service) stageReader(ctx context.Context, job *TransferJob, reader io.Reader, localPath string, reservation *storageReservation) error {
	if err := os.MkdirAll(filepath.Dir(localPath), 0750); err != nil {
		return err
	}
	file, err := os.OpenFile(localPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	start := time.Now()
	last := start
	writer := &stagingProgressWriter{writer: reservation.Writer(file), report: func(n int64) {
		job.BytesProcessed, job.Progress = n, transferProgress(n, job.BytesTotal)
		now := time.Now()
		if now.Sub(last) >= 500*time.Millisecond || n == job.BytesTotal {
			s.updateProgress(context.WithoutCancel(ctx), job.ID, JobStageStaging, n, job.BytesTotal, start)
			last = now
		}
	}}
	input := &ctxReader{ctx: ctx, reader: reader}
	_, err = io.CopyN(writer, input, job.BytesTotal)
	s.updateProgress(context.WithoutCancel(ctx), job.ID, JobStageStaging, writer.loaded, job.BytesTotal, start)
	if err != nil {
		return err
	}
	var extra [1]byte
	if n, err := io.ReadFull(input, extra[:]); n != 0 || err != io.EOF {
		return fmt.Errorf("%w: upload does not match declared file_size", ErrInvalidJobRequest)
	}
	if err := file.Sync(); err != nil {
		return err
	}
	return file.Close()
}

type stagingProgressWriter struct {
	writer io.Writer
	loaded int64
	report func(int64)
}

func (w *stagingProgressWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	w.loaded += int64(n)
	w.report(w.loaded)
	return n, err
}

func (s *service) updateProgress(ctx context.Context, id uuid.UUID, stage JobStage, loaded int64, total int64, start time.Time) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
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
	updated, err := s.repo.UpdateIfStatus(ctx, id, []JobStatus{
		JobStatusStaging,
		JobStatusQueued,
		JobStatusRunning,
		JobStatusCanceling,
	}, map[string]interface{}{
		"stage":           stage,
		"bytes_processed": loaded,
		"bytes_total":     total,
		"progress":        progress,
		"speed_bps":       speed,
	})
	if err == nil && updated {
		err = s.syncTaskRun(ctx, id)
	}
	if err != nil {
		log.Printf("[TransferJob] progress persistence failed: job=%s error=%v", id, err)
	}
}

func (s *service) config(ctx context.Context) (*systemconfig.SystemConfig, error) {
	if s.systemConfig == nil {
		return &systemconfig.SystemConfig{
			TransferRetentionDays:  systemconfig.DefaultTransferRetentionDays(),
			TransferMaxStorageGB:   systemconfig.DefaultTransferMaxStorageGB(),
			TransferMaxConcurrency: systemconfig.DefaultTransferMaxConcurrency(),
			TransferMaxEntries:     systemconfig.DefaultTransferMaxEntries(),
			TransferMaxDepth:       systemconfig.DefaultTransferMaxDepth(),
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
	dir := filepath.Join(root, job.ID.String(), group)
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
	return filepath.Join(s.storageRoot(cfg), job.ID.String())
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

func (s *service) cleanupExpired(ctx context.Context) {
	s.storageMu.RLock()
	defer s.storageMu.RUnlock()
	cfg, err := s.config(ctx)
	if err != nil || cfg == nil {
		return
	}
	jobs, err := s.repo.FindExpired(ctx, time.Now(), 100)
	if err != nil {
		fmt.Printf("[TransferJob] find expired jobs failed: %v\n", err)
		return
	}
	s.artifactMu.Lock()
	defer s.artifactMu.Unlock()
	for _, job := range jobs {
		if ctx.Err() != nil {
			return
		}
		current, err := s.repo.GetByID(ctx, job.ID)
		if err != nil {
			log.Printf("[TransferJob] reload cleanup candidate: %v", err)
			continue
		}
		if current.ArtifactCleanedAt != nil || current.ArtifactExpiresAt == nil || !current.ArtifactExpiresAt.Before(time.Now()) {
			continue
		}
		if current.Status != JobStatusCreated && current.Status != JobStatusCompleted && current.Status != JobStatusFailed && current.Status != JobStatusCancelled && current.Status != JobStatusUnknown {
			continue
		}
		job = current
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
			if err := os.RemoveAll(s.jobDir(cfg, job)); err != nil {
				log.Printf("[TransferJob] remove expired artifact: %v", err)
				continue
			}
		}
		now := time.Now().UTC()
		updates := map[string]interface{}{"artifact_cleaned_at": &now}
		if cfg.TransferCleanupEnabled && job.ArtifactManaged {
			updates["artifact_size"] = 0
			updates["artifact_path"] = ""
		}
		if job.Status == JobStatusCreated {
			updates["status"] = JobStatusCancelled
			updates["finished_at"] = &now
			updates["error_message"] = "staged artifact expired before execution"
		}
		if err := s.repo.Update(ctx, job.ID, updates); err != nil {
			fmt.Printf("[TransferJob] mark expired job failed: %v\n", err)
			continue
		}
	}
}

func (s *service) ensureTaskRun(ctx context.Context, job *TransferJob) error {
	if s.taskRuns == nil || job == nil || job.TaskRunID != nil || job.Status == JobStatusCreated || job.Status == JobStatusStaging {
		return nil
	}
	attached, err := s.repo.EnsureTaskRun(ctx, job.ID)
	if err != nil {
		return err
	}
	job.TaskRunID = attached.TaskRunID
	return nil
}

func (s *service) syncTaskRun(ctx context.Context, jobID uuid.UUID) error {
	if s.taskRuns == nil {
		return nil
	}
	job, err := s.repo.GetByID(ctx, jobID)
	if err != nil {
		return err
	}
	if err := s.ensureTaskRun(ctx, job); err != nil {
		log.Printf("[TransferJob] attach task run failed: job=%s error=%v", job.ID, err)
		return err
	}
	if job.TaskRunID == nil || *job.TaskRunID == uuid.Nil {
		return nil
	}
	resultJSON, _ := json.Marshal(map[string]interface{}{
		"job_id": job.ID, "kind": job.Kind, "source_path": job.SourcePath, "target_path": job.TargetPath,
		"result_path": job.ResultPath, "bytes_processed": job.BytesProcessed, "bytes_completed": job.BytesCompleted,
		"files_total": job.FilesTotal, "files_completed": job.FilesCompleted,
	})
	successCount := job.FilesCompleted
	progressJSON, _ := json.Marshal(map[string]interface{}{
		"bytes_total":     job.BytesTotal,
		"bytes_processed": job.BytesProcessed,
		"speed_bps":       job.SpeedBps,
		"bytes_completed": job.BytesCompleted,
		"files_total":     job.FilesTotal,
		"files_completed": job.FilesCompleted,
		"result_path":     job.ResultPath,
	})
	if job.Status == JobStatusCompleted || job.Status == JobStatusFailed || job.Status == JobStatusCancelled || job.Status == JobStatusUnknown {
		if err := s.taskRuns.UpdateProgress(ctx, *job.TaskRunID, job.Progress, string(job.Stage), string(progressJSON), job.FilesCompleted, 0); err != nil {
			return err
		}
	}
	switch job.Status {
	case JobStatusCanceling:
		if err := s.taskRuns.MarkTransferCanceling(ctx, *job.TaskRunID); err != nil {
			return err
		}
		return s.taskRuns.UpdateProgress(ctx, *job.TaskRunID, job.Progress, string(job.Stage), string(progressJSON), job.FilesCompleted, 0)
	case JobStatusRunning:
		if err := s.taskRuns.Start(ctx, *job.TaskRunID, string(job.Stage)); err != nil {
			return err
		}
		return s.taskRuns.UpdateProgress(ctx, *job.TaskRunID, job.Progress, string(job.Stage), string(progressJSON), job.FilesCompleted, 0)
	case JobStatusQueued, JobStatusStaging:
		return s.taskRuns.UpdateProgress(ctx, *job.TaskRunID, job.Progress, string(job.Stage), string(progressJSON), job.FilesCompleted, 0)
	case JobStatusCompleted:
		return s.taskRuns.CompleteTransfer(ctx, *job.TaskRunID, taskcenter.StatusSucceeded, string(resultJSON), "", "", successCount, 0)
	case JobStatusFailed:
		return s.taskRuns.CompleteTransfer(ctx, *job.TaskRunID, taskcenter.StatusFailed, string(resultJSON), "transfer_failed", job.ErrorMessage, successCount, 1)
	case JobStatusUnknown:
		return s.taskRuns.CompleteTransfer(ctx, *job.TaskRunID, taskcenter.StatusUnknown, string(resultJSON), "transfer_outcome_unknown", job.ErrorMessage, successCount, 0)
	case JobStatusCancelled:
		return s.taskRuns.CompleteTransfer(ctx, *job.TaskRunID, taskcenter.StatusCanceled, string(resultJSON), "", job.ErrorMessage, successCount, 0)
	}
	return nil
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
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
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

// A native database snapshot is consistent by itself. Hold local artifacts stable
// for the entire database + files snapshot so cleanup cannot delete referenced files.
func (s *service) SnapshotStorage(fn func() error) error {
	_, done, err := s.beginOperation(context.Background())
	if err != nil {
		return err
	}
	defer done()
	if !s.storageMu.TryLock() {
		return errors.New("file transfers or cleanup are active; retry backup when they finish")
	}
	defer s.storageMu.Unlock()
	return fn()
}
func (s *service) RejectQueueJob(ctx context.Context, queued *jobqueue.Job, reason error) error {
	ctx, finishOperation, admissionErr := s.beginOperation(ctx)
	if admissionErr != nil {
		return admissionErr
	}
	defer finishOperation()

	var payload struct {
		JobID uuid.UUID `json:"job_id"`
	}
	if err := json.Unmarshal([]byte(queued.PayloadJSON), &payload); err != nil {
		return err
	}
	job, err := s.repo.GetByID(ctx, payload.JobID)
	if err != nil {
		return err
	}
	_, err = s.savePreparationFailure(ctx, job, reason)
	return err
}

func (s *service) ArtifactRequirements(ctx context.Context, scope access.Scope, ref string) ([]access.Requirement, error) {
	id, err := uuid.Parse(ref)
	if err != nil {
		return nil, ErrInvalidJobRequest
	}
	job, _, err := s.GetArtifact(access.WithScope(ctx, scope), id)
	if err != nil {
		return nil, err
	}
	serverID := job.SourceServerID
	if serverID == nil {
		serverID = job.TargetServerID
	}
	if serverID == nil {
		return nil, ErrInvalidJobRequest
	}
	req := access.Requirement{Action: protocol.FilesDownload, ServerID: serverID.String()}
	if err := scope.Check(ctx, req); err != nil {
		return nil, err
	}
	return []access.Requirement{req}, nil
}
