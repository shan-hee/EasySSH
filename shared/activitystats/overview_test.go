package activitystats

import (
	"testing"
	"time"
)

func TestConnectionEstablishmentUsesActualDayInsteadOfAttemptDay(t *testing.T) {
	day := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	started, established, finished := day.Add(-time.Minute), day.Add(time.Minute), day.Add(2*time.Minute)
	rows := []Fact{
		{ID: "connected", WorkID: "connected", WorkStartedAt: started, CreatedAt: started, Attempt: 1, Type: TypeConnection, Status: StatusSuccess, EstablishedAt: &established, FinishedAt: &finished},
		{ID: "failed", WorkID: "failed", WorkStartedAt: started, CreatedAt: started, Attempt: 1, Type: TypeConnection, Status: StatusFailure, FinishedAt: &finished},
	}
	resources := map[string][]Resource{"connected": {{ServerID: "server", Name: "server"}}}
	result, err := Aggregate(rows, resources, Request{}, day.Add(time.Hour), OverviewCoverage{})
	if err != nil || result.Volume.Works != 0 || result.Volume.Connections != 1 || result.Volume.ConnectionFailures != 1 || result.Volume.Servers != 1 || result.ConnectionDurationMs != time.Minute.Milliseconds() || result.Total != 1 {
		t.Fatalf("connection inherited attempt date: %+v %v", result, err)
	}
	previous, err := Aggregate(rows, resources, Request{Range: "custom", StartDate: "2026-10-27", EndDate: "2026-10-27"}, day.Add(time.Hour), OverviewCoverage{})
	if err != nil || previous.Volume.Connections != 0 || previous.Volume.ConnectionFailures != 0 || previous.Volume.Works != 2 {
		t.Fatalf("future result counted on attempt day: %+v %v", previous, err)
	}
}

func TestCalendarDayBoundaries(t *testing.T) {
	for _, tc := range []struct {
		zone, date string
		hours      float64
	}{
		{"America/New_York", "2026-03-08", 23}, {"America/New_York", "2026-11-01", 25},
		{"Australia/Lord_Howe", "2026-10-04", 23.5}, {"Asia/Kathmandu", "2026-10-28", 24},
		{"America/Sao_Paulo", "2018-11-04", 23},
	} {
		t.Run(tc.zone+tc.date, func(t *testing.T) {
			start, end, loc, err := Window(Request{Timezone: tc.zone, Range: "custom", StartDate: tc.date, EndDate: tc.date}, time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC))
			if err != nil || end.Sub(start).Hours() != tc.hours || start.In(loc).Format("2006-01-02") != tc.date {
				t.Fatalf("wrong civil window: %v %v %v", start, end, err)
			}
		})
	}
	if _, _, _, err := Window(Request{Timezone: "Pacific/Apia", Range: "custom", StartDate: "2011-12-30", EndDate: "2011-12-30"}, time.Now()); err == nil {
		t.Fatal("entirely skipped date accepted")
	}
}

func TestRetryHistoryServerFilterAndTargetCountsShareOneWork(t *testing.T) {
	day := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	finish := day.Add(time.Hour)
	rows := []Fact{
		{ID: "failed", WorkID: "work", WorkStartedAt: day, CreatedAt: day, Attempt: 1, Type: TypeTransfer, Status: StatusFailure, Source: "manual", FinishedAt: &finish, BytesProcessed: 8},
		{ID: "success", WorkID: "work", WorkStartedAt: day, CreatedAt: finish, Attempt: 2, Type: TypeTransfer, Status: StatusSuccess, Source: "manual", FinishedAt: &finish, SuccessCount: 1, BytesProcessed: 10, BytesCompleted: 10},
		{ID: "target", WorkID: "child", ParentWorkID: "work", WorkStartedAt: day, CreatedAt: day, Attempt: 1, Type: TypeTransfer, Status: StatusSuccess, Source: "manual", FinishedAt: &finish, SuccessCount: 1, BytesProcessed: 10, BytesCompleted: 10},
	}
	resources := map[string][]Resource{"failed": {{ServerID: "old", Name: "at first attempt"}}, "success": {{ServerID: "new", Name: "at retry"}}, "target": {{ServerID: "target", Name: "target name"}}}
	result, err := Aggregate(rows, resources, Request{ServerID: "old", History: "recovered"}, day.Add(12*time.Hour), OverviewCoverage{})
	if err != nil {
		t.Fatal(err)
	}
	if result.Volume.Works != 1 || result.Volume.Attempts != 2 || result.Volume.EverFailed != 1 || result.Volume.Recovered != 1 || result.Volume.UnresolvedFailures != 0 || result.Volume.AttemptBytes != 18 || result.Volume.CompletedBytes != 10 || result.Total != 1 || result.Records[0].ID != "success" {
		t.Fatalf("retry chain was filtered or added twice: %+v", result)
	}
	result, err = Aggregate(rows, resources, Request{}, day.Add(12*time.Hour), OverviewCoverage{})
	if err != nil || result.Volume.Works != 1 || result.Targets.Works != 1 || result.Volume.Servers != 3 || result.ResultEvents.Completed != 1 || result.TargetResultEvents.Completed != 1 {
		t.Fatalf("parent/target aggregation diverged: %+v %v", result, err)
	}
}

