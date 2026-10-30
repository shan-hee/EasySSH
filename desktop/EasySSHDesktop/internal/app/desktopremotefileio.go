package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

type remoteTransferWriter struct {
	writer io.Writer
	task   *desktopRemoteTransfer
	touch  func()
}

func (w remoteTransferWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	if n > 0 {
		if saveErr := w.task.progress(int64(n)); saveErr != nil {
			return n, saveErr
		}
		w.touch()
	}
	return n, err
}

// File traffic has no 30-second JSON-request deadline. Bound a stalled stream
// instead, while workspace/session cancellation always remains authoritative.
func remoteTransferContext(parent context.Context) (context.Context, func(), func()) {
	ctx, cancel := context.WithCancelCause(parent)
	var last atomic.Int64
	started := time.Now()
	touch := func() { last.Store(time.Since(started).Nanoseconds()) }
	touch()
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if time.Since(started)-time.Duration(last.Load()) > time.Minute {
					cancel(remoteError("transfer_idle_timeout"))
					return
				}
			}
		}
	}()
	return ctx, touch, func() { cancel(context.Canceled); <-done }
}

func transferFailure(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return context.Cause(ctx)
	}
	var remote *desktopRemoteError
	if errors.As(err, &remote) {
		return remote
	}
	return remoteError("remote_transfer_failed")
}

func streamResponseError(response *http.Response) error {
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		return remoteError("remote_redirect_rejected")
	}
	if response.StatusCode != http.StatusOK {
		data, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
		if err != nil {
			return remoteError("remote_transfer_failed")
		}
		return remoteResponseError(data)
	}
	return nil
}

func (session *desktopRemoteSession) validUploadResult(task *desktopRemoteTransfer, source protocol.TransferJob) bool {
	info := task.snapshot()
	return source.ID != uuid.Nil && (info.SourceTaskID == "" || source.ID.String() == info.SourceTaskID) && session.validTaskActor(source.Actor) &&
		source.Kind == "sftp_upload" && source.Runner == "server" && source.TargetServerID != nil && source.TargetServerID.String() == task.connection.ServerID && source.SourceServerID == nil &&
		source.TargetPath == path.Clean(info.RemotePath) && source.BytesTotal == info.Total && source.BytesProcessed >= 0 && source.BytesProcessed <= source.BytesTotal && source.Status.Valid() && source.Stage.Valid()
}

func (session *desktopRemoteSession) readUploadOutcome(ctx context.Context, task *desktopRemoteTransfer) (bool, error) {
	info := task.snapshot()
	if !validRemoteUUID(info.SourceTaskID) {
		return false, remoteError("invalid_source_task")
	}
	var source protocol.TransferJob
	err := session.client.request(ctx, http.MethodGet, "/api/v1/transfer-jobs/"+info.SourceTaskID, nil, &source, true)
	if err != nil {
		if isRemoteAccessEnded(err) {
			session.cancel()
		}
		return false, err
	}
	if !session.validUploadResult(task, source) {
		return false, remoteError("invalid_remote_response")
	}
	status, code := "", ""
	switch source.Status {
	case "created", "staging", "queued", "running", "canceling":
		return false, nil
	case "completed":
		if source.BytesProcessed != source.BytesTotal {
			return false, remoteError("invalid_remote_response")
		}
		status = "succeeded"
	case "failed":
		status, code = "failed", "source_upload_failed"
	case "cancelled":
		status, code = "canceled", "source_upload_cancelled"
	case "unknown":
		status, code = "unknown", "upload_outcome_unknown"
	default:
		return false, remoteError("invalid_remote_response")
	}
	task.mu.Lock()
	defer task.mu.Unlock()
	if task.info.FinishedAt != nil && task.info.Status != "unknown" {
		return true, nil
	}
	now := time.Now().UTC()
	task.info.Status, task.info.Error, task.info.Transferred, task.info.UpdatedAt, task.info.FinishedAt = status, code, max(task.info.Transferred, source.BytesProcessed), now, &now
	return true, task.persistLocked()
}

func (session *desktopRemoteSession) refreshUploadResult(ctx context.Context, task *desktopRemoteTransfer) error {
	_, err := session.readUploadOutcome(ctx, task)
	return err
}

