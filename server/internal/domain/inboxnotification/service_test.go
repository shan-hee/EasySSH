package inboxnotification

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/server/internal/domain/auth"
	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/google/uuid"
)

type notificationOwnerFixture struct {
	auth.Repository
	owner *auth.Owner
}

func (r notificationOwnerFixture) Get(context.Context) (*auth.Owner, error) { return r.owner, nil }

func TestCompletionUsesOwnerPreferencesAndOnlySourceSummary(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		t.Run(map[bool]string{false: "disabled", true: "enabled"}[enabled], func(t *testing.T) {
			db, repo, pending, item := deliveryFixture(t)
			// No file for this reference is present. Notification preparation must
			// use metadata without loading task output or its execution payload.
			if err := db.Model(&taskcenter.TaskRun{}).Where("id=?", pending.SourceID).Updates(map[string]any{"content_id": uuid.New(), "title": strings.Repeat("source title ", 1000)}).Error; err != nil {
				t.Fatal(err)
			}
			owner := &auth.Owner{ID: item.OwnerID, NotifyTaskSuccess: true, NotifyTaskInApp: enabled}
			service := NewService(repo, notificationOwnerFixture{owner: owner}, nil, nil, nil).(*service)
			for range 2 {
				if err := service.prepareCompletion(context.Background(), &pending); err != nil {
					t.Fatal(err)
				}
			}
			var notifications []Notification
			if err := db.Find(&notifications).Error; err != nil {
				t.Fatal(err)
			}
			if enabled {
				if len(notifications) != 1 || len(notifications[0].Message) > 1024 || !strings.HasSuffix(notifications[0].Message, "…") {
					t.Fatal("missing or unbounded summary", notifications)
				}
				if notifications[0].SourceType != "task_run" || notifications[0].SourceID != pending.SourceID || notifications[0].ActionURL != "" {
					t.Fatal("completion does not identify the source independently of UI routes")
				}
			} else if len(notifications) != 0 {
				t.Fatal("disabled inbox created a notification")
			}
			if err := db.First(&pending, "id=?", pending.ID).Error; err != nil || pending.Status != "sent" {
				t.Fatal("completion not settled", pending.Status, err)
			}
		})
	}
}

func TestCompletionNoiseFilteringAndScheduledRecovery(t *testing.T) {
	t.Run("foreground micro-op success does not create notification", func(t *testing.T) {
		db, repo, pending, item := deliveryFixture(t)
		if err := db.Model(&taskcenter.TaskRun{}).Where("id=?", pending.SourceID).Updates(map[string]any{
			"source_type": "sftp_operation",
			"task_type":   "sftp_mkdir",
			"status":      taskcenter.StatusSucceeded,
		}).Error; err != nil {
			t.Fatal(err)
		}
		owner := &auth.Owner{ID: item.OwnerID, NotifyTaskSuccess: true, NotifyTaskFailure: true, NotifyTaskInApp: true, NotifyTaskExternal: true}
		service := NewService(repo, notificationOwnerFixture{owner: owner}, nil, nil, nil).(*service)
		if err := service.prepareCompletion(context.Background(), &pending); err != nil {
			t.Fatal(err)
		}
		var count int64
		if err := db.Model(&Notification{}).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("foreground micro-op created %d notifications", count)
		}
	})

	t.Run("foreground micro-op failure creates critical notification", func(t *testing.T) {
		db, repo, pending, item := deliveryFixture(t)
		if err := db.Model(&taskcenter.TaskRun{}).Where("id=?", pending.SourceID).Updates(map[string]any{
			"source_type": "sftp_operation",
			"task_type":   "sftp_write",
			"status":      taskcenter.StatusFailed,
		}).Error; err != nil {
			t.Fatal(err)
		}
		owner := &auth.Owner{ID: item.OwnerID, NotifyTaskSuccess: true, NotifyTaskFailure: true, NotifyTaskInApp: true}
		service := NewService(repo, notificationOwnerFixture{owner: owner}, nil, nil, nil).(*service)
		if err := service.prepareCompletion(context.Background(), &pending); err != nil {
			t.Fatal(err)
		}
		var notifications []Notification
		if err := db.Find(&notifications).Error; err != nil || len(notifications) != 1 || notifications[0].Severity != "error" {
			t.Fatalf("expected critical notification, got %+v %v", notifications, err)
		}
	})

	t.Run("scheduled task notifies on recovery from failure but not routine success", func(t *testing.T) {
		db, repo, pending, item := deliveryFixture(t)
		defID := uuid.New()
		if err := db.Model(&taskcenter.TaskRun{}).Where("id=?", pending.SourceID).Updates(map[string]any{
			"definition_id": defID,
			"trigger_type":  taskcenter.TriggerScheduled,
			"task_type":     "command",
			"status":        taskcenter.StatusSucceeded,
		}).Error; err != nil {
			t.Fatal(err)
		}
		owner := &auth.Owner{ID: item.OwnerID, NotifyTaskSuccess: true, NotifyTaskFailure: true, NotifyTaskInApp: true}
		svc := NewService(repo, notificationOwnerFixture{owner: owner}, nil, nil, nil).(*service)
		// Without prior failure, routine scheduled success stays silent.
		if err := svc.prepareCompletion(context.Background(), &pending); err != nil {
			t.Fatal(err)
		}
		var count int64
		if err := db.Model(&Notification{}).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("routine scheduled success created %d notifications", count)
		}

		// With a previous failed run for the same definition, recovery notifies.
		db2, repo2, pending2, item2 := deliveryFixture(t)
		prevRun := taskcenter.TaskRun{
			ID: uuid.New(), DefinitionID: &defID, TriggerType: taskcenter.TriggerScheduled,
			TaskType: "command", Title: "cron", Status: taskcenter.StatusFailed,
			CreatedAt: time.Now().UTC().Add(-time.Minute),
		}
		if err := db2.Create(&prevRun).Error; err != nil {
			t.Fatal(err)
		}
		if err := db2.Model(&taskcenter.TaskRun{}).Where("id=?", pending2.SourceID).Updates(map[string]any{
			"definition_id": defID,
			"trigger_type":  taskcenter.TriggerScheduled,
			"task_type":     "command",
			"status":        taskcenter.StatusSucceeded,
		}).Error; err != nil {
			t.Fatal(err)
		}
		owner2 := &auth.Owner{ID: item2.OwnerID, NotifyTaskSuccess: true, NotifyTaskFailure: true, NotifyTaskInApp: true}
		svc2 := NewService(repo2, notificationOwnerFixture{owner: owner2}, nil, nil, nil).(*service)
		if err := svc2.prepareCompletion(context.Background(), &pending2); err != nil {
			t.Fatal(err)
		}
		var recovered []Notification
		if err := db2.Find(&recovered).Error; err != nil || len(recovered) != 1 || recovered[0].EventType != "task.recovered" {
			t.Fatalf("expected recovery notification, got %+v %v", recovered, err)
		}
	})
}
