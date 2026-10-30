package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func remoteTransferFixture(t *testing.T, kind string, total int64) (*desktopRemoteSession, *desktopRemoteTransfer) {
	t.Helper()
	session, connection := remoteFileFixture(t, func(*http.Request) (*http.Response, error) { t.Fatal("unexpected JSON request"); return nil, nil })
	session.client.grantID = "33333333-3333-4333-8333-333333333333"
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "transfers.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := configureDesktopDatabase(db); err != nil {
		t.Fatal(err)
	}
	session.workspace = DesktopRemoteWorkspace{ID: "44444444-4444-4444-8444-444444444444", Origin: session.client.origin, GrantID: session.client.grantID}
	if _, err := db.Exec(`INSERT INTO desktop_remote_workspaces(id,origin,grant_id,name,expires_at,last_opened_at) VALUES(?,?,?,?,?,?)`, session.workspace.ID, session.client.origin, session.client.grantID, "source", time.Now().Add(time.Hour).Format(time.RFC3339Nano), time.Now().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	session.transferStore = &desktopRemoteTransferStore{db: db, workspaceID: session.workspace.ID, origin: session.client.origin, actor: protocol.Actor{Kind: protocol.Visitor, ID: session.client.sessionID, SessionID: session.client.sessionID, GrantID: session.client.grantID}}
	session.resourcesMu.Lock()
	task, err := session.newFileTransferLocked(connection, kind, "file", "/remote/file ", total)
	session.resourcesMu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { task.cancel(); session.opening.Done() })
	return session, task
}

func remoteDownloadFixtureJob(session *desktopRemoteSession, task *desktopRemoteTransfer, size int64) protocol.TransferJob {
	now := time.Now().UTC()
	expiry := now.Add(time.Hour)
	serverID := uuid.MustParse(task.connection.ServerID)
	return protocol.TransferJob{ID: uuid.New(), Actor: remoteActivityActor(session), Kind: "sftp_download", Runner: "server", Status: "completed", Stage: "ready_for_download", SourceServerID: &serverID, SourcePath: task.snapshot().RemotePath, ArtifactName: "file", ArtifactSize: size, ArtifactManaged: true, BytesTotal: size, BytesProcessed: size, Progress: 100, CreatedAt: now, UpdatedAt: now, FinishedAt: &now, ArtifactExpiresAt: &expiry}
}

func remoteUploadFixtureJob(session *desktopRemoteSession, task *desktopRemoteTransfer) protocol.TransferJob {
	target := uuid.MustParse(task.connection.ServerID)
	info := task.snapshot()
	return protocol.TransferJob{ID: uuid.MustParse(info.SourceTaskID), Actor: remoteActivityActor(session), Kind: "sftp_upload", Runner: "server", Status: "completed", Stage: "transfer_to_remote", TargetServerID: &target, TargetPath: info.RemotePath, BytesTotal: info.Total, BytesProcessed: info.Total}
}

func installDownloadFixture(t *testing.T, session *desktopRemoteSession, task *desktopRemoteTransfer, body string, length int64) {
	t.Helper()
	ticket := strings.Repeat("A", 43)
	source := remoteDownloadFixtureJob(session, task, length)
	session.client.http.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/api/v1/transfer-jobs/sftp/download":
			var input protocol.TransferDownloadInput
			if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&input) != nil || input.SourcePath != task.snapshot().RemotePath || input.ServerID != task.connection.ServerID {
				t.Fatal("download source lost exact resource/path binding")
			}
			return remoteTaskResponse(t, r, source), nil
		case "/api/v1/access/tickets":
			var input protocol.AccessTicketInput
			if json.NewDecoder(r.Body).Decode(&input) != nil || input.Type != "transfer_artifact" || input.TaskID != source.ID.String() || input.ConnectionID != "" {
				t.Fatal("artifact ticket lost task binding")
			}
			return remoteTaskResponse(t, r, protocol.AccessTicket{Ticket: ticket, ExpiresIn: 30}), nil
		default:
			t.Fatal("unexpected download JSON request", r.Method, r.URL.Path)
			return nil, nil
		}
	})
	session.client.fileHTTP = &http.Client{Transport: remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/v1/transfer-jobs/"+source.ID.String()+"/artifact" || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("X-EasySSH-Access-Session") != "" || r.Header.Get("Accept-Encoding") != "identity" || len(r.URL.Query()) != 1 || r.URL.Query().Get("ticket") != ticket {
			t.Fatal("download exposed reusable credentials")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Disposition": []string{`attachment; filename="../../outside"`}}, ContentLength: length, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
}

func TestRemoteDownloadCommitsOnlyCompleteSelectedTarget(t *testing.T) {
	for _, complete := range []bool{false, true} {
		t.Run(fmt.Sprint(complete), func(t *testing.T) {
			session, task := remoteTransferFixture(t, "download", -1)
			directory := t.TempDir()
			destination := filepath.Join(directory, "chosen")
			if err := os.WriteFile(destination, []byte("original"), 0600); err != nil {
				t.Fatal(err)
			}
			save, err := prepareDesktopFileSave(destination)
			if err != nil {
				t.Fatal(err)
			}
			defer save.root.Close()
			length := int64(3)
			if !complete {
				length = 10
			}
			installDownloadFixture(t, session, task, "new", length)
			err = session.downloadFileBody(task, save)
			data, readErr := os.ReadFile(destination)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if complete && (err != nil || string(data) != "new") {
				t.Fatalf("complete download not committed: %q %v", data, err)
			}
			if !complete && (err == nil || string(data) != "original") {
				t.Fatalf("partial download replaced target: %q %v", data, err)
			}
			entries, err := os.ReadDir(directory)
			if err != nil || len(entries) != 1 {
				t.Fatalf("temporary files leaked: %v %v", entries, err)
			}
		})
	}
}

