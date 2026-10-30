package operationrecord

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestActivityCalendarWindowUsesLocalDates(t *testing.T) {
	for _, tc := range []struct {
		zone, date string
		hours      float64
	}{
		{"America/New_York", "2026-03-08", 23},
		{"America/New_York", "2026-11-01", 25},
		{"Australia/Lord_Howe", "2026-10-04", 23.5},
		{"Asia/Kathmandu", "2026-10-28", 24},
	} {
		t.Run(tc.zone+tc.date, func(t *testing.T) {
			start, end, loc, err := activityWindow(OverviewRequest{Timezone: tc.zone, Range: "custom", StartDate: tc.date, EndDate: tc.date}, time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC))
			if err != nil {
				t.Fatal(err)
			}
			if end.Sub(start).Hours() != tc.hours {
				t.Fatalf("duration %s", end.Sub(start))
			}
			local := start.In(loc)
			if local.Hour() != 0 || local.Minute() != 0 {
				t.Fatalf("not local midnight: %v", local)
			}
		})
	}
}

func TestOverviewSeparatesRetryVolumeCompletionAndCarryOver(t *testing.T) {
	day := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	firstEnd, retryEnd := day.Add(time.Hour), day.Add(2*time.Hour)
	work, oldWork, activeWork := uuid.New(), uuid.New(), uuid.New()
	rows := []OperationRecordSummary{
		{ID: uuid.New(), WorkID: work, WorkStartedAt: day, CreatedAt: day, Attempt: 1, Type: TypeExecution, Status: StatusFailure, FinishedAt: &firstEnd},
		{ID: uuid.New(), WorkID: work, WorkStartedAt: day, CreatedAt: firstEnd, Attempt: 2, Type: TypeExecution, Status: StatusSuccess, FinishedAt: &retryEnd},
		{ID: uuid.New(), WorkID: oldWork, WorkStartedAt: day.Add(-time.Hour), CreatedAt: day.Add(-time.Hour), Attempt: 1, Type: TypeExecution, Status: StatusSuccess, FinishedAt: &retryEnd},
		{ID: uuid.New(), WorkID: activeWork, WorkStartedAt: day.Add(-time.Hour), CreatedAt: day.Add(-time.Hour), Attempt: 1, Type: TypeExecution, Status: StatusRunning},
		{ID: uuid.New(), WorkID: uuid.New(), ParentWorkID: &work, WorkStartedAt: day, CreatedAt: day, Attempt: 1, Type: TypeExecution, Status: StatusSuccess, FinishedAt: &retryEnd},
	}
	result := &Overview{Start: day, End: day.AddDate(0, 0, 1), AsOf: day.Add(12 * time.Hour), Volume: newMetrics(), Targets: newMetrics()}
	result.aggregate(rows, nil, OverviewRequest{Page: 1, PageSize: 20}, time.UTC)
	if result.Volume.Works != 1 || result.Volume.Attempts != 2 || result.Volume.Retries != 1 || result.Targets.Works != 1 {
		t.Fatalf("volume %+v targets %+v", result.Volume, result.Targets)
	}
	if result.ResultEvents.Completed != 2 || result.ResultEvents.Failed != 1 || result.CarryOver != 1 {
		t.Fatalf("events %+v carry %d", result.ResultEvents, result.CarryOver)
	}
	if result.Total != 1 || len(result.Records) != 1 || result.Records[0].Status != StatusSuccess {
		t.Fatalf("records %+v", result.Records)
	}
}

