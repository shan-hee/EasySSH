package transferjob

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path"
	"strings"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/sftputil"
	"github.com/google/uuid"
	"github.com/pkg/sftp"
)

func (s *service) CreateRelayJob(ctx context.Context, req *protocol.TransferRelayInput) (*TransferJob, error) {
	ctx, done, err := s.beginOperation(ctx)
	if err != nil {
		return nil, err
	}
	defer done()
	if req == nil || !validRelayPath(req.SourcePath) || !validRelayPath(req.TargetPath) || path.Clean(req.SourcePath) == "/" || len(path.Base(req.SourcePath)) > 255 || len([]rune(strings.TrimSpace(req.Name))) > 160 {
		return nil, ErrInvalidJobRequest
	}
	sourceID, err := uuid.Parse(req.SourceServerID)
	if err != nil || sourceID == uuid.Nil {
		return nil, ErrInvalidJobRequest
	}
	targetID, err := uuid.Parse(req.TargetServerID)
	if err != nil || targetID == uuid.Nil || targetID == sourceID {
		return nil, ErrInvalidJobRequest
	}
	scope := access.Current(ctx)
	for _, requirement := range []access.Requirement{
		{Action: protocol.FilesDownload, ServerID: sourceID.String()},
		{Action: protocol.FilesUpload, ServerID: targetID.String()},
	} {
		if err := scope.CheckBytes(ctx, requirement, 0); err != nil {
			return nil, err
		}
		id := uuid.MustParse(requirement.ServerID)
		if _, err := s.serverService.GetByID(ctx, scope, id); err != nil {
			return nil, err
		}
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		label := []rune("中转 " + path.Base(req.SourcePath))
		name = string(label[:min(len(label), 160)])
	}
	return s.saveAdmission(ctx, &TransferJob{
		Actor: scope.Actor(), Name: name, Kind: JobKindSFTPTransfer, Runner: "server",
		Status: JobStatusQueued, Stage: JobStageTransferToRemote,
		SourceServerID: &sourceID, TargetServerID: &targetID,
		SourcePath: path.Clean(req.SourcePath), TargetPath: path.Clean(req.TargetPath),
		FileName: path.Base(req.SourcePath), Description: req.Description,
	})
}

func validRelayPath(value string) bool {
	return path.IsAbs(value) && len(value) <= 4096 && !strings.ContainsAny(value, "\\\x00")
}

type relaySource interface {
	Lstat(string) (os.FileInfo, error)
	ReadDir(string) ([]os.FileInfo, error)
}

type relayFile struct {
	source, relative string
	info             os.FileInfo
}
type relayPlan struct {
	files       []relayFile
	directories []string
	bytes       int64
}

// Keep the existing relay's single enumeration, bounded by the same transfer
// entry/depth settings as downloads. Symlinks and special files are not followed.
func planRelay(ctx context.Context, source relaySource, sourcePath string, cfg *systemconfig.SystemConfig) (relayPlan, error) {
	var plan relayPlan
	visited := 0
	var visit func(string, string, int) error
	visit = func(from, relative string, depth int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		visited++
		if visited > cfg.TransferMaxEntries || depth > cfg.TransferMaxDepth {
			return fmt.Errorf("relay entry or nesting limit exceeded")
		}
		info, err := source.Lstat(from)
		if err != nil {
			return err
		}
		if info.IsDir() {
			plan.directories = append(plan.directories, relative)
			entries, err := source.ReadDir(from)
			if err != nil {
				return err
			}
			seen := make(map[string]bool)
			for _, entry := range entries {
				if entry == nil {
					return fmt.Errorf("invalid remote directory entry")
				}
				name := entry.Name()
				if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00") || seen[name] {
					return fmt.Errorf("invalid remote directory entry")
				}
				seen[name] = true
				if err := visit(path.Join(from, name), path.Join(relative, name), depth+1); err != nil {
					return err
				}
			}
			return nil
		}
		if !info.Mode().IsRegular() || info.Size() < 0 || plan.bytes > math.MaxInt64-info.Size() {
			return fmt.Errorf("relay requires regular files with valid sizes: %s", from)
		}
		plan.files = append(plan.files, relayFile{source: from, relative: relative, info: info})
		plan.bytes += info.Size()
		return nil
	}
	err := visit(sourcePath, "", 0)
	return plan, err
}