func TestRemoteDownloadRejectsTargetChangedAfterSaveSelection(t *testing.T) {
	session, task := remoteTransferFixture(t, "download", -1)
	destination := filepath.Join(t.TempDir(), "chosen")
	if err := os.WriteFile(destination, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	save, err := prepareDesktopFileSave(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer save.root.Close()
	if err := os.WriteFile(destination, []byte("new user content"), 0600); err != nil {
		t.Fatal(err)
	}
	installDownloadFixture(t, session, task, "download", 8)
	if err := session.downloadFileBody(task, save); err == nil || err.Error() != "local_destination_changed" {
		t.Fatalf("changed destination accepted: %v", err)
	}
	data, _ := os.ReadFile(destination)
	if string(data) != "new user content" {
		t.Fatal("concurrent edit overwritten")
	}
}

func TestRemoteLargeUploadUsesBoundRawStream(t *testing.T) {
	data := bytes.Repeat([]byte("large-file"), 700000)
	session, task := remoteTransferFixture(t, "upload", int64(len(data)))
	task.info.SourceTaskID = "44444444-4444-4444-8444-444444444444"
	local := filepath.Join(t.TempDir(), "selected")
	if err := os.WriteFile(local, data, 0600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(local)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	selection := &desktopRemoteFileSelection{file: file, snapshot: stat, info: DesktopRemoteFileSelection{Size: stat.Size()}}
	calls := 0
	session.client.fileHTTP = &http.Client{Transport: remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodPut || r.URL.Path != "/api/v1/transfer-jobs/"+task.info.SourceTaskID+"/input" || len(r.URL.Query()) != 0 || r.Header.Get("X-EasySSH-Connection") != "" || r.Header.Get("Authorization") != "Access source-access-secret" || r.Header.Get("Content-Type") != "application/octet-stream" {
			t.Fatal("upload scope changed")
		}
		got, err := io.ReadAll(r.Body)
		if err != nil || !bytes.Equal(got, data) {
			t.Fatal("streamed file changed")
		}
		source := remoteUploadFixtureJob(session, task)
		source.Status = "queued"
		source.BytesProcessed = 0
		payload, _ := json.Marshal(source)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(payload)), Request: r}, nil
	})}
	if err := session.uploadFileBody(task, selection); err != nil || calls != 1 || task.snapshot().Transferred != int64(len(data)) {
		t.Fatalf("stream upload: %v (%d calls)", err, calls)
	}
}

func TestUploadOutcomeRequiresExactActorAndDoesNotReplayBody(t *testing.T) {
	session, task := remoteTransferFixture(t, "upload", 3)
	task.info.SourceTaskID = "44444444-4444-4444-8444-444444444444"
	task.finish("unknown", "upload_outcome_unknown")
	actor := protocol.Actor{Kind: protocol.Visitor, ID: session.client.sessionID, SessionID: session.client.sessionID, GrantID: session.client.grantID}
	source := remoteUploadFixtureJob(session, task)
	calls := 0
	session.client.http.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodGet {
			t.Fatal("outcome query replayed upload")
		}
		payload, _ := json.Marshal(source)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(payload)), Request: r}, nil
	})
	source.Actor.GrantID = "different-grant"
	if err := session.refreshUploadResult(context.Background(), task); err == nil || task.snapshot().Status != "unknown" {
		t.Fatal("accepted another grant's outcome")
	}
	source.Actor = actor
	if err := session.refreshUploadResult(context.Background(), task); err != nil || task.snapshot().Status != "succeeded" || calls != 2 {
		t.Fatalf("outcome did not reconcile: %v", err)
	}
}

func TestConnectionCloseCancelsTransfersAndClosesSelectedHandles(t *testing.T) {
	session, task := remoteTransferFixture(t, "upload", 0)
	file, err := os.CreateTemp(t.TempDir(), "selected")
	if err != nil {
		t.Fatal(err)
	}
	session.selections = map[string]*desktopRemoteFileSelection{"selection": {file: file, connectionID: task.connection.ID, info: DesktopRemoteFileSelection{ExpiresAt: time.Now().Add(time.Minute)}}}
	session.dropConnection(task.connection.ID)
	if task.ctx.Err() == nil || task.snapshot().Status != "canceling" || len(session.selections) != 0 {
		t.Fatal("connection close left live file authority")
	}
	if _, err := file.Stat(); err == nil {
		t.Fatal("selected file handle was not closed")
	}
}

func TestQueuedUploadDoesNotReportRemoteSuccess(t *testing.T) {
	session, task := remoteTransferFixture(t, "upload", 3)
	task.info.SourceTaskID = "44444444-4444-4444-8444-444444444444"
	source := remoteUploadFixtureJob(session, task)
	source.Status = "queued"
	source.BytesProcessed = 0
	session.client.http.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodGet {
			t.Fatal("polling replayed input")
		}
		body, _ := json.Marshal(source)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body)), Request: r}, nil
	})
	if done, err := session.readUploadOutcome(context.Background(), task); err != nil || done || task.snapshot().FinishedAt != nil || task.snapshot().Status == "succeeded" {
		t.Fatalf("queued input reported as completed: done=%v err=%v task=%+v", done, err, task.snapshot())
	}
}
