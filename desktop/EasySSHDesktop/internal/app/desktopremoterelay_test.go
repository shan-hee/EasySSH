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

func remoteRelayFixture(t *testing.T, transport remoteRoundTripFunc) (*desktopRemoteSession, protocol.RemoteTransferRelayInput, protocol.TransferJob) {
	t.Helper()
	session, task := remoteTaskFixture(t, transport)
	sourceID, targetID := uuid.MustParse("11111111-1111-4111-8111-111111111111"), uuid.New()
	input := protocol.RemoteTransferRelayInput{SourceConnectionID: strings.Repeat("a", 32), TargetConnectionID: strings.Repeat("b", 32), SourcePath: "/source", TargetPath: "/destination"}
	session.connections[input.TargetConnectionID] = protocol.ConnectionInfo{ID: input.TargetConnectionID, ServerID: targetID.String(), Mode: protocol.FilesConnection}
	job := protocol.TransferJob{ID: uuid.New(), Actor: task.Actor, Runner: "server", Kind: "sftp_transfer", Status: "queued", Stage: "transfer_to_remote", SourceServerID: &sourceID, TargetServerID: &targetID, SourcePath: input.SourcePath, TargetPath: input.TargetPath, FileName: "source", CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt}
	return session, input, job
}

func TestRemoteRelayUsesWindowConnectionsAndSourceRecord(t *testing.T) {
	var response protocol.TransferJob
	calls := 0
	session, input, job := remoteRelayFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodPost || r.URL.Host != "source.example" || r.URL.Path != "/api/v1/transfer-jobs/sftp/relay" || r.Header.Get("Authorization") != "Access source-access-secret" {
			t.Fatal("relay escaped source session")
		}
		var sent protocol.TransferRelayInput
		if err := json.NewDecoder(r.Body).Decode(&sent); err != nil || sent.SourceServerID != response.SourceServerID.String() || sent.TargetServerID != response.TargetServerID.String() || sent.SourcePath != "/source" || sent.TargetPath != "/destination" {
			t.Fatalf("wrong relay endpoints: %+v %v", sent, err)
		}
		return remoteTaskResponse(t, r, response), nil
	})
	response = job
	result, err := session.startRemoteRelay(context.Background(), input)
	if err != nil || result.ID != job.ID || result.Status != "queued" || calls != 1 || len(session.transfers) != 0 {
		t.Fatalf("source admission: %+v %v calls=%d", result, err, calls)
	}
	input.TargetConnectionID = strings.Repeat("c", 32)
	if _, err := session.startRemoteRelay(context.Background(), input); err == nil || calls != 1 {
		t.Fatal("foreign connection dispatched")
	}
	input.TargetConnectionID = input.SourceConnectionID
	if _, err := session.startRemoteRelay(context.Background(), input); err == nil || calls != 1 {
		t.Fatal("same server relay dispatched")
	}
}

func TestRemoteRelayLostAdmissionNeverReplays(t *testing.T) {
	calls := 0
	session, input, _ := remoteRelayFixture(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if trace := httptrace.ContextClientTrace(r.Context()); trace != nil && trace.GotConn != nil {
			trace.GotConn(httptrace.GotConnInfo{})
		}
		return nil, errors.New("response lost")
	})
	if _, err := session.startRemoteRelay(context.Background(), input); err == nil || err.Error() != "transfer_outcome_unknown" || calls != 1 {
		t.Fatalf("ambiguous admission retried/reported rejected: %v calls=%d", err, calls)
	}
}

func TestRemoteTransferReadAndCancelRemainInSourceSession(t *testing.T) {
	var response protocol.TransferJob
	posts := 0
	session, _, job := remoteRelayFixture(t, func(r *http.Request) (*http.Response, error) {
		if r.Method == http.MethodGet {
			if r.URL.Path == "/api/v1/transfer-jobs" {
				return remoteTaskResponse(t, r, protocol.TransferJobList{Jobs: []protocol.TransferJob{response}, Total: 1, Page: 1, PageSize: 20, TotalPages: 1}), nil
			}
			return remoteTaskResponse(t, r, response), nil
		}
		posts++
		if r.URL.Path != "/api/v1/transfer-jobs/"+response.ID.String()+"/cancel" {
			t.Fatal("incorrect cancel endpoint")
		}
		return remoteTaskResponse(t, r, protocol.TransferMutationResult{Success: true}), nil
	})
	response = job
	response.Status, response.BytesTotal, response.BytesProcessed, response.BytesCompleted = "running", 100, 80, 20
	response.FilesTotal, response.FilesCompleted, response.ResultPath = 4, 1, "/destination/source (2)"
	page, err := session.listRemoteTransfers(context.Background(), protocol.TransferListInput{Kind: "sftp_transfer"})
	if err != nil || len(page.Jobs) != 1 || page.Jobs[0].BytesCompleted != 20 {
		t.Fatalf("partial completion lost: %+v %v", page, err)
	}
	if result, err := session.cancelRemoteTransfer(context.Background(), job.ID.String()); err != nil || !result.Success || posts != 1 {
		t.Fatalf("cancel admission: %+v %v", result, err)
	}
	response.Actor.SessionID = uuid.NewString()
	if _, err := session.cancelRemoteTransfer(context.Background(), job.ID.String()); err == nil || posts != 1 {
		t.Fatal("cross-session task cancelled")
	}
	if _, err := session.listRemoteTransfers(context.Background(), protocol.TransferListInput{}); err == nil {
		t.Fatal("cross-session records exposed")
	}
	response = job
	response.Status = "unknown"
	if _, err := session.cancelRemoteTransfer(context.Background(), job.ID.String()); err == nil || posts != 1 {
		t.Fatal("unknown execution reported cancelled")
	}
}

func TestRemoteRelayBindingsRequireNativeWorkspace(t *testing.T) {
	typ := reflect.TypeFor[DesktopRemoteWorkspaceService]()
	prefix := typ.PkgPath() + "." + typ.Name() + "."
	for _, method := range []string{"StartRemoteRelay", "ListRemoteTransfers", "GetRemoteTransfer", "CancelRemoteTransfer"} {
		if !desktopRemoteBindingAllowed(prefix + method) {
			t.Fatalf("missing binding %s", method)
		}
	}
	service := newDesktopRemoteWorkspaceService(nil, &desktopNativeBoundary{})
	defer service.cancel()
	if _, err := service.StartRemoteRelay(context.Background(), protocol.RemoteTransferRelayInput{}); err == nil {
		t.Fatal("relay accepted without a registered native window")
	}
}
