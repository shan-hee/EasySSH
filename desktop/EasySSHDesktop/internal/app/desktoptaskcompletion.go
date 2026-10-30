package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/resultstore"
	"github.com/easyssh/shared/taskprotocol"
	"github.com/google/uuid"
)

// These values describe effects already observed by the executor. Retrying
// their persistence must never call an executor or open a network connection.
type desktopTaskFinalMetrics struct {
	Processed int64
	Total     int64
	Completed int64
}

type desktopTaskCompletion struct {
	PreserveResult bool
	Status         string
	ResultJSON     string
	ErrorCode      string
	ErrorMessage   string
	SuccessCount   int
	FailureCount   int
	FinishedAt     string
	Metrics        *desktopTaskFinalMetrics
	Targets        []desktopBatchTaskResult
}

func (s *DesktopTaskService) completeOutcome(id string, outcome desktopTaskCompletion) error {
	if !desktopTaskIsTerminal(outcome.Status) || outcome.SuccessCount < 0 || outcome.FailureCount < 0 {
		return errors.New("invalid completion")
	}
	if outcome.Metrics != nil && (outcome.Metrics.Processed < 0 || outcome.Metrics.Total < 0 || outcome.Metrics.Completed < 0 || outcome.Metrics.Completed > outcome.Metrics.Processed) {
		return errors.New("invalid completion metrics")
	}
	if outcome.FinishedAt == "" {
		outcome.FinishedAt = desktopTaskNow()
	}
	outcome.Targets = append([]desktopBatchTaskResult(nil), outcome.Targets...)
	if outcome.Metrics != nil {
		copied := *outcome.Metrics
		outcome.Metrics = &copied
	}
	s.mu.Lock()
	if s.closed || s.stopping {
		s.mu.Unlock()
		return errors.New("task storage is stopping")
	}
	s.completionWG.Add(1)
	s.mu.Unlock()
	defer s.completionWG.Done()
	if _, err := s.database(); err != nil {
		return err
	}
	changed := false
	err := resultstore.Write(context.Background(), func(ctx context.Context) error {
		var err error
		changed, err = s.persistCompletion(ctx, id, outcome)
		if errors.Is(err, sql.ErrNoRows) {
			return resultstore.Permanent(errors.New("task not found"))
		}
		return err
	})
	if err != nil {
		return err
	}
	if changed && s.notifications != nil {
		s.notifications.refreshTray()
	}
	s.emitChanged("task.completed", id)
	return nil
}

