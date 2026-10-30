package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"

	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
)

func TestRemoteDownloadReusesPersistedSourceWithoutRecreating(t *testing.T) {
	session, task := remoteTransferFixture(t, "download", -1)
	source := remoteDownloadFixtureJob(session, task, 3)
	task.info.SourceTaskID = source.ID.String()
	calls := 0
	session.client.http.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/transfer-jobs/"+source.ID.String() {
			t.Fatal("persisted source was recreated", r.Method, r.URL.Path)
		}
		return remoteTaskResponse(t, r, source), nil
	})
	ready, err := session.prepareFileDownload(task)
	if err != nil || ready.ID != source.ID || calls != 1 {
		t.Fatal("source reuse failed", ready, err, calls)
	}
	stored, err := task.store.get(context.Background(), task.info.ID)
	if err != nil || stored.SourceTaskID != source.ID.String() || stored.Transferred != 0 {
		t.Fatal("source preparation was not linked or was counted as local delivery", stored, err)
	}
}

func TestRemoteDownloadRejectsForeignSourceMetadata(t *testing.T) {
	for _, alter := range []struct {
		name string
		fn   func(*protocol.TransferJob)
	}{
		{"actor", func(j *protocol.TransferJob) { j.Actor.SessionID = uuid.NewString() }},
		{"server", func(j *protocol.TransferJob) { id := uuid.New(); j.SourceServerID = &id }},
		{"path", func(j *protocol.TransferJob) { j.SourcePath = "/different/file" }},
		{"kind", func(j *protocol.TransferJob) { j.Kind = "sftp_upload" }},
	} {
		t.Run(alter.name, func(t *testing.T) {
			session, task := remoteTransferFixture(t, "download", -1)
			source := remoteDownloadFixtureJob(session, task, 3)
			alter.fn(&source)
			calls := 0
			session.client.http.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.Path != "/api/v1/transfer-jobs/sftp/download" {
					t.Fatal("foreign source was followed or cancelled", r.URL.Path)
				}
				return remoteTaskResponse(t, r, source), nil
			})
			if _, err := session.prepareFileDownload(task); err == nil || err.Error() != "invalid_remote_response" || calls != 1 {
				t.Fatal("foreign source accepted", err, calls)
			}
			if task.snapshot().SourceTaskID != "" {
				t.Fatal("foreign source persisted")
			}
		})
	}
}

func TestRemoteDownloadCancellationStopsKnownPreparation(t *testing.T) {
	session, task := remoteTransferFixture(t, "download", -1)
	source := remoteDownloadFixtureJob(session, task, 3)
	source.Status, source.Stage, source.FinishedAt = "queued", "download_from_remote", nil
	created, cancelled := 0, 0
	session.client.http.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		switch r.URL.Path {
		case "/api/v1/transfer-jobs/sftp/download":
			created++
			response := remoteTaskResponse(t, r, source)
			response.Body = cancelDownloadResponseBody{ReadCloser: response.Body, cancel: task.cancel}
			return response, nil
		case "/api/v1/transfer-jobs/" + source.ID.String() + "/cancel":
			cancelled++
			if r.Context().Err() != nil || r.Method != http.MethodPost {
				t.Fatal("cleanup reused cancelled request context")
			}
			return remoteTaskResponse(t, r, map[string]bool{"success": true}), nil
		default:
			t.Fatal("unexpected download request", r.URL.Path)
			return nil, nil
		}
	})
	if _, err := session.prepareFileDownload(task); !errors.Is(err, context.Canceled) || created != 1 || cancelled != 1 {
		t.Fatal("preparation cancellation lost source identity", err, created, cancelled)
	}
	if task.snapshot().SourceTaskID != source.ID.String() {
		t.Fatal("cancelled source was not linked")
	}
}

func TestRemoteDownloadPreservesUnknownSourceOutcome(t *testing.T) {
	session, task := remoteTransferFixture(t, "download", -1)
	source := remoteDownloadFixtureJob(session, task, 3)
	source.Status, source.Stage = "unknown", "download_from_remote"
	session.client.http.Transport = remoteRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/api/v1/transfer-jobs/sftp/download" {
			t.Fatal("unknown source triggered another operation", r.URL.Path)
		}
		return remoteTaskResponse(t, r, source), nil
	})
	// The source never becomes downloadable; no native destination is opened.
	session.runFileDownload(task, nil)
	if got := task.snapshot(); got.Status != "unknown" || got.Error != "download_outcome_unknown" || got.Transferred != 0 {
		t.Fatal("unknown source misreported", got)
	}
}

type cancelDownloadResponseBody struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (body cancelDownloadResponseBody) Close() error {
	err := body.ReadCloser.Close()
	body.cancel()
	return err
}