func (session *desktopRemoteSession) runFileUpload(task *desktopRemoteTransfer, selection *desktopRemoteFileSelection) {
	info := task.snapshot()
	var source protocol.TransferJob
	err := session.client.request(task.ctx, http.MethodPost, "/api/v1/transfer-jobs/sftp/upload", protocol.TransferUploadInput{
		ServerID: task.connection.ServerID, TargetPath: path.Dir(info.RemotePath), FileName: path.Base(info.RemotePath), FileSize: &info.Total,
	}, &source, true)
	if err != nil {
		if task.ctx.Err() != nil {
			task.finish("canceled", "transfer_cancelled")
		} else {
			task.finish("failed", err.Error())
		}
		return
	}
	if !session.validUploadResult(task, source) || source.Status != "created" || source.Stage != "awaiting_input" || source.BytesProcessed != 0 {
		task.finish("failed", "invalid_remote_response")
		return
	}
	task.mu.Lock()
	task.info.SourceTaskID = source.ID.String()
	task.info.UpdatedAt = time.Now().UTC()
	err = task.persistLocked()
	task.mu.Unlock()
	if err != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = session.cancelSourceTransfer(cleanup, source.ID.String())
		task.finish("unknown", "transfer_persistence_failed")
		return
	}
	err = session.uploadFileBody(task, selection)
	if err == nil {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			var resolved bool
			resolved, err = session.readUploadOutcome(task.ctx, task)
			if resolved && err == nil {
				return
			}
			if err != nil {
				break
			}
			select {
			case <-task.ctx.Done():
				err = task.ctx.Err()
			case <-ticker.C:
			}
			if err != nil {
				break
			}
		}
	}
	if isRemoteAccessEnded(err) {
		session.cancel()
	}
	// A lost upload response is not proof of failure. Cancel the known task on
	// interruption, then only read its outcome; never resend the file body.
	cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if task.ctx.Err() != nil {
		_ = session.cancelSourceTransfer(cleanup, source.ID.String())
	}
	if resolved, _ := session.readUploadOutcome(cleanup, task); resolved {
		return
	}
	task.finish("unknown", "upload_outcome_unknown")
}

func (session *desktopRemoteSession) uploadFileBody(task *desktopRemoteTransfer, selection *desktopRemoteFileSelection) error {
	ctx, touch, stop := remoteTransferContext(task.ctx)
	defer stop()
	reader, writer := io.Pipe()
	producer := make(chan struct{})
	var producerErr error
	go func() {
		defer func() { _ = writer.CloseWithError(producerErr); close(producer) }()
		if !sameDesktopUploadFile(selection.file, selection.snapshot) {
			producerErr = remoteError("local_file_changed")
			return
		}
		_, producerErr = io.CopyN(remoteTransferWriter{writer, task, touch}, io.NewSectionReader(selection.file, 0, selection.info.Size), selection.info.Size)
		if producerErr != nil {
			return
		}
		if !sameDesktopUploadFile(selection.file, selection.snapshot) {
			producerErr = remoteError("local_file_changed")
			return
		}
	}()
	defer func() { _ = reader.CloseWithError(context.Canceled); <-producer }()
	info := task.snapshot()
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, session.client.origin+"/api/v1/transfer-jobs/"+info.SourceTaskID+"/input", reader)
	if err != nil {
		return remoteError("invalid_request")
	}
	req.Header.Set("Authorization", "Access "+session.client.token)
	req.Header.Set("X-EasySSH-Access-Session", session.client.sessionID)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Accept", "application/json")
	response, err := session.client.fileHTTP.Do(req)
	if err != nil {
		return transferFailure(ctx, err)
	}
	defer response.Body.Close()
	if err = streamResponseError(response); err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil {
		return transferFailure(ctx, err)
	}
	if len(data) > 65536 {
		return remoteError("invalid_remote_response")
	}
	var result protocol.TransferJob
	if json.Unmarshal(data, &result) != nil || !session.validUploadResult(task, result) || result.Status == "created" || result.Status == "staging" {
		return remoteError("invalid_remote_response")
	}
	// A peer responding early must not claim bytes the producer never sent.
	_ = reader.CloseWithError(io.ErrClosedPipe)
	<-producer
	if producerErr != nil {
		return transferFailure(ctx, producerErr)
	}
	return nil
}

