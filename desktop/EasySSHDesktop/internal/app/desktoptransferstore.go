package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

// Transfer-specific intent shares the task transaction. Status, metrics and
// completion stay in desktop_task_runs; this table does not run another state
// machine. Native paths are local-owner data and never enter remote receipts.
type desktopTransferIntent struct {
	Kind            desktopSFTPTaskKind
	FileName        string
	SourceServerID  string
	TargetServerID  string
	ExcludePatterns []string
	Archive         bool
	SourcePaths     []string
	TargetPath      string
	ResultPath      string
}

func (i desktopTransferIntent) validate() error {
	if i.FileName == "" || strings.ContainsAny(i.FileName, "/\\\x00") || len(i.FileName) > 255 || len(i.SourcePaths) == 0 || len(i.SourcePaths) > 100000 {
		return errors.New("invalid transfer selection")
	}
	for _, p := range i.SourcePaths {
		if p == "" || strings.ContainsRune(p, 0) {
			return errors.New("invalid transfer source")
		}
	}
	if i.TargetPath == "" || strings.ContainsRune(i.TargetPath, 0) {
		return errors.New("transfer target required")
	}
	switch i.Kind {
	case desktopSFTPTaskUpload:
		if i.SourceServerID != "" || i.TargetServerID == "" || !path.IsAbs(i.TargetPath) {
			return errors.New("invalid upload endpoints")
		}
	case desktopSFTPTaskDownload:
		if i.SourceServerID == "" || i.TargetServerID != "" || !filepath.IsAbs(i.TargetPath) {
			return errors.New("invalid download endpoints")
		}
	case desktopSFTPTaskTransfer:
		if i.SourceServerID == "" || i.TargetServerID == "" || i.SourceServerID == i.TargetServerID || !path.IsAbs(i.TargetPath) {
			return errors.New("invalid relay endpoints")
		}
	default:
		return errors.New("unsupported transfer kind")
	}
	if i.Kind != desktopSFTPTaskUpload {
		if _, err := normalizeDesktopTransferSelection(i.SourcePaths, i.ExcludePatterns, i.Archive); err != nil {
			return err
		}
	} else if len(i.SourcePaths) != 1 || i.Archive || len(i.ExcludePatterns) != 0 {
		return errors.New("invalid upload selection")
	}
	if i.SourceServerID != "" {
		for _, p := range i.SourcePaths {
			if !path.IsAbs(p) {
				return errors.New("remote source must be absolute")
			}
		}
	}
	for _, id := range []string{i.SourceServerID, i.TargetServerID} {
		if id != "" {
			if parsed, err := uuid.Parse(id); err != nil || parsed == uuid.Nil {
				return errors.New("invalid transfer server")
			}
		}
	}
	return nil
}

func insertDesktopTransfer(tx *sql.Tx, id string, intent desktopTransferIntent) error {
	if err := intent.validate(); err != nil {
		return err
	}
	paths, err := json.Marshal(desktopTransferSelection{Paths: intent.SourcePaths, ExcludePatterns: intent.ExcludePatterns, Archive: intent.Archive})
	if err != nil {
		return err
	}
	if len(paths) > 512<<10 {
		return errors.New("transfer selection is too large")
	}
	_, err = tx.Exec(`INSERT INTO transfer_jobs(id,kind,file_name,source_server_id,target_server_id,selection_json,target_path,result_path) VALUES(?,?,?,?,?,?,?,?)`, id, string(intent.Kind), intent.FileName, intent.SourceServerID, intent.TargetServerID, string(paths), intent.TargetPath, intent.ResultPath)
	return err
}

func (s *DesktopSFTPService) createTransferTask(ctx context.Context, id string, size int64, intent desktopTransferIntent) (string, error) {
	if err := intent.validate(); err != nil {
		return "", err
	}
	if size < 0 {
		return "", errors.New("invalid transfer size")
	}
	serverID, remote := intent.SourceServerID, strings.Join(intent.SourcePaths, ", ")
	if intent.Kind == desktopSFTPTaskUpload {
		serverID, remote = intent.TargetServerID, intent.TargetPath
	}
	var resources []activitystats.Resource
	for _, id := range []string{intent.SourceServerID, intent.TargetServerID} {
		if id != "" {
			resources = append(resources, activitystats.Resource{ServerID: id})
		}
	}
	return s.createTaskWithIntent(ctx, intent.Kind, id, intent.FileName, size, serverID, remote, "", 1, &intent, resources...)
}

