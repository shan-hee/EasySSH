package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"strings"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/easyssh/shared/aichatui"
	"github.com/google/uuid"
)

type desktopAIExecutionOrigin struct {
	Actor      protocol.Actor
	ServerID   string
	ServerName string
}

type desktopAIExecutionFact struct {
	ID, SessionID, TaskID string
	desktopAIExecutionOrigin
	ToolName                                                 string
	Status                                                   DesktopAITaskStatus
	CreatedAt, UpdatedAt, StartedAt, FinishedAt, RecoveredAt string
}

const desktopAIExecutionSelect = `SELECT id,session_id,task_id,actor_kind,actor_id,actor_session_id,actor_grant_id,server_id,server_name,tool_name,status,created_at,updated_at,started_at,finished_at,recovered_at FROM desktop_ai_tool_executions`

func scanDesktopAIExecution(row interface{ Scan(...any) error }) (desktopAIExecutionFact, error) {
	var r desktopAIExecutionFact
	err := row.Scan(&r.ID, &r.SessionID, &r.TaskID, &r.Actor.Kind, &r.Actor.ID, &r.Actor.SessionID, &r.Actor.GrantID, &r.ServerID, &r.ServerName, &r.ToolName, &r.Status, &r.CreatedAt, &r.UpdatedAt, &r.StartedAt, &r.FinishedAt, &r.RecoveredAt)
	return r, err
}
func desktopAIExecutionID(sessionID, taskID string) string {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("desktop_ai_tool_executions:"+sessionID+":"+taskID)).String()
}
func trackedDesktopAITool(name string) bool {
	switch name {
	case "execute_command", "write_file", "create_directory", "delete_file":
		return true
	}
	return false
}
func desktopAIExecutionTerminal(status DesktopAITaskStatus) bool {
	switch status {
	case DesktopAITaskSucceeded, DesktopAITaskFailed, DesktopAITaskUnknown, DesktopAITaskCancelled:
		return true
	}
	return false
}

func (s *DesktopAIService) newExecutionOrigin(ctx context.Context, task DesktopAITaskView) (desktopAIExecutionOrigin, error) {
	origin := desktopAIExecutionOrigin{Actor: desktopLocalActor()}
	refs, err := s.resolveServerReferences(ctx, []aichatui.ServerReference{{ServerID: desktopAIStringArg(task.Arguments, "server_id")}})
	if err != nil {
		return origin, err
	}
	if len(refs) != 1 {
		return origin, errors.New("AI execution target is unavailable")
	}
	origin.ServerID, origin.ServerName = refs[0].ServerID, refs[0].Name
	return origin, nil
}

// Private provenance is stored apart from TaskView and excluded from sync.
func desktopAIKeptOrigins(record desktopAISessionRecord) map[string]desktopAIExecutionOrigin {
	kept := make(map[string]desktopAIExecutionOrigin)
	for _, task := range record.Tasks {
		if origin, ok := record.ExecutionOrigins[task.ID]; ok {
			kept[task.ID] = origin
		}
	}
	return kept
}

