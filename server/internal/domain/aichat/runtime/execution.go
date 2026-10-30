package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"strings"
	"time"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/aichat/registry"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/easyssh/shared/aichatui"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ExecutionOrigin is created only by this runtime. Conversation sync transfers
// TaskView, never this provenance. Editing a conversation cannot edit its facts.
type ExecutionOrigin struct {
	Actor      protocol.Actor `json:"actor"`
	ServerID   uuid.UUID      `json:"server_id"`
	ServerName string         `json:"server_name"`
}

type ToolExecutionRecord struct {
	ID          uuid.UUID      `gorm:"type:char(36);primaryKey"`
	SessionID   string         `gorm:"type:char(36);not null;uniqueIndex:idx_ai_tool_identity,priority:1;index:idx_ai_tool_session_state,priority:1"`
	TaskID      string         `gorm:"type:char(36);not null;uniqueIndex:idx_ai_tool_identity,priority:2"`
	Actor       protocol.Actor `gorm:"embedded;embeddedPrefix:actor_"`
	ToolName    string         `gorm:"size:50;not null"`
	ServerID    *uuid.UUID     `gorm:"type:char(36)"`
	ServerName  string         `gorm:"size:120;not null"`
	Status      TaskStatus     `gorm:"size:32;not null;index:idx_ai_tool_status;index:idx_ai_tool_session_state,priority:2"`
	CreatedAt   time.Time      `gorm:"not null;autoCreateTime:false"`
	UpdatedAt   time.Time      `gorm:"not null;autoUpdateTime:false"`
	StartedAt   *time.Time
	FinishedAt  *time.Time
	RecoveredAt *time.Time
}

func (ToolExecutionRecord) TableName() string { return "ai_tool_executions" }

func trackedExecutionTool(name string) bool {
	switch name {
	case "execute_command", "write_file", "create_directory", "delete_file":
		return true
	}
	return false
}

func (m *Manager) executionOrigin(ctx context.Context, call registry.ToolCall) (*ExecutionOrigin, error) {
	if !trackedExecutionTool(call.Name) {
		return nil, nil
	}
	origin := &ExecutionOrigin{Actor: access.Current(ctx).Actor()}
	if !origin.Actor.Valid() {
		return nil, access.ErrUnauthenticated
	}
	id, _ := decodeArguments(call.Arguments)["server_id"].(string)
	refs, err := m.resolveServerReferences(ctx, []aichatui.ServerReference{{ServerID: strings.TrimSpace(id)}})
	if err != nil {
		return origin, err
	}
	if len(refs) != 1 {
		return origin, errors.New("AI execution target is unavailable")
	}
	origin.ServerID, err = uuid.Parse(refs[0].ServerID)
	if err != nil {
		return origin, err
	}
	origin.ServerName = refs[0].Name
	return origin, nil
}

func executionTerminal(status TaskStatus) bool {
	switch status {
	case TaskStatusSucceeded, TaskStatusFailed, TaskStatusUnknown, TaskStatusCancelled:
		return true
	}
	return false
}

// Called inside the session-save transaction. Only locally generated provenance
// can create facts; source rows survive conversation edits, imports and deletion.
func saveToolExecutions(tx *gorm.DB, snapshot SessionSnapshot) error {
	ids := make([]string, 0, len(snapshot.Tasks))
	for _, task := range snapshot.Tasks {
		if task.Execution != nil {
			ids = append(ids, task.View.ID)
		}
	}
	// Old branches can accumulate many terminal facts. Load only this branch's
	// native IDs plus unfinished work that a branch edit may need to cancel.
	query := tx.Where("session_id=?", snapshot.ID)
	active := []TaskStatus{TaskStatusQueued, TaskStatusWaitingConfirm, TaskStatusRunning}
	if len(ids) > 0 {
		query = query.Where("(status IN ? OR task_id IN ?)", active, ids)
	} else {
		query = query.Where("status IN ?", active)
	}
	var stored []ToolExecutionRecord
	if err := query.Find(&stored).Error; err != nil {
		return err
	}
	byID := make(map[string]ToolExecutionRecord, len(stored))
	for _, row := range stored {
		byID[row.TaskID] = row
	}
	kept := make(map[string]bool, len(snapshot.Tasks))
	for _, task := range snapshot.Tasks {
		if task.Execution == nil || !trackedExecutionTool(task.View.ToolName) {
			continue
		}
		origin := task.Execution
		if !origin.Actor.Valid() || !sameConversationActor(origin.Actor, snapshot.Actor) {
			return ErrSnapshotConflict
		}
		view := task.View
		kept[view.ID] = true
		row, exists := byID[view.ID]
		if exists {
			if row.Actor != origin.Actor || row.ToolName != view.ToolName {
				return ErrSnapshotConflict
			}
			if (row.ServerID == nil) != (origin.ServerID == uuid.Nil) || row.ServerID != nil && *row.ServerID != origin.ServerID {
				return ErrSnapshotConflict
			}
			if executionTerminal(row.Status) {
				// Reopening a recovered session can present its pre-recovery state. The
				// recovery fact is authoritative until runtime normalizes that snapshot.
				if row.Status == view.Status || row.RecoveredAt != nil && !executionTerminal(view.Status) {
					continue
				}
				return ErrSnapshotConflict
			}
		} else {
			if view.ID == "" || view.CreatedAt.IsZero() {
				return ErrSnapshotConflict
			}
			row = ToolExecutionRecord{ID: uuid.NewSHA1(uuid.NameSpaceOID, []byte("ai_tool_executions:"+snapshot.ID+":"+view.ID)), SessionID: snapshot.ID, TaskID: view.ID, Actor: origin.Actor, ToolName: view.ToolName, ServerName: origin.ServerName, CreatedAt: view.CreatedAt.UTC()}
			if origin.ServerID != uuid.Nil {
				id := origin.ServerID
				row.ServerID = &id
			}
		}
		row.Status = view.Status
		observed := view.UpdatedAt.UTC()
		if observed.Before(row.CreatedAt) {
			observed = row.CreatedAt
		}
		if observed.Before(row.UpdatedAt) {
			return ErrSnapshotConflict
		}
		row.UpdatedAt = observed
		if row.Status == TaskStatusRunning && row.StartedAt == nil {
			row.StartedAt = &observed
		}
		if executionTerminal(row.Status) {
			row.FinishedAt = &observed
		}
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		if err := projectToolExecution(tx, row); err != nil {
			return err
		}
	}
	for _, row := range stored {
		if kept[row.TaskID] || executionTerminal(row.Status) {
			continue
		}
		if !sameConversationActor(row.Actor, snapshot.Actor) {
			return ErrSnapshotConflict
		}
		// Branch edits can remove only work that has not entered execution.
		if row.Status == TaskStatusRunning {
			return ErrSessionBusy
		}
		row.Status = TaskStatusCancelled
		ended := snapshot.UpdatedAt.UTC()
		if ended.Before(row.UpdatedAt) {
			return ErrSnapshotConflict
		}
		row.UpdatedAt = ended
		row.FinishedAt = &ended
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		if err := projectToolExecution(tx, row); err != nil {
			return err
		}
	}
	return nil
}