// List/Get read committed rows, including after runtime handles are pruned or
// after restart. Sharing windows cannot invoke this owner's native service.
func (s *DesktopSFTPService) ListTransfers(input protocol.TransferListInput) (protocol.TransferJobList, error) {
	var result protocol.TransferJobList
	if s.taskCenter == nil {
		return result, errors.New("task center unavailable")
	}
	if input.Kind != "" && input.Kind != "sftp_upload" && input.Kind != "sftp_download" && input.Kind != "sftp_transfer" {
		return result, errors.New("invalid transfer kind")
	}
	if input.Page > 1000000 {
		return result, errors.New("page out of range")
	}
	if input.Page < 1 {
		input.Page = 1
	}
	if input.PageSize < 1 {
		input.PageSize = 20
	}
	if input.PageSize > 100 {
		input.PageSize = 100
	}
	db, err := s.taskCenter.database()
	if err != nil {
		return result, err
	}
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	where, args := "", []any{}
	if input.Kind != "" {
		where = " WHERE kind=?"
		args = append(args, strings.TrimPrefix(input.Kind, "sftp_"))
	}
	if err := tx.QueryRow("SELECT COUNT(*) FROM transfer_jobs"+where, args...).Scan(&result.Total); err != nil {
		return result, err
	}
	result.Page, result.PageSize = input.Page, input.PageSize
	result.TotalPages = int((result.Total + int64(input.PageSize) - 1) / int64(input.PageSize))
	result.Jobs = make([]protocol.TransferJob, 0)
	rows, err := tx.Query("SELECT transfer_jobs.id FROM transfer_jobs JOIN desktop_task_runs r ON r.id=transfer_jobs.id"+where+" ORDER BY r.created_at DESC,transfer_jobs.id DESC LIMIT ? OFFSET ?", append(args, input.PageSize, (input.Page-1)*input.PageSize)...)
	if err != nil {
		return result, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return result, err
		}
		ids = append(ids, id)
	}
	readErr := rows.Err()
	closeErr := rows.Close()
	if err := errors.Join(readErr, closeErr); err != nil {
		return result, err
	}
	for _, id := range ids {
		job, err := readDesktopTransfer(tx, id, false)
		if err != nil {
			return result, err
		}
		result.Jobs = append(result.Jobs, job)
	}
	return result, tx.Commit()
}

func (s *DesktopSFTPService) GetTransfer(id string) (protocol.TransferJob, error) {
	if s.taskCenter == nil {
		return protocol.TransferJob{}, errors.New("task center unavailable")
	}
	if parsed, err := uuid.Parse(id); err != nil || parsed == uuid.Nil {
		return protocol.TransferJob{}, errors.New("invalid transfer ID")
	}
	db, err := s.taskCenter.database()
	if err != nil {
		return protocol.TransferJob{}, err
	}
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return protocol.TransferJob{}, err
	}
	defer tx.Rollback()
	job, err := readDesktopTransfer(tx, id, true)
	if err != nil {
		return job, err
	}
	return job, tx.Commit()
}

