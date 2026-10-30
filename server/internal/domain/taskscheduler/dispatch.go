package taskscheduler

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"slices"
	"strings"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/jobqueue"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/server/internal/domain/taskexecutor"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// A scheduled execution and its durable queue envelope commit together. An
// existing execution identity is only returned; it is never enqueued again.
func (s *Scheduler) dispatch(ctx context.Context, expected *scheduledtask.ScheduledTask, runID uuid.UUID, trigger taskexecutor.TriggerType, retryOfID *uuid.UUID, attempt int) (*taskcenter.TaskRun, bool, error) {
	actor := access.Current(ctx).Actor()
	if expected == nil || !actor.Valid() || actor.Kind != protocol.Owner || actor.ID != expected.OwnerID.String() || runID == uuid.Nil || attempt < 1 {
		return nil, false, access.ErrForbidden
	}
	var committed taskcenter.TaskRun
	created := false
	err := taskcenter.Transaction(ctx, s.db, s.bodies, func(tx *gorm.DB) error {
		var actual scheduledtask.ScheduledTask
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&actual, "id=?", expected.ID).Error; err != nil {
			return err
		}
		if !sameDefinition(&actual, expected) {
			return access.ErrResourceChanged
		}
		if trigger == taskexecutor.TriggerSchedule && !actual.Enabled {
			return access.ErrRevoked
		}
		err := tx.First(&committed, "id=?", runID).Error
		if err == nil {
			if committed.Actor.Kind != protocol.Owner || committed.Actor.ID != actor.ID || committed.SourceType != string(taskexecutor.SourceScheduledTask) || committed.SourceID != actual.ID.String() || committed.Attempt != attempt || !sameID(committed.RetryOfID, retryOfID) {
				return access.ErrForbidden
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if retryOfID != nil {
			var previous taskcenter.TaskRun
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&previous, "id=?", *retryOfID).Error; err != nil {
				return err
			}
			if previous.Actor.Kind != protocol.Owner || previous.Actor.ID != actor.ID || previous.DefinitionID == nil || *previous.DefinitionID != actual.ID || !previous.Retryable || !isTerminalRun(previous.Status) || previous.Status == taskcenter.StatusUnknown || previous.Status == taskcenter.StatusSucceeded || attempt != previous.Attempt+1 {
				return errors.New("task run cannot be retried")
			}
		} else if attempt != 1 {
			return errors.New("initial execution must use attempt 1")
		}
		if err := scheduledtask.CheckResources(ctx, tx, &actual, ""); err != nil {
			return err
		}
		triggerType := taskcenter.TriggerManual
		if trigger == taskexecutor.TriggerSchedule {
			triggerType = taskcenter.TriggerScheduled
		}
		committed = taskcenter.TaskRun{
			ID: runID, Actor: actor, DefinitionID: &actual.ID, DefinitionVersion: actual.Version(), RetryOfID: retryOfID,
			SourceType: string(taskexecutor.SourceScheduledTask), SourceID: actual.ID.String(), TaskType: actual.TaskType,
			Title: actual.TaskName, Description: actual.Description, TriggerType: triggerType, Runner: "server", Status: taskcenter.StatusQueued,
			Resource: strings.Join(actual.ServerIDs, ","), TotalCount: len(actual.ServerIDs), PayloadJSON: actual.PayloadJSON,
			Cancelable: !isTransferTask(actual.TaskType), Retryable: true, Attempt: attempt, MaxAttempts: attempt,
		}
		if err := taskcenter.NewTransactionRepository(tx, s.bodies).CreateWithEvent(ctx, &committed, &taskcenter.TaskEvent{Level: "info", Message: "任务已进入队列"}); err != nil {
			return err
		}
		payload, err := json.Marshal(taskexecutor.QueuePayload{DefinitionVersion: committed.DefinitionVersion, RunID: runID, TaskID: actual.ID, Trigger: trigger, Source: taskexecutor.SourceScheduledTask, RetryOfID: retryOfID, Attempt: attempt})
		if err != nil {
			return err
		}
		key := taskRunDedupeKey(runID)
		job := jobqueue.Job{ID: runID, Actor: actor, Kind: taskexecutor.QueueJobKind, SourceType: "task_run", SourceID: runID.String(), DedupeKey: &key, PayloadJSON: string(payload), Status: jobqueue.StatusQueued, MaxAttempts: 1}
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return &committed, created, nil
}

func sameID(a, b *uuid.UUID) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
func sameDefinition(a, b *scheduledtask.ScheduledTask) bool {
	return a.ID == b.ID && a.OwnerID == b.OwnerID && a.Enabled == b.Enabled &&
		a.TaskName == b.TaskName && a.Description == b.Description && a.TaskType == b.TaskType && a.Command == b.Command &&
		a.PayloadJSON == b.PayloadJSON && sameID(a.ScriptID, b.ScriptID) && slices.Equal(a.ServerIDs, b.ServerIDs) &&
		a.CronExpression == b.CronExpression && a.Timezone == b.Timezone
}
