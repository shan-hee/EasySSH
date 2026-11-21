package app

import (
	"context"
	"testing"
)

func TestDesktopCompletionAndInboxShareTransaction(t *testing.T) {
	tasks, id := desktopTaskFixture(t)
	notices := &DesktopNotificationService{db: tasks.db}
	if _, err := tasks.db.Exec(`CREATE TRIGGER reject_task_notice BEFORE INSERT ON desktop_notifications BEGIN SELECT RAISE(ABORT,'unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	outcome := desktopTaskCompletion{Status: "succeeded", ResultJSON: `{"observed":true}`, SuccessCount: 1, FinishedAt: desktopTaskNow()}
	if _, err := tasks.persistCompletion(context.Background(), id, outcome); err == nil {
		t.Fatal("task committed without notification")
	}
	var status string
	if err := tasks.db.QueryRow(`SELECT status FROM desktop_task_runs WHERE id=?`, id).Scan(&status); err != nil || status != "running" {
		t.Fatal("task escaped rollback", status, err)
	}
	if _, err := tasks.db.Exec(`DROP TRIGGER reject_task_notice`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := tasks.persistCompletion(context.Background(), id, outcome); err != nil {
			t.Fatal(err)
		}
	}
	list, err := notices.List(20)
	if err != nil || len(list.Notifications) != 1 || list.UnreadCount != 1 || list.Notifications[0].SourceID != id {
		t.Fatal("missing or duplicate inbox", list, err)
	}
	if list.Notifications[0].SourceType != "task_run" || list.Notifications[0].ActionURL != "" {
		t.Fatal("completion is tied to a host-specific UI route")
	}
	if err := notices.MarkRead(list.Notifications[0].ID); err != nil {
		t.Fatal(err)
	}
	list, err = notices.List(20)
	if err != nil || list.UnreadCount != 0 {
		t.Fatal("read state not persisted", list, err)
	}
	if err := notices.Delete(list.Notifications[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := tasks.persistCompletion(context.Background(), id, outcome); err != nil {
		t.Fatal(err)
	}
	list, err = notices.List(20)
	if err != nil || len(list.Notifications) != 0 {
		t.Fatal("completion retry recreated dismissed notification", list, err)
	}
}

func TestDesktopNotificationClearReadKeepsUnread(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	notices := &DesktopNotificationService{db: tasks.db}
	for _, title := range []string{"read", "unread"} {
		if err := notices.Publish("test", "info", title, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	list, err := notices.List(20)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range list.Notifications {
		if item.Title == "read" {
			if err := notices.MarkRead(item.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := notices.ClearRead(); err != nil {
		t.Fatal(err)
	}
	list, err = notices.List(20)
	if err != nil || len(list.Notifications) != 1 || list.Notifications[0].Title != "unread" || list.UnreadCount != 1 {
		t.Fatal("clear read removed the wrong notifications", list, err)
	}
}

func TestDesktopTaskCleanupRollsBackNotificationDeletion(t *testing.T) {
	tasks, id := desktopTaskFixture(t)
	if _, err := tasks.persistCompletion(context.Background(), id, desktopTaskCompletion{Status: "succeeded", FinishedAt: desktopTaskNow()}); err != nil {
		t.Fatal(err)
	}
	if _, err := tasks.db.Exec(`CREATE TRIGGER reject_notice_delete BEFORE DELETE ON desktop_notifications BEGIN SELECT RAISE(ABORT,'unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := tasks.cleanupWhere("id=?", id); err == nil {
		t.Fatal("cleanup ignored notification failure")
	}
	var count int
	if err := tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_task_runs WHERE id=?`, id).Scan(&count); err != nil || count != 1 {
		t.Fatal("task deletion escaped transaction", count, err)
	}
	if _, err := tasks.db.Exec(`DROP TRIGGER reject_notice_delete`); err != nil {
		t.Fatal(err)
	}
	result, err := tasks.cleanupWhere("id=?", id)
	if err != nil || result.DeletedCount != 1 || result.DeletedNotifications != 1 {
		t.Fatal("cleanup did not remove source and inbox", result, err)
	}
}

func TestDesktopNotificationFiltersMicroOpsAndCancellations(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	notices := &DesktopNotificationService{db: tasks.db}

	// Foreground SFTP micro-op success should stay silent.
	mkdirID, err := tasks.create(desktopTaskCreateInput{
		Actor: desktopLocalActor(), SourceType: "sftp_operation", TaskType: "sftp_mkdir", Title: "mkdir", TotalCount: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := tasks.start(mkdirID, "sftp_mkdir"); err != nil {
		t.Fatal(err)
	}
	if _, err := tasks.persistCompletion(context.Background(), mkdirID, desktopTaskCompletion{Status: "succeeded", SuccessCount: 1, FinishedAt: desktopTaskNow()}); err != nil {
		t.Fatal(err)
	}

	// User-canceled task should stay silent.
	cancelID, err := tasks.create(desktopTaskCreateInput{
		Actor: desktopLocalActor(), TaskType: "script", Title: "canceled script", TotalCount: 1, Cancelable: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := tasks.start(cancelID, "executing"); err != nil {
		t.Fatal(err)
	}
	if _, err := tasks.persistCompletion(context.Background(), cancelID, desktopTaskCompletion{Status: "canceled", FinishedAt: desktopTaskNow()}); err != nil {
		t.Fatal(err)
	}

	// Failed SFTP micro-op MUST still notify as critical error.
	failedWriteID, err := tasks.create(desktopTaskCreateInput{
		Actor: desktopLocalActor(), SourceType: "sftp_operation", TaskType: "sftp_write", Title: "write", TotalCount: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := tasks.start(failedWriteID, "sftp_write"); err != nil {
		t.Fatal(err)
	}
	if _, err := tasks.persistCompletion(context.Background(), failedWriteID, desktopTaskCompletion{Status: "failed", FailureCount: 1, ErrorMessage: "permission denied", FinishedAt: desktopTaskNow()}); err != nil {
		t.Fatal(err)
	}

	list, err := notices.List(20)
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Notifications) != 1 || list.Notifications[0].SourceID != failedWriteID || list.Notifications[0].Severity != "error" {
		t.Fatalf("expected only failed micro-op notification, got %+v", list.Notifications)
	}
}
