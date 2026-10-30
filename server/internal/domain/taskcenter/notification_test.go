package taskcenter

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestTerminalTaskAndNotificationIntentCommitTogether(t *testing.T) {
	db := newTaskCenterTestDB(t)
	ctx, actor := taskTestContext(t)
	repo := NewRepository(db, nil)
	run := TaskRun{Actor: actor, SourceType: "docker", SourceID: uuid.NewString(), TaskType: "docker_start", Status: StatusRunning}
	if err := repo.CreateWithEvent(ctx, &run, &TaskEvent{Level: "info", Message: "started"}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TRIGGER reject_completion_notice BEFORE INSERT ON notification_deliveries BEGIN SELECT RAISE(ABORT,'unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	updates := map[string]interface{}{"status": StatusSucceeded, "finished_at": time.Now().UTC()}
	if _, err := repo.Complete(ctx, run.ID, run.SourceType, updates); err == nil {
		t.Fatal("task committed without its notification intent")
	}
	var stored TaskRun
	if err := db.First(&stored, "id=?", run.ID).Error; err != nil || stored.Status != StatusRunning {
		t.Fatal("terminal state escaped rollback", stored.Status, err)
	}
	if err := db.Exec(`DROP TRIGGER reject_completion_notice`).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := repo.Complete(context.Background(), run.ID, run.SourceType, updates); err != nil {
			t.Fatal(err)
		}
	}
	var notices []NotificationDelivery
	if err := db.Find(&notices).Error; err != nil || len(notices) != 1 {
		t.Fatal("missing or duplicate completion intent", notices, err)
	}
	if notices[0].Channel != "completion" || notices[0].SourceID != run.ID.String() || notices[0].PayloadJSON != "" {
		t.Fatal("intent copied task body", notices[0])
	}
}