func TestConnectionDurationIsWindowClippedAndParallel(t *testing.T) {
	day := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	old := day.Add(-time.Hour)
	finish := day.Add(2 * time.Hour)
	rows := []Fact{
		{ID: "a", WorkID: "a", WorkStartedAt: old, CreatedAt: old, Attempt: 1, Type: TypeConnection, Status: StatusSuccess, EstablishedAt: &old, FinishedAt: &finish},
		{ID: "b", WorkID: "b", WorkStartedAt: old, CreatedAt: old, Attempt: 1, Type: TypeConnection, Status: StatusRunning, EstablishedAt: &old},
	}
	result, err := Aggregate(rows, nil, Request{View: "carry_over"}, day.Add(3*time.Hour), OverviewCoverage{})
	if err != nil || result.Volume.Works != 0 || result.CarryOver != 1 || result.Total != 1 || result.ResultEvents.Completed != 1 || result.ConnectionDurationMs != (5*time.Hour).Milliseconds() {
		t.Fatalf("connection time or carry-over incorrect: %+v %v", result, err)
	}
}

func TestFractionalZoneAndRepeatedHourBuckets(t *testing.T) {
	for _, zone := range []string{"Asia/Kathmandu", "America/New_York"} {
		loc, err := time.LoadLocation(zone)
		if err != nil {
			t.Fatal(err)
		}
		first := time.Date(2026, 11, 1, 5, 15, 0, 0, time.UTC)
		second := first.Add(time.Hour)
		rows := []Fact{{ID: "a", WorkID: "a", WorkStartedAt: first, CreatedAt: first, Attempt: 1, Status: StatusSuccess, Type: TypeExecution}, {ID: "b", WorkID: "b", WorkStartedAt: second, CreatedAt: second, Attempt: 1, Status: StatusSuccess, Type: TypeExecution}}
		result, err := Aggregate(rows, nil, Request{Timezone: zone}, second.Add(time.Hour), OverviewCoverage{})
		if err != nil || len(result.Timeline) != 2 {
			t.Fatalf("distinct civil buckets merged: %+v %v", result, err)
		}
		if result.Timeline[0].Start.In(loc).Minute() != 0 || result.Timeline[1].Start.In(loc).Minute() != 0 {
			t.Fatal("UTC hour used for fractional zone")
		}
		if zone == "America/New_York" && result.Timeline[0].Label == result.Timeline[1].Label {
			t.Fatal("repeated DST hour lost offset")
		}
	}
}

func TestCoverageAndPaginationDoNotTurnMissingHistoryIntoZero(t *testing.T) {
	day := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	collected := day.Add(time.Hour)
	coverage := Coverage(day, &collected, nil)
	if !coverage.Known || coverage.CompleteWindow || coverage.AvailableFrom == nil {
		t.Fatal("partial collection reported complete")
	}
	rows := []Fact{{ID: "one", WorkID: "one", WorkStartedAt: day, CreatedAt: day, Attempt: 1, Type: TypeExecution, Status: StatusUnknown}}
	result, err := Aggregate(rows, nil, Request{Page: int(^uint(0) >> 1), PageSize: 100}, day.Add(12*time.Hour), coverage)
	if err != nil || result.Total != 1 || len(result.Records) != 0 || result.Volume.Works != 1 {
		t.Fatalf("pagination affected totals: %+v %v", result, err)
	}
}

func TestConnectionInterruptionGapKeepsZeroDurationAsLowerBound(t *testing.T) {
	day := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	started, observed, recovered := day.Add(-2*time.Hour), day.Add(-time.Hour), day.Add(2*time.Hour)
	rows := []Fact{{ID: "interrupted", WorkID: "interrupted", WorkStartedAt: started, CreatedAt: started, Attempt: 1, Type: TypeConnection, Status: StatusUnknown, EstablishedAt: &started, FinishedAt: &observed, ConnectionUncertainUntil: &recovered}}
	result, err := Aggregate(rows, nil, Request{}, day.Add(12*time.Hour), OverviewCoverage{Known: true, CompleteWindow: true})
	if err != nil || result.ConnectionDurationMs != 0 || !result.ConnectionDurationIsLowerBound || result.Coverage.CompleteWindow || result.Coverage.Reason != "interrupted_connection_observation" || result.Volume.Connections != 0 || result.Volume.Works != 0 || result.Total != 1 {
		t.Fatalf("interruption gap became a measured empty day: %+v %v", result, err)
	}
	next, err := Aggregate(rows, nil, Request{}, day.Add(36*time.Hour), OverviewCoverage{Known: true, CompleteWindow: true})
	if err != nil || next.ConnectionDurationIsLowerBound || !next.Coverage.CompleteWindow || next.Total != 0 {
		t.Fatalf("uncertainty extended beyond observed recovery: %+v %v", next, err)
	}
}
