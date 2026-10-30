package app

import (
	"context"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/shared/activitystats"
	"github.com/google/uuid"
)

func remoteActivityFixture(t *testing.T, session *desktopRemoteSession, input activitystats.Request) protocol.ActivityOverview {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Second)
	start, end, zone, err := activitystats.Window(input, now)
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.New()
	return protocol.ActivityOverview{
		MetricVersion: activitystats.MetricVersion, AsOf: now, Start: start, End: end, Timezone: zone.String(),
		Coverage:                       activitystats.OverviewCoverage{Known: true, CompleteWindow: false, Reason: "interrupted_connection", UnavailableMetrics: []string{"connection_duration_ms"}},
		ConnectionDurationIsLowerBound: true,
		Volume:                         activitystats.WorkMetrics{Works: 1, Executions: 1, Attempts: 2, Retries: 1, BySource: map[string]int64{"share": 1}},
		Targets:                        activitystats.WorkMetrics{Works: 3, Transfers: 3, AttemptBytes: 42},
		ResultEvents:                   activitystats.ResultEvents{Unknown: 1},
		Records:                        []protocol.ActivityWorkSummary{{ID: id, WorkID: id, WorkStartedAt: now, CreatedAt: now, UpdatedAt: now, Actor: remoteActivityActor(session), Attempt: 2, Type: activitystats.TypeExecution, Category: "activity", Source: "share", Status: activitystats.StatusUnknown, Title: "source execution", ObservedAttempts: 2}},
		Page:                           1, PageSize: 20, Total: 1,
	}
}

func TestRemoteActivityUsesSourceSnapshotWithoutLocalAggregation(t *testing.T) {
	input := activitystats.Request{Timezone: "Asia/Shanghai", Range: "seven_days"}
	var response protocol.ActivityOverview
	calls := 0
	session, _ := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "source.example" || r.URL.Path != "/api/v1/operation-records/overview" || r.URL.Query().Get("timezone") != "Asia/Shanghai" || r.Header.Get("Authorization") != "Access source-access-secret" || r.Header.Get("Cookie") != "" {
			t.Fatal("activity escaped source scope")
		}
		return remoteTaskResponse(t, r, response), nil
	})
	response = remoteActivityFixture(t, session, input)
	got, err := session.remoteActivityOverview(context.Background(), input)
	if err != nil || !reflect.DeepEqual(response, got) {
		t.Fatalf("source snapshot changed: %+v %v", got, err)
	}
	response.Records[0].Actor.GrantID = uuid.NewString()
	if _, err := session.remoteActivityOverview(context.Background(), input); err == nil {
		t.Fatal("foreign activity actor exposed")
	}
	response.Records[0].Actor = remoteActivityActor(session)
	response.Timezone = "UTC"
	if _, err := session.remoteActivityOverview(context.Background(), input); err == nil {
		t.Fatal("mismatched timezone accepted")
	}
	input.PageSize = 101
	if _, err := session.remoteActivityOverview(context.Background(), input); err == nil || calls != 3 {
		t.Fatal("invalid query dispatched")
	}
}

func TestRemoteActivityDetailValidatesIdentityAndBindings(t *testing.T) {
	var response protocol.ActivityRecord
	session, task := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/v1/operation-records/"+response.ID.String() || r.Method != http.MethodGet {
			t.Fatal("unexpected detail route")
		}
		return remoteTaskResponse(t, r, response), nil
	})
	response = protocol.ActivityRecord{ID: task.ID, WorkID: task.WorkID, WorkStartedAt: task.WorkStartedAt, CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt, Actor: task.Actor, Attempt: 1, Type: activitystats.TypeExecution, Category: "activity", Source: "share", Status: activitystats.StatusUnknown, DetailJSON: `{"tool_execution_id":"observed-source"}`}
	if result, err := session.getRemoteActivity(context.Background(), task.ID.String()); err != nil || result.DetailJSON != response.DetailJSON {
		t.Fatalf("detail: %+v %v", result, err)
	}
	response.DetailJSON = ""
	response.DetailContent = &protocol.ContentReference{ID: uuid.New(), Size: 40000, Sha256: strings.Repeat("a", 64), MediaType: "text/plain; charset=utf-8"}
	if result, err := session.getRemoteActivity(context.Background(), task.ID.String()); err != nil || result.DetailContent == nil || *result.DetailContent != *response.DetailContent {
		t.Fatalf("standalone detail descriptor: %+v %v", result, err)
	}
	response.DetailJSON = "duplicate"
	if _, err := session.getRemoteActivity(context.Background(), task.ID.String()); err == nil {
		t.Fatal("duplicate detail accepted")
	}
	response.DetailJSON = ""
	response.TaskContent = &protocol.ContentReference{ID: uuid.New(), Size: 40000, Sha256: strings.Repeat("b", 64), MediaType: "application/json"}
	if _, err := session.getRemoteActivity(context.Background(), task.ID.String()); err == nil {
		t.Fatal("conflicting body references accepted")
	}
	response.TaskContent = nil
	response.Actor.ID = uuid.NewString()
	response.Actor.SessionID = response.Actor.ID
	if _, err := session.getRemoteActivity(context.Background(), task.ID.String()); err == nil {
		t.Fatal("foreign session exposed")
	}
	typ := reflect.TypeFor[DesktopRemoteWorkspaceService]()
	prefix := typ.PkgPath() + "." + typ.Name() + "."
	for _, name := range []string{"RemoteActivityOverview", "GetRemoteActivity"} {
		if !desktopRemoteBindingAllowed(prefix + name) {
			t.Fatalf("missing binding %s", name)
		}
	}
	if desktopRemoteBindingAllowed(prefix + "RequestRecord") {
		t.Fatal("arbitrary request binding exposed")
	}
}

func remoteActivityActor(session *desktopRemoteSession) protocol.Actor {
	return protocol.Actor{Kind: protocol.Visitor, ID: session.client.sessionID, SessionID: session.client.sessionID, GrantID: session.client.grantID}
}
