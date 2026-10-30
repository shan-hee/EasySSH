package app

import (
	"context"
	"encoding/json"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestRemoteReceiptRecoveryOnlyReadsOriginalSourceTask(t *testing.T) {
	session, task := remoteTransferFixture(t, "upload", 7)
	task.mu.Lock()
	task.info.SourceTaskID = "55555555-5555-4555-8555-555555555555"
	if err := task.persistLocked(); err != nil {
		t.Fatal(err)
	}
	task.mu.Unlock()
	if err := recoverRemoteTransferReceipts(context.Background(), session.transferStore.db, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	// Recreated session has no connection or file handle. Recovering this
	// receipt must not reconstruct either capability or start another upload.
	reopened := &desktopRemoteSession{client: session.client, ctx: session.ctx, cancel: session.cancel, transferStore: session.transferStore, transfers: make(map[string]*desktopRemoteTransfer)}
	recovered, err := reopened.fileTransfer(task.info.ID)
	if err != nil || recovered.snapshot().Status != "unknown" || recovered.ctx.Err() == nil {
		t.Fatalf("recovery: %v %+v", err, recovered)
	}
	calls := 0
	session.client.http.Transport = remoteRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.Method != http.MethodGet || request.URL.Path != "/api/v1/transfer-jobs/"+task.info.SourceTaskID {
			t.Fatal("recovery replayed a mutation")
		}
		body, _ := json.Marshal(remoteUploadFixtureJob(session, task))
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(body))), Request: request}, nil
	})
	if err := reopened.refreshUploadResult(context.Background(), recovered); err != nil {
		t.Fatal(err)
	}
	info, err := session.transferStore.get(context.Background(), task.info.ID)
	if err != nil || info.Status != "succeeded" || info.Transferred != 7 || calls != 1 {
		t.Fatalf("source result not persisted: %+v %v", info, err)
	}
	for _, table := range []string{"desktop_task_runs", "activity_logs"} {
		var count int
		if err := session.transferStore.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("remote receipt duplicated local work in %s", table)
		}
	}
}

func TestRemoteReceiptScopeAppliedBeforePaginationAndMutation(t *testing.T) {
	session, task := remoteTransferFixture(t, "upload", 7)
	task.finish("unknown", "upload_outcome_unknown")
	ctx := context.Background()
	for _, change := range []func(*desktopRemoteTransferStore){
		func(s *desktopRemoteTransferStore) { s.origin = "https://different.example" },
		func(s *desktopRemoteTransferStore) { s.workspaceID = "other" },
		func(s *desktopRemoteTransferStore) { s.actor.GrantID = "other" },
		func(s *desktopRemoteTransferStore) { s.actor.ID, s.actor.SessionID = "other", "other" },
	} {
		other := *session.transferStore
		change(&other)
		if _, err := other.get(ctx, task.info.ID); err == nil {
			t.Fatal("cross-scope receipt read")
		}
		page, err := other.list(ctx, DesktopRemoteTransferListInput{PageSize: 1})
		if err != nil || page.Total != 0 || len(page.Items) != 0 {
			t.Fatalf("cross-scope count: %+v %v", page, err)
		}
		if err := other.dismiss(ctx, task.info.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := session.transferStore.get(ctx, task.info.ID); err != nil {
			t.Fatal("cross-scope deletion")
		}
	}
	// A new authorization for the same grant cannot claim an old session's work.
	other := *session.transferStore
	other.actor = protocol.Actor{Kind: protocol.Owner, ID: "local_owner", SessionID: "local_session"}
	if err := other.insert(ctx, task.info); err == nil {
		t.Fatal("owner fallback accepted")
	}
}

func TestRemoteReceiptDurabilityFailureStopsBeforePublishingWork(t *testing.T) {
	session, task := remoteTransferFixture(t, "upload", 7)
	if err := session.transferStore.db.Close(); err != nil {
		t.Fatal(err)
	}
	session.resourcesMu.Lock()
	_, err := session.newFileTransferLocked(task.connection, "download", "next", "/next", -1)
	session.resourcesMu.Unlock()
	if err == nil || len(session.transfers) != 1 {
		t.Fatal("unpersisted transfer published")
	}
}

func TestRemoteTransferLostIntentStopsWithoutPendingResult(t *testing.T) {
	session, task := remoteTransferFixture(t, "upload", 7)
	if _, err := session.transferStore.db.Exec("DELETE FROM desktop_remote_transfers WHERE id=?", task.info.ID); err != nil {
		t.Fatal(err)
	}
	task.mu.Lock()
	task.persistedAt = time.Now().Add(-time.Minute)
	task.mu.Unlock()
	if err := task.progress(1); err == nil || task.ctx.Err() == nil || task.snapshot().Status != "unknown" {
		t.Fatal("storage loss did not stop transfer as unknown", err)
	}
	task.finish("succeeded", "")
	if task.snapshot().Status != "unknown" {
		t.Fatal("uncommitted result advertised as success")
	}
	raw, err := json.Marshal(task.snapshot())
	if err != nil || strings.Contains(string(raw), "persistence_error") {
		t.Fatal("pending-result UI leaked into transfer response", err)
	}
}

func TestRemoteTransferReopenReconcilesIntentWithoutResumingIO(t *testing.T) {
	session, task := remoteTransferFixture(t, "download", -1)
	task.cancel()
	session.resourcesMu.Lock()
	delete(session.transfers, task.info.ID)
	session.resourcesMu.Unlock()
	restored, err := session.fileTransfer(task.info.ID)
	if err != nil || restored.snapshot().Status != "unknown" || restored.ctx.Err() == nil {
		t.Fatal("interrupted intent not recovered", err)
	}
	stored, err := session.transferStore.get(context.Background(), task.info.ID)
	if err != nil || stored.Status != "unknown" || stored.Error != "transfer_interrupted" {
		t.Fatal("recovery was not durable", err)
	}
}

func TestRemoteDownloadRecoveryDoesNotClaimFailureOrRepeatDownload(t *testing.T) {
	session, task := remoteTransferFixture(t, "download", -1)
	if err := recoverRemoteTransferReceipts(context.Background(), session.transferStore.db, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	info, err := session.transferStore.get(context.Background(), task.info.ID)
	if err != nil || info.Status != "unknown" || info.Error != "desktop_restarted" || info.FinishedAt == nil {
		t.Fatalf("download commit uncertainty lost: %+v %v", info, err)
	}
	page, err := session.transferStore.list(context.Background(), DesktopRemoteTransferListInput{})
	if err != nil || page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("receipt history: %+v %v", page, err)
	}
}
