package transferjob

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/easyssh/server/internal/access"
	"github.com/easyssh/server/internal/domain/scheduledtask"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func TestScheduledTransferRechecksDefinitionBeforeOpeningSFTP(t *testing.T) {
	ctx := transferTestContext(t, protocol.Owner)
	db := transferOutcomeDB(t)
	target := serverdomain.Server{ID: uuid.New(), Host: "test.invalid", Port: 22, Username: "fixture"}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(ScheduledPayload{ServerID: target.ID.String(), SourcePath: "/tmp/input"})
	definition := scheduledtask.ScheduledTask{ID: uuid.New(), OwnerID: uuid.MustParse(access.Current(ctx).Actor().ID), TaskName: "download", TaskType: "sftp_download", PayloadJSON: string(payload), Enabled: true, CronExpression: "0 * * * *"}
	if err := db.Create(&definition).Error; err != nil {
		t.Fatal(err)
	}
	tasks := taskcenter.NewService(taskcenter.NewRepository(db, nil), nil)
	run := &taskcenter.TaskRun{Actor: access.Current(ctx).Actor(), DefinitionID: &definition.ID, DefinitionVersion: definition.Version(), TaskType: definition.TaskType, Title: "download", SourceType: "scheduled_task", SourceID: definition.ID.String(), Status: taskcenter.StatusRunning, TriggerType: taskcenter.TriggerScheduled}
	if err := tasks.Create(ctx, run); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db, nil, nil)
	job := &TransferJob{Actor: run.Actor, TaskRunID: &run.ID, ScheduledTaskID: &definition.ID, Name: "download", Kind: JobKindSFTPDownload, Status: JobStatusRunning, Stage: JobStageDownloadFromRemote, SourceServerID: &target.ID, SourcePath: "/tmp/input"}
	if err := repo.Create(ctx, job); err != nil {
		t.Fatal(err)
	}
	if err := repo.CheckScheduledStage(ctx, job); err != nil {
		t.Fatalf("valid handoff rejected: %v", err)
	}
	if err := scheduledtask.NewRepository(db).Update(ctx, definition.ID, map[string]any{"payload_json": "{}"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.CheckScheduledStage(ctx, job); !errors.Is(err, access.ErrResourceChanged) {
		t.Fatalf("stale handoff accepted: %v", err)
	}
	// A nil network pool makes accidental network dispatch fail this scenario.
	service := &service{repo: repo, taskRuns: tasks}
	if err := service.executeDownload(ctx, job); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.GetByID(ctx, job.ID)
	if err != nil || stored.Status != JobStatusFailed || stored.BytesProcessed != 0 || stored.ErrorMessage != access.ErrResourceChanged.Error() {
		t.Fatalf("rejection not persisted: %+v %v", stored, err)
	}
}
