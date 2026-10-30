package app

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"net/http"
	"net/http/httptrace"
	"reflect"
	"strings"
	"testing"

	"github.com/easyssh/shared/scriptutil"
	"github.com/google/uuid"
)

func TestRemoteScriptsExposeApprovedMetadataOnly(t *testing.T) {
	serverID, scriptID := uuid.NewString(), uuid.New()
	response := protocol.ScriptCatalogPage{ServerID: serverID, NextAfterID: scriptID.String(), Items: []protocol.AvailableScript{{ID: scriptID, Name: "status", Language: "bash", Version: scriptutil.Version("bash", "uptime"), Parameters: map[string]protocol.GrantParameterRule{"message": {MaxBytes: 128}}}}}
	session, _ := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "source.example" || r.URL.Path != "/api/v1/scripts/available" || r.URL.Query().Get("server_id") != serverID || r.Header.Get("Authorization") != "Access source-access-secret" || r.Header.Get("Cookie") != "" {
			t.Fatal("script metadata escaped source")
		}
		return remoteTaskResponse(t, r, response), nil
	})
	rows, err := session.availableRemoteScripts(context.Background(), serverID, protocol.ScriptCatalogInput{})
	if err != nil || len(rows.Items) != 1 || rows.Items[0].ID != scriptID {
		t.Fatalf("catalogue: %+v %v", rows, err)
	}
	typ := reflect.TypeFor[protocol.AvailableScript]()
	for _, field := range []string{"Content", "Command", "Password", "PrivateKey"} {
		if _, found := typ.FieldByName(field); found {
			t.Fatalf("secret-bearing metadata field: %s", field)
		}
	}
	response.Items = append(response.Items, response.Items[0])
	if _, err := session.availableRemoteScripts(context.Background(), serverID, protocol.ScriptCatalogInput{}); err == nil {
		t.Fatal("duplicate scripts accepted")
	}
}

func TestRemoteScriptExecutionPinsVersionAndDoesNotReplay(t *testing.T) {
	scriptID, serverID := uuid.NewString(), uuid.NewString()
	input := protocol.ScriptExecuteInput{ServerIDs: []string{serverID}, Version: scriptutil.Version("bash", "echo ready"), Parameters: map[string]string{"value": "$(touch never-execute-here)"}}
	calls := 0
	loseReceipt := false
	taskID := uuid.New()
	session, _ := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/scripts/"+scriptID+"/execute" || r.Header.Get("Authorization") != "Access source-access-secret" {
			t.Fatal("wrong execution endpoint")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["script_version"] != input.Version || body["execution_mode"] != "parallel" || body["content"] != nil || body["command"] != nil || body["actor"] != nil {
			t.Fatal("execution source or identity was supplied by client")
		}
		if loseReceipt {
			if trace := httptrace.ContextClientTrace(r.Context()); trace != nil && trace.GotConn != nil {
				trace.GotConn(httptrace.GotConnInfo{})
			}
			return nil, errors.New("receipt lost")
		}
		return remoteTaskResponse(t, r, protocol.ScriptAccepted{TaskID: taskID, BatchTaskID: taskID, Status: "queued"}), nil
	})
	if result, err := session.executeRemoteScript(context.Background(), scriptID, input); err != nil || result.TaskID != taskID {
		t.Fatalf("execution: %+v %v", result, err)
	}
	loseReceipt = true
	if _, err := session.executeRemoteScript(context.Background(), scriptID, input); err == nil || err.Error() != "script_execution_outcome_unknown" || calls != 2 {
		t.Fatalf("lost response replayed or misreported: %v calls=%d", err, calls)
	}
	input.ServerIDs = append(input.ServerIDs, serverID)
	if _, err := session.executeRemoteScript(context.Background(), scriptID, input); err == nil || calls != 2 {
		t.Fatal("duplicate targets dispatched")
	}
	input.ServerIDs = []string{serverID}
	input.Parameters = map[string]string{"one": strings.Repeat("\x01", 60000), "two": strings.Repeat("\x01", 60000)}
	if _, err := session.executeRemoteScript(context.Background(), scriptID, input); err == nil || calls != 2 {
		t.Fatal("oversized encoded request dispatched")
	}
	typ := reflect.TypeFor[DesktopRemoteWorkspaceService]()
	prefix := typ.PkgPath() + "." + typ.Name() + "."
	for _, method := range []string{"AvailableRemoteScripts", "ExecuteRemoteScript"} {
		if !desktopRemoteBindingAllowed(prefix + method) {
			t.Fatalf("missing binding %s", method)
		}
	}
	for _, method := range []string{"CreateRemoteScript", "UpdateRemoteScript", "DeleteRemoteScript"} {
		if desktopRemoteBindingAllowed(prefix + method) {
			t.Fatalf("owner management exposed: %s", method)
		}
	}
}

func TestRemoteScriptCatalogueValidatesCursorAndBoundsBeforeUse(t *testing.T) {
	serverID := uuid.NewString()
	cursor := "00000000-0000-4000-8000-000000000001"
	next := "00000000-0000-4000-8000-000000000002"
	response := protocol.ScriptCatalogPage{ServerID: serverID, NextAfterID: next, HasMore: true, Items: []protocol.AvailableScript{}}
	calls := 0
	session, _ := remoteTaskFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Query().Get("after_id") != cursor || r.URL.Query().Get("limit") != "1" {
			t.Fatal("pagination not forwarded")
		}
		return remoteTaskResponse(t, r, response), nil
	})
	input := protocol.ScriptCatalogInput{AfterID: cursor, Limit: 1}
	page, err := session.availableRemoteScripts(context.Background(), serverID, input)
	if err != nil || len(page.Items) != 0 || page.NextAfterID != next || !page.HasMore {
		t.Fatalf("filtered page rejected: %+v %v", page, err)
	}
	for _, mutate := range []func(*protocol.ScriptCatalogPage){
		func(p *protocol.ScriptCatalogPage) { p.ServerID = uuid.NewString() },
		func(p *protocol.ScriptCatalogPage) { p.NextAfterID = cursor },
		func(p *protocol.ScriptCatalogPage) { p.NextAfterID = "invalid" },
	} {
		original := response
		mutate(&response)
		if _, err := session.availableRemoteScripts(context.Background(), serverID, input); err == nil {
			t.Fatal("invalid catalogue accepted")
		}
		response = original
	}
	before := calls
	for _, invalid := range []protocol.ScriptCatalogInput{{Limit: -1}, {Limit: 101}, {AfterID: "bad-id"}, {AfterID: uuid.Nil.String()}} {
		if _, err := session.availableRemoteScripts(context.Background(), serverID, invalid); err == nil {
			t.Fatal("invalid query accepted")
		}
	}
	if calls != before {
		t.Fatal("invalid query reached source")
	}
}
