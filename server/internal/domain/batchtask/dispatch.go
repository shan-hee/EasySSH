package batchtask

import (
	"context"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"maps"
	"slices"
	"strings"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Dispatch makes a validated draft, its execution projection, and the durable
// queue row visible together. No compensation can substitute for this boundary.
func (r *repository) Dispatch(ctx context.Context, expected *BatchTask) (*taskcenter.TaskRun, error) {
	actor := access.Current(ctx).Actor()
	if expected == nil || !actor.Valid() {
		return nil, ErrInvalidBatchTaskData
	}
	var committed *taskcenter.TaskRun
	err := taskcenter.Transaction(ctx, r.db, r.bodies, func(tx *gorm.DB) error {
		task, err := get(tx.Clauses(clause.Locking{Strength: "UPDATE"}), expected.ID)
		if err != nil {
			return err
		}
		if task.Actor != actor && !(task.Actor.Kind == protocol.Owner && actor.Kind == protocol.Owner && task.Actor.ID == actor.ID) {
			return access.ErrForbidden
		}
		if task.Status != "pending" {
			return ErrInvalidBatchTaskData
		}
		// Authorization was checked before opening this DB transaction. Compare the
		// entire executable definition under its lock so an intervening edit cannot
		// substitute different targets, code or parameters. The worker checks access
		// again when it actually runs; revocation never becomes owner authority.
		if !sameDispatchDefinition(task, expected) {
			return access.ErrResourceChanged
		}
		changed := tx.Model(&BatchTask{}).Where("id = ? AND status = ?", task.ID, "pending").Updates(map[string]any{
			"status": "queued", "actor_kind": actor.Kind, "actor_id": actor.ID, "actor_session_id": actor.SessionID, "actor_grant_id": actor.GrantID,
		})
		if changed.Error != nil {
			return changed.Error
		}
		if changed.RowsAffected != 1 {
			return ErrInvalidBatchTaskData
		}
		payload, err := json.Marshal(script.ExecutionInput{ScriptID: task.ScriptID, Version: task.ScriptVersion, Parameters: task.Parameters})
		if err != nil {
			return err
		}
		run := &taskcenter.TaskRun{ID: task.ID, Actor: actor, WorkID: task.ID, TaskType: task.TaskType, Title: task.TaskName,
			SourceType: "batch_task", SourceID: task.ID.String(), TriggerType: taskcenter.TriggerManual, Runner: "server",
			Status: taskcenter.StatusQueued, Resource: strings.Join(task.ServerIDs, ","), PayloadJSON: string(payload), TotalCount: len(task.ServerIDs),
			Cancelable: true, Retryable: false, MaxAttempts: 1,
		}
		if err := taskcenter.NewTransactionRepository(tx, r.bodies).CreateWithEvent(ctx, run, &taskcenter.TaskEvent{Level: "info", Message: "批量任务已进入队列"}); err != nil {
			return err
		}
		dispatchPayload, err := json.Marshal(map[string]string{"task_id": task.ID.String()})
		if err != nil {
			return err
		}
		key := "batch.execute:" + task.ID.String()
		job := &jobqueue.Job{ID: task.ID, Actor: actor, Kind: "batch.execute", SourceType: "task_run", SourceID: task.ID.String(),
			DedupeKey: &key, PayloadJSON: string(dispatchPayload), Status: jobqueue.StatusQueued, MaxAttempts: 1,
		}
		// Duplicate identity is a conflict, never an invitation to requeue a shell
		// command. A new execution must have a new explicit draft identity.
		if err := tx.Create(job).Error; err != nil {
			return err
		}
		committed = run
		return nil
	})
	if err != nil {
		return nil, err
	}
	return committed, nil
}

func sameDispatchDefinition(actual, expected *BatchTask) bool {
	if actual.ID != expected.ID || actual.Actor != expected.Actor || actual.TaskName != expected.TaskName || actual.TaskType != expected.TaskType || actual.Content != expected.Content || actual.ExecutionMode != expected.ExecutionMode || actual.ScriptVersion != expected.ScriptVersion || !slices.Equal(actual.ServerIDs, expected.ServerIDs) || !maps.Equal(actual.Parameters, expected.Parameters) {
		return false
	}
	if actual.ScriptID == nil || expected.ScriptID == nil {
		return actual.ScriptID == nil && expected.ScriptID == nil
	}
	return *actual.ScriptID == *expected.ScriptID
}

// A queue envelope is not authority to settle an arbitrary task named in JSON.
// Bind the payload to the stable source, job identity, and non-replay policy.
func batchDispatchID(job *jobqueue.Job) (uuid.UUID, error) {
	if job == nil || job.Kind != "batch.execute" || job.SourceType != "task_run" || !job.Actor.Valid() || job.MaxAttempts != 1 {
		return uuid.Nil, ErrInvalidBatchTaskData
	}
	var payload struct {
		TaskID uuid.UUID `json:"task_id"`
	}
	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		return uuid.Nil, ErrInvalidBatchTaskData
	}
	if payload.TaskID == uuid.Nil || job.ID != payload.TaskID || job.SourceID != payload.TaskID.String() || job.DedupeKey == nil || *job.DedupeKey != "batch.execute:"+payload.TaskID.String() {
		return uuid.Nil, ErrInvalidBatchTaskData
	}
	return payload.TaskID, nil
}
