package app

import (
	"context"
	"errors"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"net/http/httptrace"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func remoteDockerFixture(t *testing.T, transport remoteRoundTripFunc) (*desktopRemoteSession, protocol.ConnectionInfo) {
	session, connection := remoteFileFixture(t, transport)
	connection.Mode = protocol.DockerConnection
	session.connections[connection.ID] = connection
	return session, connection
}
func TestRemoteDockerActionUsesBoundConnectionAndFixedPath(t *testing.T) {
	calls := 0
	session, connection := remoteDockerFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "source.example" || r.URL.Path != "/api/v1/docker/11111111-1111-4111-8111-111111111111/containers/my..container/restart" || r.Method != http.MethodPost || r.Header.Get("X-EasySSH-Connection") != strings.Repeat("a", 32) || r.Header.Get("Authorization") != "Access source-access-secret" {
			t.Fatal("Docker request escaped workspace")
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"task_id":"33333333-3333-4333-8333-333333333333","server_id":"11111111-1111-4111-8111-111111111111","container_id":"my..container","action":"restart","status":"unknown","error_code":"docker_outcome_unknown"}`)), Request: r}, nil
	})
	var result protocol.DockerActionResult
	server, err := session.requestDocker(context.Background(), connection.ID, http.MethodPost, "containers/my..container/restart", nil, &result, true)
	if err != nil || !validRemoteDockerAction(result, server) || result.Status != "unknown" || calls != 1 {
		t.Fatalf("result: %+v %v", result, err)
	}
	connection.Mode = protocol.FilesConnection
	session.connections[connection.ID] = connection
	if _, err := session.requestDocker(context.Background(), connection.ID, http.MethodPost, "containers/my..container/restart", nil, &result, true); err == nil || calls != 1 {
		t.Fatal("non-Docker connection dispatched")
	}
}
func TestRemoteDockerLostResponseNeverReplays(t *testing.T) {
	calls := 0
	session, connection := remoteDockerFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if trace := httptrace.ContextClientTrace(r.Context()); trace != nil && trace.GotConn != nil {
			trace.GotConn(httptrace.GotConnInfo{})
		}
		return nil, errors.New("lost response with private URL")
	})
	var result protocol.DockerActionResult
	_, err := session.requestDocker(context.Background(), connection.ID, http.MethodPost, "containers/container/start", nil, &result, true)
	if err == nil || err.Error() != "docker_outcome_unknown" || calls != 1 {
		t.Fatalf("lost response: %v calls=%d", err, calls)
	}
}
func TestRemoteDockerRejectsMismatchedReceipt(t *testing.T) {
	server := uuid.NewString()
	result := protocol.DockerActionResult{TaskID: uuid.NewString(), ServerID: server, ContainerID: "container", Action: protocol.DockerActionStart, Status: "succeeded"}
	if !validRemoteDockerAction(result, server) {
		t.Fatal("valid receipt rejected")
	}
	if validRemoteDockerAction(result, uuid.NewString()) {
		t.Fatal("cross-server receipt accepted")
	}
	result.Status = "unknown"
	result.TaskID = ""
	if validRemoteDockerAction(result, server) {
		t.Fatal("missing task identity accepted")
	}
}
func TestRemoteDockerBindingsCannotReachLocalDockerService(t *testing.T) {
	remote := reflect.TypeFor[DesktopRemoteWorkspaceService]()
	local := reflect.TypeFor[DesktopDockerService]()
	for _, method := range []string{"ApplyDockerAction", "DockerActionResult", "ListDockerContainers", "DockerContainerLogs"} {
		if !desktopRemoteBindingAllowed(remote.PkgPath() + "." + remote.Name() + "." + method) {
			t.Fatalf("missing typed binding %s", method)
		}
	}
	if desktopRemoteBindingAllowed(local.PkgPath() + "." + local.Name() + ".StartContainer") {
		t.Fatal("remote window acquired local Docker authority")
	}
}
func TestRemotePathRejectsTraversalButAllowsContainerDots(t *testing.T) {
	if !validRemoteAPIPath("/api/v1/docker/server/containers/my..container/start") {
		t.Fatal("valid container name rejected")
	}
	for _, path := range []string{"/api/v1/../owner", "/api/v1/%2e%2e/owner", "/api/v1/%2fowner", "/api/v1/a\\b", "/api/v1/a?host=other"} {
		if validRemoteAPIPath(path) {
			t.Fatalf("unsafe route accepted: %s", path)
		}
	}
}
