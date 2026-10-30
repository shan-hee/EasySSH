package inboxnotification

import (
	"context"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func deliveryFixture(t *testing.T) (*gorm.DB, Repository, Delivery, Notification) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	if err := db.AutoMigrate(&taskcenter.TaskRun{}, &Notification{}, &Delivery{}); err != nil {
		t.Fatal(err)
	}
	run := taskcenter.TaskRun{ID: uuid.New(), Status: taskcenter.StatusSucceeded, Title: "completed"}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	item := Notification{ID: uuid.New(), OwnerID: uuid.New(), SourceType: "task_run", SourceID: run.ID.String(), Title: "completed", Message: "result", EventType: "task.succeeded", Severity: "success"}
	pending := Delivery{NotificationID: item.ID, SourceType: item.SourceType, SourceID: item.SourceID, Channel: "completion", Status: "queued", PayloadJSON: "", NextAttemptAt: time.Now().Add(-time.Minute)}
	if err := db.Create(&pending).Error; err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db)
	claimed, err := repo.ClaimDueDeliveries(context.Background(), time.Now(), time.Now().Add(-2*time.Minute), 20)
	if err != nil || len(claimed) != 1 {
		t.Fatal("completion not claimed", claimed, err)
	}
	return db, repo, claimed[0], item
}

func TestCompletionMaterializationIsAtomicAndCannotResurrectDeletedInbox(t *testing.T) {
	db, repo, pending, item := deliveryFixture(t)
	ctx := context.Background()
	channels := []*Delivery{{NotificationID: item.ID, SourceType: item.SourceType, SourceID: item.SourceID, Channel: "email", PayloadJSON: "{}"}}
	if err := db.Exec(`CREATE TRIGGER reject_external BEFORE INSERT ON notification_deliveries WHEN NEW.channel='email' BEGIN SELECT RAISE(ABORT,'unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CommitCompletion(ctx, &pending, &item, true, channels); err == nil {
		t.Fatal("accepted partial notification transaction")
	}
	var count int64
	if err := db.Model(&Notification{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("inbox escaped rollback", count, err)
	}
	if err := db.Exec(`DROP TRIGGER reject_external`).Error; err != nil {
		t.Fatal(err)
	}
	if created, err := repo.CommitCompletion(ctx, &pending, &item, true, channels); err != nil || !created {
		t.Fatal("completion not materialized", created, err)
	}
	if created, err := repo.CommitCompletion(ctx, &pending, &item, true, channels); err != nil || created {
		t.Fatal("duplicate completion", created, err)
	}
	if err := db.Model(&Delivery{}).Where("channel='email'").Count(&count).Error; err != nil || count != 1 {
		t.Fatal("duplicate external channel", count, err)
	}
	if err := repo.Delete(ctx, item.OwnerID, item.ID); err != nil {
		t.Fatal(err)
	}
	if created, err := repo.CommitCompletion(ctx, &pending, &item, true, channels); err != nil || created {
		t.Fatal("deleted inbox recreated", created, err)
	}
}

func TestCompletionSurvivesRestartAndExternalAttemptLimit(t *testing.T) {
	db, repo, pending, item := deliveryFixture(t)
	stale := time.Now().Add(-10 * time.Minute)
	if err := db.Model(&Delivery{}).Where("id=?", pending.ID).Updates(map[string]any{"locked_at": stale, "attempt_count": 5}).Error; err != nil {
		t.Fatal(err)
	}
	external := Delivery{NotificationID: item.ID, SourceType: item.SourceType, SourceID: item.SourceID, Channel: "email", Status: "sending", LockedAt: &stale, AttemptCount: 5, MaxAttempts: 5, PayloadJSON: "{}"}
	if err := db.Create(&external).Error; err != nil {
		t.Fatal(err)
	}
	claimed, err := repo.ClaimDueDeliveries(context.Background(), time.Now(), time.Now().Add(-2*time.Minute), 20)
	if err != nil || len(claimed) != 1 || claimed[0].Channel != "completion" {
		t.Fatal("completion stranded behind channel attempt limit", claimed, err)
	}
	if err := db.First(&external, "id=?", external.ID).Error; err != nil || external.Status != "failed" {
		t.Fatal("exhausted external delivery stayed queued", external.Status, err)
	}
	if err := db.Delete(&taskcenter.TaskRun{}, "id=?", pending.SourceID).Error; err != nil {
		t.Fatal(err)
	}
	if created, err := repo.CommitCompletion(context.Background(), &claimed[0], &item, true, nil); err != nil || created {
		t.Fatal("pruned source generated a notification", created, err)
	}
}
