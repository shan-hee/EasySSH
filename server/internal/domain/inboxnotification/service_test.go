package inboxnotification

import (
	"context"
	"strings"
	"testing"

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