func saveDesktopAIExecutions(tx *sql.Tx, record desktopAISessionRecord) error {
	query := desktopAIExecutionSelect + ` WHERE session_id=? AND (status IN ('queued','waiting_confirm','running')`
	args := []any{record.ID}
	ids := make([]string, 0, len(record.ExecutionOrigins))
	for _, task := range record.Tasks {
		if _, ok := record.ExecutionOrigins[task.ID]; ok {
			ids = append(ids, "?")
			args = append(args, task.ID)
		}
	}
	if len(ids) > 0 {
		query += ` OR task_id IN (` + strings.Join(ids, ",") + `)`
	}
	query += `)`
	rows, err := tx.Query(query, args...)
	if err != nil {
		return err
	}
	stored := map[string]desktopAIExecutionFact{}
	for rows.Next() {
		r, e := scanDesktopAIExecution(rows)
		if e != nil {
			rows.Close()
			return e
		}
		stored[r.TaskID] = r
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	kept := map[string]bool{}
	for _, task := range record.Tasks {
		origin, native := record.ExecutionOrigins[task.ID]
		if !native || !trackedDesktopAITool(task.ToolName) {
			continue
		}
		if !origin.Actor.Valid() || origin.Actor.Kind != protocol.Owner || origin.Actor.ID != desktopLocalActor().ID || origin.Actor.GrantID != "" {
			return errDesktopAISnapshotConflict
		}
		kept[task.ID] = true
		row, exists := stored[task.ID]
		if exists {
			if row.desktopAIExecutionOrigin != origin || row.ToolName != task.ToolName {
				return errDesktopAISnapshotConflict
			}
			if desktopAIExecutionTerminal(row.Status) {
				if row.Status == task.Status || row.RecoveredAt != "" && !desktopAIExecutionTerminal(task.Status) {
					continue
				}
				return errDesktopAISnapshotConflict
			}
		} else {
			created, e := time.Parse(time.RFC3339Nano, task.CreatedAt)
			if e != nil {
				return e
			}
			row = desktopAIExecutionFact{ID: desktopAIExecutionID(record.ID, task.ID), SessionID: record.ID, TaskID: task.ID, desktopAIExecutionOrigin: origin, ToolName: task.ToolName, CreatedAt: created.UTC().Format(desktopAITimeLayout)}
		}
		observed, e := time.Parse(time.RFC3339Nano, task.UpdatedAt)
		if e != nil {
			return e
		}
		updated := observed.UTC().Format(desktopAITimeLayout)
		if updated < row.CreatedAt || updated < row.UpdatedAt {
			return errDesktopAISnapshotConflict
		}
		row.Status, row.UpdatedAt = task.Status, updated
		if row.Status == DesktopAITaskRunning && row.StartedAt == "" {
			row.StartedAt = updated
		}
		if desktopAIExecutionTerminal(row.Status) {
			row.FinishedAt = updated
		}
		if err := saveDesktopAIExecutionFact(tx, row); err != nil {
			return err
		}
	}
	for _, row := range stored {
		if kept[row.TaskID] || desktopAIExecutionTerminal(row.Status) {
			continue
		}
		if row.Status == DesktopAITaskRunning {
			return errors.New("AI execution is still running")
		}
		row.Status = DesktopAITaskCancelled
		if record.UpdatedAt < row.UpdatedAt {
			return errDesktopAISnapshotConflict
		}
		row.UpdatedAt, row.FinishedAt = record.UpdatedAt, record.UpdatedAt
		if err := saveDesktopAIExecutionFact(tx, row); err != nil {
			return err
		}
	}
	return nil
}

func saveDesktopAIExecutionFact(tx *sql.Tx, row desktopAIExecutionFact) error {
	_, err := tx.Exec(`INSERT INTO desktop_ai_tool_executions(id,session_id,task_id,actor_kind,actor_id,actor_session_id,actor_grant_id,server_id,server_name,tool_name,status,created_at,updated_at,started_at,finished_at,recovered_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,started_at=excluded.started_at,finished_at=excluded.finished_at,recovered_at=excluded.recovered_at`, row.ID, row.SessionID, row.TaskID, row.Actor.Kind, row.Actor.ID, row.Actor.SessionID, row.Actor.GrantID, row.ServerID, row.ServerName, row.ToolName, row.Status, row.CreatedAt, row.UpdatedAt, row.StartedAt, row.FinishedAt, row.RecoveredAt)
	if err != nil {
		return err
	}
	status := DesktopActivityLogStatus("pending")
	switch row.Status {
	case DesktopAITaskRunning:
		status = "running"
	case DesktopAITaskSucceeded:
		status = "success"
	case DesktopAITaskFailed:
		status = "failure"
	case DesktopAITaskUnknown:
		status = "unknown"
	case DesktopAITaskCancelled:
		status = "canceled"
	}
	detail := map[string]any{"session_id": row.SessionID, "task_id": row.TaskID, "tool_name": row.ToolName}
	if row.RecoveredAt != "" {
		detail["end_time_estimated"] = true
		detail["recovered_at"] = row.RecoveredAt
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	item := DesktopActivityLogItem{ID: uuid.NewSHA1(uuid.NameSpaceOID, []byte("desktop_ai_tool_executions:"+row.ID)).String(), Actor: row.Actor, WorkID: row.ID, WorkStartedAt: row.CreatedAt, Attempt: 1, SourceTable: "desktop_ai_tool_executions", SourceID: row.ID, Action: "ai_" + row.ToolName, Kind: activitystats.TypeExecution, Source: "manual", Status: status, ServerID: row.ServerID, ServerName: row.ServerName, Resource: row.ServerName, StartedAt: row.StartedAt, FinishedAt: row.FinishedAt, CreatedAt: row.CreatedAt, TotalCount: 1, Detail: string(encoded)}
	if row.Status == DesktopAITaskSucceeded {
		item.SuccessCount = 1
	}
	if row.Status == DesktopAITaskFailed {
		item.FailureCount = 1
	}
	if row.StartedAt != "" && row.FinishedAt != "" {
		item.DurationMs = max(0, parseDesktopAITime(row.FinishedAt).Sub(parseDesktopAITime(row.StartedAt)).Milliseconds())
	}
	return upsertDesktopActivity(tx, item)
}

func (s *DesktopAIService) recoverAIExecutionFacts(ctx context.Context) error {
	db, err := s.database()
	if err != nil {
		return err
	}
	recovered := time.Now().UTC().Format(desktopAITimeLayout)
	for {
		count := 0
		err = func() error {
			tx, e := db.BeginTx(ctx, nil)
			if e != nil {
				return e
			}
			defer tx.Rollback()
			rows, e := tx.QueryContext(ctx, desktopAIExecutionSelect+` WHERE status IN ('running','queued') ORDER BY id LIMIT 100`)
			if e != nil {
				return e
			}
			var facts []desktopAIExecutionFact
			for rows.Next() {
				r, e := scanDesktopAIExecution(rows)
				if e != nil {
					rows.Close()
					return e
				}
				facts = append(facts, r)
			}
			e = rows.Err()
			rows.Close()
			if e != nil {
				return e
			}
			count = len(facts)
			for _, r := range facts {
				running := r.Status == DesktopAITaskRunning
				if running {
					r.Status = DesktopAITaskUnknown
				} else {
					r.Status = DesktopAITaskCancelled
				}
				r.FinishedAt, r.RecoveredAt = r.UpdatedAt, recovered
				if e := saveDesktopAIExecutionFact(tx, r); e != nil {
					return e
				}
				if running {
					rows, e := tx.QueryContext(ctx, desktopAIExecutionSelect+` WHERE session_id=? AND status='waiting_confirm'`, r.SessionID)
					if e != nil {
						return e
					}
					var pending []desktopAIExecutionFact
					for rows.Next() {
						p, e := scanDesktopAIExecution(rows)
						if e != nil {
							rows.Close()
							return e
						}
						pending = append(pending, p)
					}
					e = rows.Err()
					rows.Close()
					if e != nil {
						return e
					}
					for _, p := range pending {
						p.Status = DesktopAITaskCancelled
						p.FinishedAt, p.RecoveredAt = p.UpdatedAt, recovered
						if e := saveDesktopAIExecutionFact(tx, p); e != nil {
							return e
						}
					}
				}
			}
			return tx.Commit()
		}()
		if err != nil {
			return err
		}
		if count < 100 {
			return nil
		}
	}
}

type desktopAIExecutionContextKey struct{}
type desktopAIExecutionParent struct {
	ID    string
	Actor protocol.Actor
}