func relayDestination(ctx context.Context, target relaySource, directory, name string, limit int) (string, error) {
	for suffix := 1; suffix <= limit; suffix++ {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		candidate := name
		if suffix > 1 {
			ext := path.Ext(name)
			if ext == name {
				ext = ""
			}
			candidate = fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(name, ext), suffix, ext)
		}
		if len(candidate) > 255 || len(path.Join(directory, candidate)) > 4096 {
			return "", fmt.Errorf("relay destination name is too long")
		}
		candidate = path.Join(directory, candidate)
		if _, err := target.Lstat(candidate); os.IsNotExist(err) {
			return candidate, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("relay destination conflict limit exceeded")
}

func (s *service) executeRelay(ctx context.Context, job *TransferJob) error {
	finish := func(err error) error { return s.finishExecution(ctx, job, err, JobStageTransferToRemote) }
	if job.SourceServerID == nil || job.TargetServerID == nil {
		return finish(ErrInvalidJobRequest)
	}
	readReq := access.Requirement{Action: protocol.FilesDownload, ServerID: job.SourceServerID.String()}
	writeReq := access.Requirement{Action: protocol.FilesUpload, ServerID: job.TargetServerID.String()}
	lease, err := access.Current(ctx).OpenWork(ctx, access.Task, readReq, writeReq)
	if err != nil {
		return finish(err)
	}
	defer lease.Close(nil)
	ctx = lease.Context()
	source, err := s.pool.Get(ctx, *job.SourceServerID, protocol.FilesDownload)
	if err != nil {
		return finish(err)
	}
	defer source.Release()
	target, err := s.pool.Get(ctx, *job.TargetServerID, protocol.FilesUpload)
	if err != nil {
		return finish(err)
	}
	defer target.Release()
	cfg, err := s.config(ctx)
	if err != nil {
		return finish(err)
	}
	plan, err := planRelay(ctx, source.RawClient(), job.SourcePath, cfg)
	if err != nil {
		return finish(err)
	}
	job.BytesTotal, job.FilesTotal = plan.bytes, len(plan.files)
	for _, req := range []access.Requirement{readReq, writeReq} {
		if err := access.Current(ctx).CheckBytes(ctx, req, plan.bytes); err != nil {
			return finish(err)
		}
	}
	// target_path is always an existing destination directory, never a path to
	// overwrite. Choose a new root once so child names keep their relationships.
	parent, err := target.RawClient().Lstat(job.TargetPath)
	if err != nil {
		return finish(err)
	}
	if !parent.IsDir() {
		return finish(fmt.Errorf("relay target_path must be a directory"))
	}
	job.ResultPath, err = relayDestination(ctx, target.RawClient(), job.TargetPath, job.FileName, cfg.TransferMaxEntries)
	if err != nil {
		return finish(err)
	}
	// Save the selected destination before any remote mutation. Restart recovery
	// can point to partial output without guessing or replaying the copy.
	changed, err := s.repo.UpdateIfStatus(ctx, job.ID, []JobStatus{JobStatusRunning}, map[string]interface{}{
		"result_path": job.ResultPath, "bytes_total": job.BytesTotal, "files_total": job.FilesTotal,
	})
	if err != nil {
		return finish(err)
	}
	if !changed {
		return finish(context.Canceled)
	}
	progress := s.newTreeProgress(ctx, job)
	for _, directory := range plan.directories {
		if err := access.Current(ctx).Check(ctx, writeReq); err != nil {
			return finish(err)
		}
		if err := target.RawClient().Mkdir(path.Join(job.ResultPath, directory)); err != nil {
			return finish(sftputil.MutationError(err))
		}
	}
	for _, file := range plan.files {
		if err := ctx.Err(); err != nil {
			return finish(err)
		}
		err := copyRelayFile(ctx, source.RawClient(), target.RawClient(), file, path.Join(job.ResultPath, file.relative), readReq, writeReq, func(n int) { job.BytesProcessed += int64(n); progress.publish(false) })
		if err != nil {
			return finish(err)
		}
		job.BytesCompleted += file.info.Size()
		job.FilesCompleted++
		progress.publish(true)
	}
	return finish(nil)
}

type relayProgressWriter struct {
	writer   io.Writer
	progress func(int)
}

func (w relayProgressWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	if n > 0 {
		w.progress(n)
	}
	return n, err
}

// Commit complete files without replacing an existing destination. Prefer an
// atomic hard link when the server supports it; plain SFTP v3 rename must also
// refuse existing destinations (unlike the posix-rename extension).
func copyRelayFile(ctx context.Context, source, target *sftp.Client, file relayFile, destination string, readReq, writeReq access.Requirement, progress func(int)) error {
	for _, req := range []access.Requirement{readReq, writeReq} {
		if err := access.Current(ctx).Check(ctx, req); err != nil {
			return err
		}
	}
	input, err := source.Open(file.source)
	if err != nil {
		return err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != file.info.Size() || !info.ModTime().Equal(file.info.ModTime()) {
		return fmt.Errorf("relay source changed after enumeration")
	}
	temporary := path.Join(path.Dir(destination), ".easyssh-transfer-"+uuid.NewString())
	output, err := target.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return sftputil.MutationError(err)
	}
	defer func() {
		_ = output.Close()
		_ = target.Remove(temporary)
	}()
	if err := target.Chmod(temporary, 0600); err != nil {
		return err
	}
	reader, finishRead := access.MeterReader(ctx, readReq, input)
	defer finishRead()
	metered, finishWrite := access.MeterWriter(ctx, writeReq, output)
	defer finishWrite()
	_, err = io.CopyN(relayProgressWriter{metered, progress}, reader, info.Size())
	err = errors.Join(err, finishRead(), finishWrite())
	if err != nil {
		return err
	}
	after, err := input.Stat()
	if err != nil {
		return err
	}
	if after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return fmt.Errorf("relay source changed during transfer")
	}
	if err := output.Chmod(info.Mode().Perm()); err != nil {
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	if err := access.Current(ctx).Check(ctx, writeReq); err != nil {
		return err
	}
	if _, supported := target.HasExtension("hardlink@openssh.com"); supported {
		return sftputil.MutationError(target.Link(temporary, destination))
	}
	// Catch a name occupied since enumeration, including on servers whose plain
	// rename implementation incorrectly uses overwrite semantics.
	if _, err := target.Lstat(destination); err == nil {
		return os.ErrExist
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := target.Rename(temporary, destination); err != nil {
		return sftputil.MutationError(err)
	}
	return nil
}