func (session *desktopRemoteSession) downloadTicket(ctx context.Context, task *desktopRemoteTransfer) (string, error) {
	var result protocol.AccessTicket
	info := task.snapshot()
	if !validRemoteUUID(info.SourceTaskID) {
		return "", remoteError("invalid_source_task")
	}
	err := session.client.request(ctx, http.MethodPost, "/api/v1/access/tickets", protocol.AccessTicketInput{
		Type: "transfer_artifact", TaskID: info.SourceTaskID,
	}, &result, true)
	if err != nil {
		return "", err
	}
	decoded, err := base64.RawURLEncoding.DecodeString(result.Ticket)
	if err != nil || len(decoded) != 32 || result.ExpiresIn < 1 || result.ExpiresIn > 60 {
		return "", remoteError("invalid_remote_response")
	}
	return result.Ticket, nil
}

func (session *desktopRemoteSession) runFileDownload(task *desktopRemoteTransfer, save *desktopFileSave) {
	err := session.downloadFileBody(task, save)
	if err == nil {
		task.finish("succeeded", "")
		return
	}
	if isRemoteAccessEnded(err) {
		session.cancel()
	}
	if task.ctx.Err() != nil {
		task.finish("canceled", "transfer_cancelled")
		return
	}
	var remote *desktopRemoteError
	code := "download_failed"
	if errors.As(err, &remote) {
		code = remote.code
	}
	if code == "download_outcome_unknown" {
		task.finish("unknown", code)
	} else if code == "transfer_cancelled" {
		task.finish("canceled", code)
	} else {
		task.finish("failed", code)
	}
}

func (session *desktopRemoteSession) downloadFileBody(task *desktopRemoteTransfer, save *desktopFileSave) (resultErr error) {
	source, err := session.prepareFileDownload(task)
	if err != nil {
		return err
	}
	ticket, err := session.downloadTicket(task.ctx, task)
	if err != nil {
		return err
	}
	ctx, touch, stop := remoteTransferContext(task.ctx)
	defer stop()
	endpoint := session.client.origin + "/api/v1/transfer-jobs/" + source.ID.String() + "/artifact?" + url.Values{"ticket": {ticket}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return remoteError("invalid_request")
	}
	// A one-use ticket is the only credential on this request. Never accept
	// source Content-Disposition as a native path, and never decompress bytes.
	req.Header.Set("Accept-Encoding", "identity")
	response, err := session.client.fileHTTP.Do(req)
	if err != nil {
		return transferFailure(ctx, err)
	}
	defer response.Body.Close()
	if err = streamResponseError(response); err != nil {
		return err
	}
	encoding := response.Header.Get("Content-Encoding")
	if response.ContentLength != source.ArtifactSize || (encoding != "" && !strings.EqualFold(encoding, "identity")) {
		return remoteError("invalid_remote_response")
	}
	task.mu.Lock()
	task.info.Total = response.ContentLength
	task.info.UpdatedAt = time.Now().UTC()
	err = task.persistLocked()
	task.mu.Unlock()
	if err != nil {
		return err
	}
	touch()
	temporary := ".easyssh-download-" + uuid.NewString()
	file, err := save.root.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return remoteError("local_destination_unavailable")
	}
	defer func() {
		_ = file.Close()
		if err := save.root.Remove(temporary); err != nil && !errors.Is(err, os.ErrNotExist) {
			resultErr = remoteError("local_cleanup_failed")
		}
	}()
	if _, err = io.CopyN(remoteTransferWriter{file, task, touch}, response.Body, response.ContentLength); err != nil {
		return transferFailure(ctx, err)
	}
	var extra [1]byte
	if n, err := response.Body.Read(extra[:]); n != 0 || err != io.EOF {
		return remoteError("incomplete_download")
	}
	if ctx.Err() != nil {
		return context.Cause(ctx)
	}
	if err = file.Sync(); err != nil {
		return remoteError("local_write_failed")
	}
	if err = file.Close(); err != nil {
		return remoteError("local_write_failed")
	}
	if err = save.commit(ctx, temporary); err != nil {
		return err
	}
	return nil
}
