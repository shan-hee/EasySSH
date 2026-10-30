package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptrace"
	"reflect"
	"strings"
	"testing"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func TestRemoteDeletePinsConnectionAndDoesNotRepeatUnknownSubmission(t *testing.T) {
	id := uuid.NewString()
	calls := 0
	lose := false
	mode := "recursive_task"
	paths := []string{"/tmp/name ?query=value#fragment", "/tmp/name,with,commas"}
	session, connection := remoteFileFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodPost || r.URL.Host != "source.example" || r.URL.Path != "/api/v1/sftp/11111111-1111-4111-8111-111111111111/delete-paths" || r.Header.Get("X-EasySSH-Connection") != strings.Repeat("a", 32) || r.Header.Get("Authorization") != "Access source-access-secret" || len(r.URL.Query()) != 0 || r.Header.Get("Cookie") != "" {
			t.Fatal("deletion escaped fixed source/connection")
		}
		var input protocol.SFTPDeletePathsRequest
		if json.NewDecoder(r.Body).Decode(&input) != nil || !reflect.DeepEqual(input.Paths, paths) {
			t.Fatal("paths were interpreted as route or split on punctuation")
		}
		if trace := httptrace.ContextClientTrace(r.Context()); trace != nil && trace.GotConn != nil {
			trace.GotConn(httptrace.GotConnInfo{})
		}
		if lose {
			return nil, errors.New("response lost")
		}
		return remoteTaskResponse(t, r, protocol.SFTPDeletePathsResult{Mode: protocol.SFTPDeletePathsResultMode(mode), TaskID: id, DeletedPaths: []string{}}), nil
	})
	result, err := session.deleteRemotePaths(context.Background(), connection.ID, paths)
	if err != nil || result.TaskID != id || calls != 1 {
		t.Fatalf("submission: %+v %v", result, err)
	}
	lose = true
	if _, err := session.deleteRemotePaths(context.Background(), connection.ID, paths); err == nil || err.Error() != "remote_delete_submission_unknown" || calls != 2 {
		t.Fatalf("lost response was replayed or misclassified: %v calls=%d", err, calls)
	}
	lose = false
	mode = "fast"
	if _, err := session.deleteRemotePaths(context.Background(), connection.ID, paths); err == nil || err.Error() != "remote_delete_submission_unknown" || calls != 3 {
		t.Fatalf("old/malformed response accepted: %v", err)
	}
	for _, invalid := range [][]string{{"/etc"}, {"/tmp/../etc"}, {"relative"}, {"/tmp//ambiguous"}} {
		if _, err := session.deleteRemotePaths(context.Background(), connection.ID, invalid); err == nil || calls != 3 {
			t.Fatal("invalid paths reached remote")
		}
	}
}

func TestRemoteDeleteBindingsExposeOnlyTypedSourceOperations(t *testing.T) {
	typ := reflect.TypeFor[DesktopRemoteWorkspaceService]()
	prefix := typ.PkgPath() + "." + typ.Name() + "."
	for _, name := range []string{"DeleteRemotePaths", "GetRemoteContent", "ReadRemoteContent"} {
		if _, ok := reflect.PointerTo(typ).MethodByName(name); !ok || !desktopRemoteBindingAllowed(prefix+name) {
			t.Fatalf("missing typed method %s", name)
		}
	}
	for _, name := range []string{"deleteRemotePaths", "DeletePaths", "DeleteContext", "requestFile", "requestRecord"} {
		if desktopRemoteBindingAllowed(prefix + name) {
			t.Fatalf("private or local operation exposed: %s", name)
		}
	}
}
