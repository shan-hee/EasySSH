package transferjob

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path"
	"strings"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/sftp"
	"github.com/easyssh/server/internal/domain/systemconfig"
	"github.com/easyssh/shared/protocol"
)

// Selection is immutable execution input in transfer_jobs.detail_json. It does
// not contain a directory snapshot or the archive body.
type downloadSelection struct {
	Paths           []string `json:"paths"`
	ExcludePatterns []string `json:"exclude_patterns,omitempty"`
	Archive         bool     `json:"archive"`
}

func normalizeDownloadSelection(req *CreateDownloadRequest, cfg *systemconfig.SystemConfig) (downloadSelection, error) {
	if req.RetentionDays < 0 || req.RetentionDays > 30 {
		return downloadSelection{}, fmt.Errorf("%w: retention_days must be between 0 and 30", ErrInvalidJobRequest)
	}
	patterns := req.ExcludePatterns
	if patterns == nil {
		patterns = strings.Fields(cfg.DownloadExcludePatterns)
	}
	selection := downloadSelection{Paths: append([]string(nil), req.SourcePaths...), ExcludePatterns: append([]string(nil), patterns...), Archive: len(req.SourcePaths) != 0}
	if req.SourcePath != "" {
		if len(selection.Paths) != 0 {
			return selection, fmt.Errorf("%w: provide source_path or source_paths, not both", ErrInvalidJobRequest)
		}
		selection.Paths = []string{req.SourcePath}
	}
	if len(selection.Paths) == 0 || len(selection.Paths) > min(100, cfg.TransferMaxEntries) || len(selection.ExcludePatterns) > 100 {
		return selection, fmt.Errorf("%w: invalid download selection size", ErrInvalidJobRequest)
	}
	seen := make(map[string]bool)
	for i, remote := range selection.Paths {
		if !path.IsAbs(remote) || strings.ContainsAny(remote, "\x00\\") || len(remote) > 4096 {
			return selection, fmt.Errorf("%w: download paths must be absolute", ErrInvalidJobRequest)
		}
		remote = path.Clean(remote)
		if remote == "/" || seen[remote] {
			return selection, fmt.Errorf("%w: filesystem root and duplicate paths are not supported", ErrInvalidJobRequest)
		}
		seen[remote], selection.Paths[i] = true, remote
	}
	for _, pattern := range selection.ExcludePatterns {
		if pattern == "" || len(pattern) > 255 || strings.ContainsAny(pattern, "/\x00\\") {
			return selection, fmt.Errorf("%w: exclusions must match entry names", ErrInvalidJobRequest)
		}
		if _, err := path.Match(pattern, ""); err != nil {
			return selection, fmt.Errorf("%w: invalid exclusion pattern", ErrInvalidJobRequest)
		}
	}
	return selection, nil
}

type downloadSource interface {
	GetFileInfo(string) (*sftp.FileInfo, error)
	ListDirectory(string) (*sftp.DirectoryListing, error)
	DownloadFileToArtifactWithContext(context.Context, string, io.Writer, func(int64)) error
}

type downloadEntry struct {
	remote string
	name   string
	info   sftp.FileInfo
}

type downloadPlan struct {
	entries      []downloadEntry
	archive      bool
	bytes        int64
	storageBytes int64
}

