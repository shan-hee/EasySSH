package scheduledtask

import (
	"encoding/json"
	"slices"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/operationrecord"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func configurationFields(before, after ScheduledTask) []string {
	sameScript := before.ScriptID == nil && after.ScriptID == nil || before.ScriptID != nil && after.ScriptID != nil && *before.ScriptID == *after.ScriptID
	fields := []string{}
	for _, field := range []struct {
		name    string
		changed bool
	}{
		{"task_name", before.TaskName != after.TaskName}, {"task_type", before.TaskType != after.TaskType},
		{"script_id", !sameScript}, {"command", before.Command != after.Command}, {"payload_json", before.PayloadJSON != after.PayloadJSON},
		{"server_ids", !slices.Equal(before.ServerIDs, after.ServerIDs)}, {"cron_expression", before.CronExpression != after.CronExpression},
		{"timezone", before.Timezone != after.Timezone}, {"enabled", before.Enabled != after.Enabled}, {"description", before.Description != after.Description},
	} {
		if field.changed {
			fields = append(fields, field.name)
		}
	}
	return fields
}

func recordConfiguration(tx *gorm.DB, action string, row ScheduledTask, fields []string, before *ScheduledTask) error {
	ids := append([]string(nil), row.ServerIDs...)
	definitions := []ScheduledTask{row}
	if before != nil {
		ids = append(ids, before.ServerIDs...)
		definitions = append(definitions, *before)
	}
	for _, definition := range definitions {
		if isSFTPTaskType(definition.TaskType) {
			var payload struct {
				ServerID string `json:"server_id"`
			}
			if err := json.Unmarshal([]byte(definition.PayloadJSON), &payload); err != nil {
				return err
			}
			if payload.ServerID != "" {
				ids = append(ids, payload.ServerID)
			}
		}
	}
	resources := []operationrecord.ResourceSnapshot{}
	seen := map[uuid.UUID]bool{}
	for _, raw := range ids {
		id, err := uuid.Parse(raw)
		if err != nil || id == uuid.Nil {
			return ErrInvalidScheduledTaskData
		}
		if !seen[id] {
			resources = append(resources, operationrecord.ResourceSnapshot{ServerID: id})
			seen[id] = true
		}
	}
	if len(resources) > 0 {
		var names []operationrecord.ResourceSnapshot
		if err := tx.Table("servers").Select("id AS server_id, name").Where("id IN ?", ids).Scan(&names).Error; err != nil {
			return err
		}
		byID := map[uuid.UUID]string{}
		for _, resource := range names {
			byID[resource.ServerID] = resource.Name
		}
		for i := range resources {
			resources[i].Name = byID[resources[i].ServerID]
		}
	}
	return operationrecord.RecordConfiguration(tx, access.Current(tx.Statement.Context).Actor(), operationrecord.ConfigurationChange{
		Action: action, ResourceKind: "scheduled_task", ResourceID: row.ID.String(), Name: row.TaskName, Source: "manual", Fields: fields, Resources: resources,
	})
}
