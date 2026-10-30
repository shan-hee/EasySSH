package app

import (
	"context"
	"testing"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/easyssh/shared/protocol"
)

func TestDesktopConfigurationOverviewReportsCommittedChangesAndRealCoverage(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	now := time.Now().UTC()
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if _, err := tasks.db.Exec(`UPDATE desktop_activity_coverage SET started_at=?,pruned_before='' WHERE id='activity'`, day.Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	files := NewDesktopSFTPService(nil, tasks, nil)
	for i := 0; i < 2; i++ {
		if err := files.SaveTransferLimits(protocol.TransferLimits{MaxEntries: 300, MaxDepth: 12}); err != nil {
			t.Fatal(err)
		}
	}
	activity := &ActivityLogService{db: tasks.db}
	result, err := activity.getOverview(context.Background(), DesktopActivityOverviewRequest{Type: activitystats.TypeAudit, Timezone: "UTC"}, time.Now().UTC())
	if err != nil || result.Volume.ConfigurationChanges != 1 || result.Total != 1 || !result.Coverage.CompleteWindow || len(result.Coverage.UnavailableMetrics) != 0 {
		t.Fatalf("committed configuration is unavailable or double counted: %+v %v", result, err)
	}
	if _, err := tasks.db.Exec(`UPDATE desktop_activity_coverage SET pruned_before=? WHERE id='activity'`, now.Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	result, err = activity.getOverview(context.Background(), DesktopActivityOverviewRequest{Type: activitystats.TypeAudit, Timezone: "UTC"}, time.Now().UTC())
	if err != nil || result.Coverage.CompleteWindow {
		t.Fatalf("retention gap hidden: %+v %v", result.Coverage, err)
	}
}

func insertDesktopActivityFixture(t *testing.T, s *DesktopTaskService, item DesktopActivityLogItem) {
	t.Helper()
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err = upsertDesktopActivity(tx, item); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopOverviewKeepsRetryAndResourceHistory(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	day := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	finish := day.Add(time.Hour)
	for _, i := range []int{1, 2} {
		status := DesktopActivityLogFailure
		id := "first"
		server := "old"
		if i == 2 {
			status = DesktopActivityLogSuccess
			id = "second"
			server = "new"
		}
		insertDesktopActivityFixture(t, tasks, DesktopActivityLogItem{Actor: desktopLocalActor(), ID: id, WorkID: "logical", WorkStartedAt: day.Format(time.RFC3339Nano), Attempt: i, SourceTable: "test_source", SourceID: id, Action: "script", Status: status, ServerID: server, ServerName: "name at execution", StartedAt: day.Format(time.RFC3339Nano), FinishedAt: finish.Format(time.RFC3339Nano), CreatedAt: day.Add(time.Duration(i) * time.Minute).Format(time.RFC3339Nano)})
	}
	activity := &ActivityLogService{db: tasks.db}
	result, err := activity.getOverview(context.Background(), DesktopActivityOverviewRequest{ServerID: "old", History: "recovered"}, day.Add(12*time.Hour))
	if err != nil || result.Volume.Works != 1 || result.Volume.Attempts != 2 || result.Volume.Recovered != 1 || result.Total != 1 || result.Records[0].ID != "second" || len(result.Records[0].Resources) != 2 {
		t.Fatalf("desktop chain diverged: %+v %v", result, err)
	}
	if result.Coverage.CompleteWindow {
		t.Fatal("history before collection start reported complete")
	}
	for _, resource := range result.Records[0].Resources {
		if !resource.Deleted || resource.Name != "name at execution" {
			t.Fatalf("missing historical server shown as live: %+v", resource)
		}
	}
}

func TestDesktopHistoryClearKeepsActiveFamilyAndAdvancesCoverage(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	old := time.Now().UTC().AddDate(0, 0, -10).Format(time.RFC3339Nano)
	for _, row := range []struct{ id, work, parent, status string }{{"old-failure", "active-family", "", "failure"}, {"active-retry", "active-family", "", "running"}, {"active-child", "child", "active-family", "success"}, {"done", "done", "", "success"}} {
		finished := old
		if row.status == "running" {
			finished = ""
		}
		attempt := 1
		if row.id == "active-retry" {
			attempt = 2
		}
		insertDesktopActivityFixture(t, tasks, DesktopActivityLogItem{Actor: desktopLocalActor(), ID: row.id, WorkID: row.work, ParentWorkID: row.parent, WorkStartedAt: old, Attempt: attempt, SourceTable: "test_source", SourceID: row.id, Action: "script", Status: DesktopActivityLogStatus(row.status), StartedAt: old, FinishedAt: finished, CreatedAt: old, Resources: []activitystats.Resource{{ServerID: "deleted-server", Name: "historical"}}})
	}
	activity := &ActivityLogService{db: tasks.db}
	count, err := activity.Clear("")
	if err != nil || count != 1 {
		t.Fatalf("active retry family pruned: %d %v", count, err)
	}
	var remaining int
	if err = tasks.db.QueryRow(`SELECT COUNT(*) FROM activity_logs WHERE work_id IN ('active-family','child')`).Scan(&remaining); err != nil || remaining != 3 {
		t.Fatalf("partial family retained: %d %v", remaining, err)
	}
	var boundary string
	if err = tasks.db.QueryRow(`SELECT pruned_before FROM desktop_activity_coverage WHERE id='activity'`).Scan(&boundary); err != nil || boundary == "" {
		t.Fatalf("coverage not advanced: %s %v", boundary, err)
	}
	var resources int
	if err = tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_activity_resources WHERE activity_id='done'`).Scan(&resources); err != nil || resources != 0 {
		t.Fatalf("resource cleanup not atomic: %d %v", resources, err)
	}
}

func TestDesktopOverviewRejectsOtherActorBeforeCounting(t *testing.T) {
	tasks, _ := desktopTaskFixture(t)
	day := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	other := desktopLocalActor()
	other.ID = "another-owner"
	insertDesktopActivityFixture(t, tasks, DesktopActivityLogItem{Actor: other, ID: "other", WorkID: "other", WorkStartedAt: day.Format(time.RFC3339Nano), Attempt: 1, SourceTable: "test_source", SourceID: "other", Action: "script", Status: DesktopActivityLogFailure, CreatedAt: day.Format(time.RFC3339Nano), FinishedAt: day.Add(time.Hour).Format(time.RFC3339Nano)})
	result, err := (&ActivityLogService{db: tasks.db}).getOverview(context.Background(), DesktopActivityOverviewRequest{}, day.Add(12*time.Hour))
	if err != nil || result.Volume.Works != 0 || result.Total != 0 {
		t.Fatalf("other actor counted: %+v %v", result, err)
	}
}
