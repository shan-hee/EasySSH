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