func readDesktopTransfer(tx *sql.Tx, id string, includeSelection bool) (protocol.TransferJob, error) {
	var intent desktopTransferIntent
	var paths string
	var job protocol.TransferJob
	if err := tx.QueryRow(`SELECT kind,file_name,source_server_id,target_server_id,selection_json,target_path,result_path FROM transfer_jobs WHERE id=?`, id).Scan(&intent.Kind, &intent.FileName, &intent.SourceServerID, &intent.TargetServerID, &paths, &intent.TargetPath, &intent.ResultPath); err != nil {
		return job, err
	}
	var selection desktopTransferSelection
	if err := json.Unmarshal([]byte(paths), &selection); err != nil {
		return job, err
	}
	intent.SourcePaths = selection.Paths
	run, err := scanDesktopTaskRun(tx.QueryRow(desktopTaskSelectSQL+" WHERE id=?", id))
	if err != nil {
		return job, err
	}
	if run.SourceType != "transfer_job" || run.SourceID != id || run.TaskType != desktopSFTPTaskCenterType(intent.Kind) || len(intent.SourcePaths) == 0 {
		return job, errors.New("invalid transfer source relationship")
	}
	created, err := time.Parse(time.RFC3339Nano, run.CreatedAt)
	if err != nil {
		return job, err
	}
	updated, err := time.Parse(time.RFC3339Nano, run.UpdatedAt)
	if err != nil {
		return job, err
	}
	job = protocol.TransferJob{ID: uuid.MustParse(id), Actor: run.Actor, Name: run.Title, Kind: protocol.TransferJobKind(run.TaskType), Runner: "desktop", Status: protocol.TransferJobStatus(run.Status), Stage: "transfer_to_remote", SourcePath: intent.SourcePaths[0], TargetPath: intent.TargetPath, ResultPath: intent.ResultPath, FileName: intent.FileName, BytesTotal: run.BytesTotal, BytesProcessed: run.BytesProcessed, BytesCompleted: run.BytesCompleted, FilesTotal: run.TotalCount, FilesCompleted: run.SuccessCount, Progress: int64(run.Progress), CreatedAt: created, UpdatedAt: updated}
	job.TaskRunID = &job.ID
	if intent.Kind == desktopSFTPTaskDownload {
		job.Stage = "download_from_remote"
	}
	switch run.Status {
	case "succeeded":
		job.Status = "completed"
	case "canceled":
		job.Status = "cancelled"
	case "partial_success", "timeout":
		job.Status = "failed"
	}
	if run.ErrorMessage != "" {
		job.ErrorMessage = &run.ErrorMessage
	}
	if intent.SourceServerID != "" {
		id, err := uuid.Parse(intent.SourceServerID)
		if err != nil {
			return job, err
		}
		job.SourceServerID = &id
	}
	if intent.TargetServerID != "" {
		id, err := uuid.Parse(intent.TargetServerID)
		if err != nil {
			return job, err
		}
		job.TargetServerID = &id
	}
	if run.StartedAt != "" {
		v, err := time.Parse(time.RFC3339Nano, run.StartedAt)
		if err != nil {
			return job, err
		}
		job.StartedAt = &v
	}
	if run.FinishedAt != "" {
		v, err := time.Parse(time.RFC3339Nano, run.FinishedAt)
		if err != nil {
			return job, err
		}
		job.FinishedAt = &v
	}
	// Selection is small metadata, not task output; batch paths remain recoverable.
	if includeSelection {
		detail, _ := json.Marshal(selection)
		encoded := string(detail)
		job.DetailJSON = &encoded
	}
	return job, nil
}

// This is committed before any relay mutation, so recovery can identify partial
// output. It deliberately does not reopen files or retry a remote operation.
func (s *DesktopSFTPService) prepareTransferDestination(id, destination string, total int64, files int) error {
	db, err := s.taskCenter.database()
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE desktop_task_runs SET bytes_total=?,total_count=?,updated_at=? WHERE id=? AND source_type='transfer_job' AND status='running'`, total, files, desktopTaskNow(), id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return errDesktopSFTPTaskCancelled
	}
	if _, err := tx.Exec(`UPDATE transfer_jobs SET result_path=? WHERE id=?`, destination, id); err != nil {
		return err
	}
	if err := projectDesktopTask(tx, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *DesktopSFTPService) recordTransferCommit(id string, stats desktopSFTPTransferStats) error {
	s.taskMu.Lock()
	task := s.tasks[id]
	if task == nil {
		s.taskMu.Unlock()
		return errors.New("transfer executor not found")
	}
	task.committedFiles = stats.FilesCopied
	s.taskMu.Unlock()
	_, err := s.taskCenter.transition(id, `UPDATE desktop_task_runs SET bytes_processed=MAX(bytes_processed,?),bytes_completed=?,success_count=?,updated_at=? WHERE id=? AND source_type='transfer_job' AND status IN ('running','canceling')`, []any{stats.BytesCopied, stats.BytesCopied, stats.FilesCopied, desktopTaskNow(), id}, "", "")
	return err
}
