package scheduledtask

import (
	"context"
	"encoding/json"
	"slices"
	"strings"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/script"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/scriptutil"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Version identifies execution settings, not authority. Runtime counters and
// next-run timestamps cannot invalidate an already dispatched definition.
func (task ScheduledTask) Version() string {
	value := struct {
		ID       uuid.UUID
		OwnerID  uuid.UUID
		Kind     string
		ScriptID *uuid.UUID
		Command  string
		Payload  string
		Servers  []string
		Enabled  bool
		Cron     string
		Timezone string
	}{task.ID, task.OwnerID, task.TaskType, task.ScriptID, task.Command, task.PayloadJSON, task.ServerIDs, task.Enabled, task.CronExpression, task.Timezone}
	encoded, _ := json.Marshal(value)
	return uuid.NewSHA1(uuid.NameSpaceOID, encoded).String()
}

func (r *repository) CheckStage(ctx context.Context, id uuid.UUID, version string, ownerID uuid.UUID, automatic bool, serverID string) error {
	var task ScheduledTask
	if err := r.db.WithContext(ctx).First(&task, "id=?", id).Error; err != nil {
		return err
	}
	actor := access.Current(ctx).Actor()
	if actor.Kind != protocol.Owner || !actor.Valid() || actor.ID != ownerID.String() || task.OwnerID != ownerID {
		return access.ErrForbidden
	}
	if automatic && !task.Enabled {
		return access.ErrRevoked
	}
	if version == "" || version != task.Version() {
		return access.ErrResourceChanged
	}
	return CheckResources(ctx, r.db, &task, serverID)
}

// CheckResources is called at dispatch and at stage boundaries, never per I/O
// block or generic Scope.Check. It resolves the definition payload once.
func CheckResources(ctx context.Context, db *gorm.DB, task *ScheduledTask, stageServerID string) error {
	if task == nil || task.OwnerID == uuid.Nil {
		return access.ErrForbidden
	}
	actor := access.Current(ctx).Actor()
	if actor.Kind != protocol.Owner || !actor.Valid() || actor.ID != task.OwnerID.String() {
		return access.ErrForbidden
	}
	ids := append([]string(nil), task.ServerIDs...)
	switch task.TaskType {
	case "command":
		if strings.TrimSpace(task.Command) == "" {
			return access.ErrResourceChanged
		}
	case "script":
		if task.ScriptID == nil {
			return access.ErrResourceChanged
		}
		var input script.ExecutionInput
		if json.Unmarshal([]byte(task.PayloadJSON), &input) != nil || input.Version == "" {
			return access.ErrResourceChanged
		}
		var row script.Script
		if err := db.WithContext(ctx).Select("id", "content", "language").First(&row, "id=?", *task.ScriptID).Error; err != nil {
			return err
		}
		if scriptutil.Version(row.Language, row.Content) != input.Version {
			return access.ErrResourceChanged
		}
	case "sftp_upload", "sftp_download":
		var payload struct {
			ServerID    string `json:"server_id"`
			StagedJobID string `json:"staged_job_id"`
		}
		if json.Unmarshal([]byte(task.PayloadJSON), &payload) != nil {
			return access.ErrResourceChanged
		}
		if task.TaskType == "sftp_upload" {
			var input struct{ TargetServerID string }
			if payload.StagedJobID == "" {
				return access.ErrResourceChanged
			}
			if err := db.WithContext(ctx).Table("transfer_jobs").Select("target_server_id").Where("id=? AND actor_kind=? AND actor_id=? AND scheduled_task_id=? AND artifact_cleaned_at IS NULL", payload.StagedJobID, protocol.Owner, task.OwnerID, task.ID).Take(&input).Error; err != nil {
				return err
			}
			ids = []string{input.TargetServerID}
		} else {
			ids = []string{payload.ServerID}
		}
	default:
		return access.ErrForbidden
	}
	if len(ids) == 0 || len(ids) > 100 {
		return access.ErrResourceChanged
	}
	for _, id := range ids {
		if parsed, err := uuid.Parse(id); err != nil || parsed == uuid.Nil {
			return access.ErrResourceChanged
		}
	}
	if stageServerID != "" && !slices.Contains(ids, stageServerID) {
		return access.ErrForbidden
	}
	if stageServerID != "" {
		ids = []string{stageServerID}
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	var count int64
	if err := db.WithContext(ctx).Table("servers").Where("id IN ? AND deleted_at IS NULL", ids).Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(ids)) {
		return access.ErrResourceChanged
	}
	return nil
}
