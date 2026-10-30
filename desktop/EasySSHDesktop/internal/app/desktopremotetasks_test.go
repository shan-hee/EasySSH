package app

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"net/http/httptrace"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/shared/taskprotocol"
	"github.com/google/uuid"
)

func remoteTaskFixture(t *testing.T, transport remoteRoundTripFunc) (*desktopRemoteSession, protocol.TaskRunSummary) {
	t.Helper()
	session, _ := remoteFileFixture(t, transport)
	session.client.grantID = "33333333-3333-4333-8333-333333333333"
	id := uuid.New()
	now := time.Now().UTC()
	run := protocol.TaskRunSummary{ID: id, WorkID: id, WorkStartedAt: now, CreatedAt: now, UpdatedAt: now, Actor: protocol.Actor{Kind: protocol.Visitor, ID: session.client.sessionID, SessionID: session.client.sessionID, GrantID: session.client.grantID}, TaskType: "script", Title: "run", TriggerType: protocol.TaskTriggerManual, Runner: "server", Status: protocol.TaskStatusRunning, Attempt: 1, MaxAttempts: 1, Cancelable: true}
	return session, run
}
func remoteTaskResponse(t *testing.T, r *http.Request, value any) *http.Response {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(data))), Request: r}
}
func TestRemoteTaskListUsesSourceScopeAndLiteralQuery(t *testing.T) {
	var run protocol.TaskRunSummary
	calls := 0
	session, fixture := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "source.example" || r.URL.Path != "/api/v1/tasks" || r.Header.Get("Authorization") != "Access source-access-secret" || r.Header.Get("Cookie") != "" || r.Header.Get("X-EasySSH-Connection") != "" || r.URL.Query().Get("keyword") != "?actor=other&token=wrong" {
			t.Fatal("task request escaped native source")
		}
		view := taskprotocol.OverviewOf(run)
		return remoteTaskResponse(t, r, protocol.TaskRunList{Runs: []*protocol.TaskOverview{&view}, Total: 1, Page: 1, PageSize: 20, TotalPages: 1}), nil
	})
	run = fixture
	input := protocol.TaskListInput{Keyword: "?actor=other&token=wrong"}
	result, err := session.listRemoteTasks(context.Background(), input)
	if err != nil || len(result.Runs) != 1 {
		t.Fatalf("list failed: %+v %v", result, err)
	}
	run.Actor.SessionID = uuid.NewString()
	run.Actor.ID = run.Actor.SessionID
	result, err = session.listRemoteTasks(context.Background(), input)
	if err == nil || len(result.Runs) != 0 {
		t.Fatal("cross-session result exposed")
	}
	input.Page = -1
	if _, err := session.listRemoteTasks(context.Background(), input); err == nil || calls != 2 {
		t.Fatal("invalid pagination dispatched")
	}
}
func TestRemoteTaskCancelLostReceiptNeverReplays(t *testing.T) {
	var run protocol.TaskRun
	posts := 0
	session, summary := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		if r.Method == http.MethodGet {
			content, err := taskprotocol.DescribeContent(protocol.TaskBody{TaskRunID: run.ID})
			if err != nil {
				t.Fatal(err)
			}
			overview := taskprotocol.RunOverview(run)
			return remoteTaskResponse(t, r, protocol.TaskRunDetails{Run: &overview, Content: content}), nil
		}
		posts++
		if r.URL.Path != "/api/v1/tasks/"+run.ID.String()+"/cancel" {
			t.Fatal("unexpected cancel path")
		}
		if trace := httptrace.ContextClientTrace(r.Context()); trace != nil && trace.GotConn != nil {
			trace.GotConn(httptrace.GotConnInfo{})
		}
		return nil, errors.New("response lost")
	})
	run = protocol.TaskRun{ID: summary.ID, WorkID: summary.WorkID, Actor: summary.Actor, WorkStartedAt: summary.WorkStartedAt, CreatedAt: summary.CreatedAt, UpdatedAt: summary.UpdatedAt, TaskType: summary.TaskType, Title: summary.Title, TriggerType: summary.TriggerType, Runner: summary.Runner, Status: summary.Status, Attempt: 1, MaxAttempts: 1, Cancelable: true}
	if _, err := session.cancelRemoteTask(context.Background(), run.ID.String()); err == nil || err.Error() != "task_cancel_outcome_unknown" || posts != 1 {
		t.Fatalf("cancel replay or false receipt: %v posts=%d", err, posts)
	}
	run.Actor.GrantID = uuid.NewString()
	if _, err := session.cancelRemoteTask(context.Background(), run.ID.String()); err == nil || posts != 1 {
		t.Fatal("foreign grant task canceled")
	}
}
func TestRemoteTaskBindingsExposeNoArbitraryRequestOrRetry(t *testing.T) {
	typ := reflect.TypeFor[DesktopRemoteWorkspaceService]()
	prefix := typ.PkgPath() + "." + typ.Name() + "."
	for _, name := range []string{"ListRemoteTasks", "ListRemoteTaskEvents", "GetRemoteTask", "RemoteTaskStatistics", "CancelRemoteTask"} {
		if !desktopRemoteBindingAllowed(prefix + name) {
			t.Fatalf("missing binding %s", name)
		}
	}
	for _, name := range []string{"RetryRemoteTask", "RequestTask", "Cleanup", "GetRemoteTaskContentChunk"} {
		if desktopRemoteBindingAllowed(prefix + name) {
			t.Fatalf("unexpected binding %s", name)
		}
	}
}

