package app

import (
	"context"
	"errors"
	"time"
)

func desktopAITaskUnknown(tasks []DesktopAITaskView, id string) bool {
	index := desktopAIFindTaskIndex(tasks, id)
	return index >= 0 && tasks[index].Status == DesktopAITaskUnknown
}

// A late cancellation cannot replace an observed remote result. Mutation tools
// must return Unknown when the request was sent but its effect is unconfirmed.
func applyDesktopAIToolOutcome(task *DesktopAITaskView, result desktopAIToolResult, err error) {
	task.Result, task.Error = result.Content, ""
	switch {
	case result.Unknown:
		task.Status, task.Error = DesktopAITaskUnknown, result.Content
	case result.Cancelled:
		task.Status = DesktopAITaskCancelled
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		task.Status, task.Result = DesktopAITaskCancelled, "操作已取消。"
	case err != nil:
		task.Status, task.Result, task.Error = DesktopAITaskFailed, err.Error(), err.Error()
	case result.IsError:
		task.Status, task.Error = DesktopAITaskFailed, result.Content
	default:
		task.Status = DesktopAITaskSucceeded
	}
}

// Leave running tools to report their own outcome; cancellation does not prove
// that a command or file mutation was rolled back on the remote host.
func cancelDesktopAIQueuedTasks(record *desktopAISessionRecord, now string) {
	for i := range record.Tasks {
		task := &record.Tasks[i]
		if task.Status != DesktopAITaskQueued && task.Status != DesktopAITaskWaitingConfirm {
			continue
		}
		task.Status, task.Result, task.Error = DesktopAITaskCancelled, "后续操作未执行，本轮已停止。", ""
		task.UpdatedAt = now
	}
}

// Startup recovery records uncertainty; it never replays a persisted tool call.
func (s *DesktopAIService) recoverInterruptedAITasks(ctx context.Context) error {
	database, err := s.database()
	if err != nil {
		return err
	}
	lastID := ""
	for {
		rows, err := database.QueryContext(ctx, `SELECT id FROM desktop_ai_sessions WHERE id>? AND (status='running' OR EXISTS(SELECT 1 FROM desktop_ai_session_tasks t WHERE t.session_id=desktop_ai_sessions.id AND t.status IN ('running','queued'))) ORDER BY id LIMIT 100`, lastID)
		if err != nil {
			return err
		}
		ids := make([]string, 0, 100)
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		for _, id := range ids {
			if err := ctx.Err(); err != nil {
				return err
			}
			record, err := s.loadSession(id)
			if err != nil {
				return err
			}
			normalizeDesktopAIInterrupted(&record)
			if err := s.saveSession(record); err != nil {
				return err
			}
		}
		lastID = ids[len(ids)-1]
	}
}

// Caller owns sessionMu (or startup has not admitted any work). No unconfirmed
// remote effect is reconstructed from an in-memory receipt after a failed save.
func (s *DesktopAIService) loadIdleAISession(id string) (desktopAISessionRecord, error) {
	record, err := s.loadSession(id)
	if err != nil {
		return record, err
	}
	s.mu.Lock()
	request := s.activeRequests[id]
	var failure error
	if request != nil {
		failure = request.StorageErr
	}
	s.mu.Unlock()
	if failure != nil {
		return desktopAISessionRecord{}, failure
	}
	if request != nil {
		return record, nil
	}
	if normalizeDesktopAIInterrupted(&record) {
		if err := s.saveSession(record); err != nil {
			return desktopAISessionRecord{}, err
		}
	}
	return record, nil
}

func normalizeDesktopAIInterrupted(record *desktopAISessionRecord) bool {
	interrupted := record.Status == DesktopAISessionRunning
	for _, task := range record.Tasks {
		if task.Status == DesktopAITaskRunning || task.Status == DesktopAITaskQueued {
			interrupted = true
		}
	}
	if !interrupted {
		return false
	}
	now := time.Now().UTC().Format(desktopAITimeLayout)
	cancelDesktopAIActiveTasks(record, now)
	if record.Status != DesktopAISessionClosed {
		record.Status = DesktopAISessionIdle
	}
	record.UpdatedAt = now
	return true
}