func TestOverviewFiltersActorBeforeAggregation(t *testing.T) {
	db := newOperationRecordTestDB(t)
	repo := NewRepository(db, nil)
	ctx, actor := activityTestContext(t)
	_, other := activityTestContext(t)
	for _, a := range []struct{ record OperationRecord }{
		{OperationRecord{Actor: actor, Type: TypeExecution, Action: "command", Status: StatusSuccess, SourceTable: "task_runs", SourceID: uuid.NewString()}},
		{OperationRecord{Actor: other, Type: TypeExecution, Action: "command", Status: StatusFailure, SourceTable: "task_runs", SourceID: uuid.NewString()}},
	} {
		record := a.record
		if err := repo.Upsert(context.Background(), &record); err != nil {
			t.Fatal(err)
		}
	}
	result, err := repo.Overview(ctx, OverviewRequest{Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Volume.Works != 1 || result.Volume.ByStatus[StatusFailure] != 0 || result.Total != 1 {
		t.Fatalf("cross-actor activity exposed: %+v", result)
	}
	if result.Coverage.Known {
		t.Fatal("missing coverage must not imply complete history")
	}
}

func TestProjectionRetainsResourceIdentityAndName(t *testing.T) {
	db := newOperationRecordTestDB(t)
	repo := NewRepository(db, nil)
	ctx, actor := activityTestContext(t)
	sourceID, serverID := uuid.NewString(), uuid.New()
	first := &OperationRecord{Actor: actor, Type: TypeExecution, Action: "command", Status: StatusRunning, SourceTable: "task_runs", SourceID: sourceID, Resources: []ResourceSnapshot{{ServerID: serverID, Name: "original"}}}
	if err := repo.Upsert(ctx, first); err != nil {
		t.Fatal(err)
	}
	second := &OperationRecord{ID: uuid.New(), Actor: actor, Type: TypeExecution, Action: "command", Status: StatusSuccess, SourceTable: "task_runs", SourceID: sourceID, ServerID: &serverID, Resources: []ResourceSnapshot{{ServerID: serverID, Name: "renamed"}}}
	if err := repo.Upsert(ctx, second); err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatal("duplicate source changed stored identity")
	}
	got, err := repo.GetByID(ctx, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Resources) != 1 || got.Resources[0].Name != "original" {
		t.Fatalf("snapshot changed: %+v", got.Resources)
	}
	if !got.Resources[0].Deleted {
		t.Fatal("missing server was not marked deleted")
	}
	if err := db.Exec("INSERT INTO servers(id) VALUES(?)", serverID).Error; err != nil {
		t.Fatal(err)
	}
	got, err = repo.GetByID(ctx, first.ID)
	if err != nil || len(got.Resources) != 1 || got.Resources[0].Deleted || got.Resources[0].Name != "original" {
		t.Fatal("live resource observation changed historical name", err)
	}
	if err := db.Exec("UPDATE servers SET deleted_at=? WHERE id=?", time.Now().UTC(), serverID).Error; err != nil {
		t.Fatal(err)
	}
	got, err = repo.GetByID(ctx, first.ID)
	if err != nil || len(got.Resources) != 1 || !got.Resources[0].Deleted {
		t.Fatal("soft deletion was not observed", err)
	}
}

func TestOverviewServerFilterKeepsNewerRetryOnAnotherResource(t *testing.T) {
	db := newOperationRecordTestDB(t)
	repo := NewRepository(db, nil)
	ctx, actor := activityTestContext(t)
	work, firstServer, secondServer := uuid.New(), uuid.New(), uuid.New()
	started := time.Now().UTC().Add(-time.Minute)
	ended := started.Add(30 * time.Second)
	for _, attempt := range []int{1, 2} {
		server, status := firstServer, StatusFailure
		if attempt == 2 {
			server, status = secondServer, StatusSuccess
		}
		record := &OperationRecord{Actor: actor, WorkID: work, WorkStartedAt: started, Attempt: attempt, Type: TypeExecution, Action: "command", Status: status, SourceTable: "task_runs", SourceID: uuid.NewString(), CreatedAt: started.Add(time.Duration(attempt) * time.Second), FinishedAt: &ended, Resources: []ResourceSnapshot{{ServerID: server, Name: "snapshot"}}}
		if err := repo.Upsert(ctx, record); err != nil {
			t.Fatal(err)
		}
	}
	result, err := repo.Overview(ctx, OverviewRequest{Range: "seven_days", ServerID: &firstServer, History: "recovered"})
	if err != nil || result.Total != 1 || result.Volume.Works != 1 || result.Volume.Attempts != 2 || result.Volume.Recovered != 1 || result.Records[0].Status != StatusSuccess {
		t.Fatalf("resource predicate hid the later retry: %+v %v", result, err)
	}
}