func TestRemoteTaskEventsValidateCursorAndTask(t *testing.T) {
	var runID uuid.UUID
	response := protocol.TaskEventPage{}
	calls := 0
	session, run := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/tasks/"+runID.String()+"/events" || r.URL.Query().Get("after_id") != "5" || r.URL.Query().Get("limit") != "2" || r.Header.Get("Authorization") != "Access source-access-secret" {
			t.Fatal("invalid events route or scope")
		}
		return remoteTaskResponse(t, r, response), nil
	})
	runID = run.ID
	response = protocol.TaskEventPage{TaskRunID: runID.String(), Events: []protocol.TaskEvent{{ID: 6, TaskRunID: runID.String(), CreatedAt: time.Now(), Level: "info", Message: "line one\nline two"}}, NextAfterID: 6}
	input := protocol.TaskEventInput{AfterID: 5, Limit: 2}
	if page, err := session.listRemoteTaskEvents(context.Background(), runID.String(), input); err != nil || len(page.Events) != 1 {
		t.Fatalf("valid page: %+v %v", page, err)
	}
	response.NextAfterID = 5
	if _, err := session.listRemoteTaskEvents(context.Background(), runID.String(), input); err == nil {
		t.Fatal("non-advancing cursor accepted")
	}
	response.NextAfterID = 6
	response.Events[0].TaskRunID = uuid.NewString()
	if _, err := session.listRemoteTaskEvents(context.Background(), runID.String(), input); err == nil {
		t.Fatal("another task's event accepted")
	}
	input.Limit = 101
	if _, err := session.listRemoteTaskEvents(context.Background(), runID.String(), input); err == nil || calls != 3 {
		t.Fatal("invalid event limit sent to server")
	}
}

func TestRemoteTaskBodyChecksParentAndAcceptsCommittedReference(t *testing.T) {
	var detail protocol.TaskRunDetails
	session, summary := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) { return remoteTaskResponse(t, r, detail), nil })
	overview := taskprotocol.OverviewOf(summary)
	overview.Title = strings.Repeat("title", 300)
	descriptor, err := taskprotocol.DescribeContent(protocol.TaskBody{TaskRunID: summary.ID, ResultJSON: `{"output":"observed"}`})
	if err != nil {
		t.Fatal(err)
	}
	detail = protocol.TaskRunDetails{Run: &overview, Content: descriptor}
	if _, err := session.getRemoteTask(context.Background(), summary.ID.String()); err != nil {
		t.Fatal("full detail metadata rejected", err)
	}
	detail.Content, err = taskprotocol.DescribeContent(protocol.TaskBody{TaskRunID: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := session.getRemoteTask(context.Background(), summary.ID.String()); err == nil {
		t.Fatal("foreign body parent accepted")
	}
	ref := protocol.ContentReference{ID: uuid.New(), MediaType: "application/json", Size: 100000, Sha256: strings.Repeat("a", 64)}
	detail.Content = protocol.TaskContent{Bytes: int(ref.Size), Hash: ref.Sha256, Content: &ref}
	if _, err := session.getRemoteTask(context.Background(), summary.ID.String()); err != nil {
		t.Fatal("committed body descriptor rejected", err)
	}
	detail.Content.Content = nil
	if _, err := session.getRemoteTask(context.Background(), summary.ID.String()); err == nil {
		t.Fatal("unreadable body descriptor accepted")
	}
}
