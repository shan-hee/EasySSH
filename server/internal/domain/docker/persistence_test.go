package docker

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/operationrecord"
	serverdomain "github.com/easyssh/server/internal/domain/server"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestDockerResultAndActivityCommitTogetherWithStableEndTime(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&taskcenter.NotificationDelivery{}, &taskcenter.TaskRun{}, &taskcenter.TaskEvent{}, &operationrecord.OperationRecord{}, &operationrecord.Resource{}, &serverdomain.Server{}, &serverdomain.ServerAuth{}, &serverdomain.ServerTag{}, &serverdomain.ServerGroup{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	repo := taskcenter.NewRepository(db, nil)
	tasks := taskcenter.NewService(repo, nil)
	s := NewService(nil, tasks, repo)
	defer s.Stop(context.Background())
	ctx := dockerContext(t, "session")
	server := uuid.NewString()
	container := uuid.NewString()
	if err = db.Create(&serverdomain.Server{ID: uuid.MustParse(server), Name: "Docker host", Host: "localhost", Username: "owner"}).Error; err != nil {
		t.Fatal(err)
	}
	calls := 0
	result, err := s.apply(ctx, server, container, protocol.DockerActionRestart, false, func(context.Context, string) error { calls++; return nil })
	if err != nil || result.Status != "succeeded" {
		t.Fatalf("result: %+v %v", result, err)
	}
	id := uuid.MustParse(result.TaskID)
	initial, err := repo.GetAny(ctx, id)
	if err != nil || initial.FinishedAt == nil {
		t.Fatalf("missing committed source: %+v %v", initial, err)
	}
	observedAt := *initial.FinishedAt
	run, err := repo.GetAny(ctx, id)
	if err != nil || run.FinishedAt == nil || !run.FinishedAt.Equal(observedAt) || run.SuccessCount != 1 || run.ServerName != "Docker host" {
		t.Fatalf("end time drifted: %+v %v", run, err)
	}
	var records []operationrecord.OperationRecord
	if err = db.Find(&records).Error; err != nil || len(records) != 1 || records[0].Status != operationrecord.StatusSuccess || records[0].ServerID == nil || records[0].ServerID.String() != server {
		t.Fatalf("UUID container created phantom target: %+v %v", records, err)
	}
	if err = tasks.CompleteDocker(ctx, id, taskcenter.StatusSucceeded, run.ResultJSON, "", "", 1, 0, observedAt); err != nil {
		t.Fatalf("identical receipt not idempotent: %v", err)
	}
	if err = tasks.CompleteDocker(ctx, id, taskcenter.StatusSucceeded, run.ResultJSON, "", "", 1, 0, observedAt.Add(time.Second)); !errors.Is(err, taskcenter.ErrObservedOutcomeConflict) {
		t.Fatalf("late receipt rewrote observed time: %v", err)
	}
}