// Enumeration happens once, before creating an artifact. Limits apply to every
// visited entry, including exclusions, so a mostly excluded tree is bounded too.
func planDownload(ctx context.Context, source downloadSource, selection downloadSelection, cfg *systemconfig.SystemConfig) (downloadPlan, error) {
	plan := downloadPlan{archive: selection.Archive}
	visited := 0
	limit := int64(cfg.TransferMaxStorageGB) << 30
	var visit func(string, string, int) error
	visit = func(remote, name string, depth int) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		visited++
		if visited > cfg.TransferMaxEntries || depth > cfg.TransferMaxDepth {
			return fmt.Errorf("download entry or nesting limit exceeded")
		}
		// A directly requested source_path is always included. Exclusions apply
		// to its children and to entries selected for a batch archive.
		if depth > 0 || selection.Archive {
			for _, pattern := range selection.ExcludePatterns {
				if matched, _ := path.Match(pattern, path.Base(remote)); matched {
					return nil
				}
			}
		}
		info, err := source.GetFileInfo(remote)
		if err != nil {
			return err
		}
		if info.IsLink || !info.IsDir && !info.Mode.IsRegular() || info.Size < 0 {
			return fmt.Errorf("download requires regular files and directories: %s", remote)
		}
		if len(name) > 65534 {
			return fmt.Errorf("archive entry name is too long")
		}
		plan.entries = append(plan.entries, downloadEntry{remote: remote, name: name, info: *info})
		// ZIP Store has no compression expansion. Reserve both names, headers,
		// timestamps and ZIP64 overhead as well as the source payload.
		plan.archive = plan.archive || info.IsDir
		var entryBytes int64
		if plan.archive {
			entryBytes = int64(2*len(name) + 256)
		}
		if !info.IsDir {
			if info.Size > limit || plan.bytes > limit-info.Size {
				return fmt.Errorf("transfer storage quota exceeded")
			}
			plan.bytes += info.Size
			entryBytes += info.Size
		}
		if entryBytes > limit || plan.storageBytes > limit-entryBytes {
			return fmt.Errorf("transfer storage quota exceeded")
		}
		plan.storageBytes += entryBytes
		if !info.IsDir {
			return nil
		}
		plan.archive = true
		listing, err := source.ListDirectory(remote)
		if err != nil {
			return err
		}
		seen := make(map[string]bool)
		for _, child := range listing.Files {
			if child == nil || child.Name == "" || child.Name == "." || child.Name == ".." || strings.ContainsAny(child.Name, "/\\\x00") || seen[child.Name] {
				return fmt.Errorf("invalid remote directory entry")
			}
			seen[child.Name] = true
			if err := visit(path.Join(remote, child.Name), path.Join(name, child.Name), depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	names := make(map[string]bool)
	for _, remote := range selection.Paths {
		name := uniqueDownloadName(path.Base(remote), names)
		if err := visit(remote, name, 0); err != nil {
			return plan, err
		}
	}
	if len(plan.entries) == 0 {
		return plan, fmt.Errorf("download selection contains no included entries")
	}
	if plan.archive {
		if plan.storageBytes > limit-128 {
			return plan, fmt.Errorf("transfer storage quota exceeded")
		}
		plan.storageBytes += 128 // End of central directory, including ZIP64.
	} else {
		plan.storageBytes = plan.bytes
	}
	return plan, nil
}

func uniqueDownloadName(name string, used map[string]bool) string {
	candidate := name
	for suffix := 2; used[candidate]; suffix++ {
		ext := path.Ext(name)
		if ext == name {
			ext = ""
		}
		candidate = fmt.Sprintf("%s (%d)%s", strings.TrimSuffix(name, ext), suffix, ext)
	}
	used[candidate] = true
	return candidate
}

func (s *service) downloadToArtifact(ctx context.Context, job *TransferJob, source downloadSource, finish func(error) error) error {
	var selection downloadSelection
	if err := json.Unmarshal([]byte(job.DetailJSON), &selection); err != nil {
		return finish(fmt.Errorf("invalid persisted download selection: %w", err))
	}
	cfg, err := s.config(ctx)
	if err != nil {
		return finish(err)
	}
	plan, err := planDownload(ctx, source, selection, cfg)
	if err != nil {
		return finish(err)
	}
	if err := access.Current(ctx).CheckBytes(ctx, access.Requirement{Action: protocol.FilesDownload, ServerID: job.SourceServerID.String()}, plan.bytes); err != nil {
		return finish(err)
	}
	reservation, err := s.reserveStorage(cfg, plan.storageBytes, false)
	if err != nil {
		return finish(err)
	}
	defer reservation.Close()
	artifactName := job.FileName
	if plan.archive {
		artifactName = "files.zip"
		if len(selection.Paths) == 1 {
			base := path.Base(selection.Paths[0])
			if len(base) <= 251 {
				artifactName = base + ".zip"
			}
		}
	}
	localPath, err := s.artifactPath(ctx, cfg, job, "download", artifactName)
	if err != nil {
		return finish(err)
	}
	file, err := os.OpenFile(localPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return finish(err)
	}
	keep := false
	defer func() {
		_ = file.Close()
		if !keep {
			if err := os.Remove(localPath); err != nil && !errors.Is(err, os.ErrNotExist) {
				log.Printf("[TransferJob] remove partial artifact: job=%s error=%v", job.ID, err)
			}
		}
	}()
	job.BytesTotal = plan.bytes
	for _, entry := range plan.entries {
		if !entry.info.IsDir {
			job.FilesTotal++
		}
	}
	startTime, lastProgress := time.Now(), time.Time{}
	err = writeDownload(ctx, source, plan, reservation.Writer(file), func(loaded int64) {
		job.BytesProcessed = loaded
		job.Progress = transferProgress(loaded, job.BytesTotal)
		now := time.Now()
		if now.Sub(lastProgress) >= 500*time.Millisecond {
			s.updateProgress(ctx, job.ID, JobStageDownloadFromRemote, loaded, job.BytesTotal, startTime)
			lastProgress = now
		}
	})
	if err != nil {
		return finish(err)
	}
	written, err := file.Stat()
	if err != nil {
		return finish(err)
	}
	if err := file.Sync(); err != nil {
		return finish(err)
	}
	if err := file.Close(); err != nil {
		return finish(err)
	}
	job.ArtifactPath, job.ArtifactName, job.ArtifactSize = localPath, artifactName, written.Size()
	keep = true
	return finish(nil)
}

// A partial ZIP is never finalized or published. Progress reports bytes copied
// from sources; artifact size separately includes the archive headers.
func writeDownload(ctx context.Context, source downloadSource, plan downloadPlan, output io.Writer, progress func(int64)) error {
	var archive *zip.Writer
	if plan.archive {
		archive = zip.NewWriter(output)
	}
	var transferred int64
	for _, entry := range plan.entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		writer := output
		if archive != nil {
			name := entry.name
			if entry.info.IsDir {
				name += "/"
			}
			header := &zip.FileHeader{Name: name, Method: zip.Store}
			header.SetMode(entry.info.Mode)
			header.SetModTime(entry.info.ModTime)
			var err error
			writer, err = archive.CreateHeader(header)
			if err != nil {
				return err
			}
		}
		if entry.info.IsDir {
			continue
		}
		var copied int64
		err := source.DownloadFileToArtifactWithContext(ctx, entry.remote, writer, func(loaded int64) {
			copied = loaded
			progress(transferred + copied)
		})
		if err != nil {
			return err
		}
		if copied != entry.info.Size {
			return fmt.Errorf("download size changed during transfer: %s", entry.remote)
		}
		transferred += copied
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if archive != nil {
		return archive.Close()
	}
	return nil
}