func (s *DesktopTaskService) persistCompletion(ctx context.Context, id string, outcome desktopTaskCompletion) (bool, error) {
	db, err := s.database()
	if err != nil {
		return false, err
	}
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	run, err := scanDesktopTaskRun(tx.QueryRowContext(ctx, desktopTaskSelectSQL+" WHERE id=?", id))
	if err != nil {
		return false, err
	}
	if desktopTaskIsTerminal(run.Status) {
		return false, nil
	}
	if !outcome.PreserveResult {
		if err := loadDesktopTaskBody(ctx, tx, &run); err != nil {
			return false, err
		}
		if run.ResultJSON != outcome.ResultJSON {
			run.ResultJSON = outcome.ResultJSON
			if err := saveDesktopTaskBody(ctx, tx, desktopTaskBody(run)); err != nil {
				return false, err
			}
		}
	}
	for _, target := range outcome.Targets {
		if run.SourceType != "desktop_batch_task" || target.TaskID != run.SourceID {
			return false, errors.New("target belongs to another task")
		}
		if err := saveDesktopTaskTarget(tx, target); err != nil {
			return false, err
		}
	}
	progress := run.Progress
	if outcome.Status == "succeeded" || outcome.Status == "partial_success" {
		progress = 100
	}
	metrics := desktopTaskFinalMetrics{Processed: run.BytesProcessed, Total: run.BytesTotal, Completed: run.BytesCompleted}
	if outcome.Metrics != nil {
		metrics = *outcome.Metrics
	}
	_, err = tx.ExecContext(ctx, `UPDATE desktop_task_runs SET status=?,cancelable=0,retryable=CASE WHEN ? IN ('failed','partial_success','canceled','timeout') THEN retryable ELSE 0 END,progress=?,error_code=?,error_message=?,success_count=?,failure_count=?,total_count=MAX(total_count,?),bytes_processed=?,bytes_total=?,bytes_completed=?,finished_at=?,updated_at=? WHERE id=?`,
		outcome.Status, outcome.Status, progress, outcome.ErrorCode, outcome.ErrorMessage, outcome.SuccessCount, outcome.FailureCount, outcome.SuccessCount+outcome.FailureCount, metrics.Processed, metrics.Total, metrics.Completed, outcome.FinishedAt, desktopTaskNow(), id)
	if err != nil {
		return false, err
	}
	if err := projectDesktopTask(tx, id); err != nil {
		return false, err
	}
	level, message := desktopTaskCompletionEvent(outcome.Status)
	if err := appendDesktopTaskEvent(tx, id, level, message, ""); err != nil {
		return false, err
	}
	completed, err := scanDesktopTaskRun(tx.QueryRowContext(ctx, desktopTaskSelectSQL+" WHERE id=?", id))
	if err != nil {
		return false, err
	}
	if err := insertDesktopNotification(tx, desktopTaskNotification(completed)); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// The caller holds desktopInstanceFilesMu through the source/activity commit.
func saveDesktopTaskTarget(tx *sql.Tx, result desktopBatchTaskResult) error {
	var stored desktopBatchTaskResult
	var contentID sql.NullString
	var ref protocol.ContentReference
	err := tx.QueryRow(`SELECT r.id,r.task_id,r.server_id,r.server_name,r.server_host,r.status,r.exit_code,r.output,r.error_message,r.started_at,r.completed_at,r.duration_ms,r.output_content_id,COALESCE(c.size,0),COALESCE(c.sha256,''),COALESCE(c.media_type,'')
 FROM desktop_batch_task_results r LEFT JOIN desktop_content_objects c ON c.id=r.output_content_id AND c.source_type='task_target' AND c.source_id=r.id WHERE r.id=?`, result.ID).Scan(
		&stored.ID, &stored.TaskID, &stored.ServerID, &stored.ServerName, &stored.ServerHost, &stored.Status, &stored.ExitCode, &stored.Output, &stored.ErrorMessage, &stored.StartedAt, &stored.CompletedAt, &stored.DurationMs, &contentID, &ref.Size, &ref.Sha256, &ref.MediaType)
	var output *protocol.ContentReference
	if err == nil {
		observed := result
		if contentID.Valid {
			ref.ID, err = uuid.Parse(contentID.String)
			if err != nil {
				return err
			}
			if contentstore.ValidateReference(ref) != nil || ref.MediaType != "text/plain; charset=utf-8" {
				return resultstore.Permanent(contentstore.ErrChanged)
			}
			hash := sha256.Sum256([]byte(result.Output))
			if ref.Size != int64(len(result.Output)) || ref.Sha256 != hex.EncodeToString(hash[:]) {
				return resultstore.Permanent(errors.New("target result is immutable"))
			}
			observed.Output = ""
			output = &ref
		}
		if stored != observed {
			return resultstore.Permanent(errors.New("target result is immutable"))
		}
	} else {
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		inline := result.Output
		var id any
		if len(inline) > taskprotocol.MaxInlineContentBytes {
			ref, err = putDesktopContent(context.Background(), tx, "task_target", result.ID, []byte(inline), "text/plain; charset=utf-8")
			if err != nil {
				return err
			}
			output, id, inline = &ref, ref.ID.String(), ""
		}
		if _, err := tx.Exec(`INSERT INTO desktop_batch_task_results(id,task_id,server_id,server_name,server_host,status,exit_code,output,output_content_id,error_message,started_at,completed_at,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			result.ID, result.TaskID, result.ServerID, result.ServerName, result.ServerHost, result.Status, result.ExitCode, inline, id, result.ErrorMessage, result.StartedAt, result.CompletedAt, result.DurationMs, result.CompletedAt); err != nil {
			return err
		}
	}
	return projectDesktopTaskTarget(tx, result, output)
}