func projectToolExecution(tx *gorm.DB, row ToolExecutionRecord) error {
	status := operationrecord.StatusPending
	switch row.Status {
	case TaskStatusRunning:
		status = operationrecord.StatusRunning
	case TaskStatusSucceeded:
		status = operationrecord.StatusSuccess
	case TaskStatusFailed:
		status = operationrecord.StatusFailure
	case TaskStatusUnknown:
		status = operationrecord.StatusUnknown
	case TaskStatusCancelled:
		status = operationrecord.StatusCanceled
	}
	detail := map[string]any{"session_id": row.SessionID, "task_id": row.TaskID, "tool_name": row.ToolName}
	if row.RecoveredAt != nil {
		detail["end_time_estimated"] = true
		detail["recovered_at"] = row.RecoveredAt
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	record := &operationrecord.OperationRecord{Actor: row.Actor, WorkID: row.ID, WorkStartedAt: row.CreatedAt, Attempt: 1, Type: operationrecord.TypeExecution, Category: operationrecord.CategoryActivity, Action: "ai_" + row.ToolName, Status: status, ServerID: row.ServerID, ServerName: row.ServerName, Title: row.ToolName, Resource: row.ServerName, StartedAt: row.StartedAt, FinishedAt: row.FinishedAt, TotalCount: 1, DetailJSON: string(encoded), SourceTable: row.TableName(), SourceID: row.ID.String(), CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
	if row.Status == TaskStatusSucceeded {
		record.SuccessCount = 1
	}
	if row.Status == TaskStatusFailed {
		record.FailureCount = 1
	}
	if row.StartedAt != nil && row.FinishedAt != nil {
		record.DurationMs = max(0, row.FinishedAt.Sub(*row.StartedAt).Milliseconds())
	}
	return operationrecord.NewRepository(tx, nil).Upsert(tx.Statement.Context, record)
}

// Source rows are retained so clearing activity cannot resurrect old work on save.
func recoverToolExecutions(ctx context.Context, db *gorm.DB) error {
	recovered := time.Now().UTC()
	for {
		count := 0
		err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var rows []ToolExecutionRecord
			if err := tx.Where("status IN ?", []TaskStatus{TaskStatusRunning, TaskStatusQueued}).Order("id").Limit(100).Find(&rows).Error; err != nil {
				return err
			}
			count = len(rows)
			for _, row := range rows {
				wasRunning := row.Status == TaskStatusRunning
				if wasRunning {
					row.Status = TaskStatusUnknown
				} else {
					row.Status = TaskStatusCancelled
				}
				finish := row.UpdatedAt
				row.FinishedAt = &finish
				row.RecoveredAt = &recovered
				if err := tx.Save(&row).Error; err != nil {
					return err
				}
				if err := projectToolExecution(tx, row); err != nil {
					return err
				}
				if wasRunning {
					var waiting []ToolExecutionRecord
					if err := tx.Where("session_id=? AND status=?", row.SessionID, TaskStatusWaitingConfirm).Find(&waiting).Error; err != nil {
						return err
					}
					for _, pending := range waiting {
						pending.Status = TaskStatusCancelled
						end := pending.UpdatedAt
						pending.FinishedAt = &end
						pending.RecoveredAt = &recovered
						if err := tx.Save(&pending).Error; err != nil {
							return err
						}
						if err := projectToolExecution(tx, pending); err != nil {
							return err
						}
					}
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		if count < 100 {
			return nil
		}
	}
}
