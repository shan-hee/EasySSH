package content

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/taskprotocol"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func readTaskBody(t *testing.T, s *Service, ctx context.Context, descriptor protocol.TaskContent) protocol.TaskBody {
	t.Helper()
	if err := taskprotocol.ValidateContent(descriptor); err != nil {
		t.Fatal(err)
	}
	raw := descriptor.Data
	if descriptor.Content != nil {
		ref := *descriptor.Content
		input := protocol.ContentReadInput{Sha256: ref.Sha256, Limit: 4093}
		for {
			chunk, err := s.Read(ctx, ref.ID, input)
			if err != nil {
				t.Fatal(err)
			}
			if err := contentstore.ValidateChunk(ref, input, chunk); err != nil {
				t.Fatal(err)
			}
			part, err := base64.StdEncoding.DecodeString(chunk.Data)
			if err != nil {
				t.Fatal(err)
			}
			raw = append(raw, part...)
			if chunk.NextOffset == chunk.Size {
				break
			}
			input.Offset = chunk.NextOffset
		}
	}
	var body protocol.TaskBody
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestTaskBodyWriteRestoreReplacementAndScope(t *testing.T) {
	bodies, db, _, actor, authority := contentFixture(t)
	ctx := contentContext(t, actor, authority)
	repo := taskcenter.NewRepository(db, bodies)
	input := strings.Repeat("input 界<&", 10000)
	run := taskcenter.TaskRun{Actor: actor, TaskType: "sftp_upload", SourceType: "transfer_job", Title: strings.Repeat("title", 300), PayloadJSON: input}
	if err := repo.CreateWithEvent(ctx, &run, &taskcenter.TaskEvent{Level: "info", Message: "queued"}); err != nil {
		t.Fatal(err)
	}
	detail, err := repo.Details(ctx, run.ID)
	if err != nil || detail.Content.Content == nil || detail.Run.Title != run.Title || len(detail.Run.TruncatedFields) != 0 {
		t.Fatal("missing persisted detail", err)
	}
	ref := *detail.Content.Content
	var stored taskcenter.TaskRun
	if err := db.First(&stored, "id=?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.PayloadJSON != "" || stored.Description != "" || stored.ResultJSON != "" || stored.ProgressJSON != "" {
		t.Fatal("duplicate body in task row")
	}
	if body := readTaskBody(t, bodies, ctx, detail.Content); body.TaskRunID != run.ID || body.PayloadJSON != input {
		t.Fatal("body changed")
	}
	restored, err := repo.GetAny(ctx, run.ID)
	if err != nil || restored.PayloadJSON != input {
		t.Fatal("executor cannot restore body", err)
	}
	changed, err := repo.UpdateIfStatus(ctx, run.ID, []taskcenter.Status{taskcenter.StatusQueued}, map[string]interface{}{"status": taskcenter.StatusRunning, "progress": 20})
	if err != nil || !changed {
		t.Fatal("start failed", err)
	}
	detail, err = repo.Details(ctx, run.ID)
	if err != nil || detail.Content.Content == nil || *detail.Content.Content != ref {
		t.Fatal("metadata update rewrote body", err)
	}
	changed, err = repo.UpdateIfStatus(ctx, run.ID, []taskcenter.Status{taskcenter.StatusRunning}, map[string]interface{}{"result_json": strings.Repeat("output", 10000)})
	if err != nil || !changed {
		t.Fatal(err)
	}
	if _, err := bodies.Reference(ctx, ref.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("old body readable", err)
	}
	detail, err = repo.Details(ctx, run.ID)
	if err != nil || detail.Content.Content == nil {
		t.Fatal(err)
	}
	other := actor
	other.ID = uuid.NewString()
	other.SessionID = other.ID
	foreign := contentContext(t, other, &contentAuthority{})
	if _, err := repo.Details(foreign, run.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("foreign task visible", err)
	}
	if _, err := bodies.Reference(foreign, detail.Content.Content.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign body readable", err)
	}
	if err := db.Delete(&taskcenter.TaskRun{}, "id=?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := bodies.Reference(ctx, detail.Content.Content.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted task readable", err)
	}
	if err := bodies.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&Record{}).Where("source_type='task_body'").Count(&count).Error; err != nil || count != 0 {
		t.Fatal("unused bodies retained", count, err)
	}
}

func TestTaskBodyOuterTransactionRollbackAndBackupBoundary(t *testing.T) {
	bodies, db, _, actor, authority := contentFixture(t)
	ctx := contentContext(t, actor, authority)
	run := taskcenter.TaskRun{Actor: actor, TaskType: "sftp_upload", SourceType: "transfer_job", Title: "rollback", PayloadJSON: strings.Repeat("input", 10000)}
	aborted := errors.New("outer transaction failed")
	err := taskcenter.Transaction(ctx, db, bodies, func(tx *gorm.DB) error {
		if err := taskcenter.NewTransactionRepository(tx, bodies).CreateWithEvent(ctx, &run, &taskcenter.TaskEvent{Level: "info", Message: "queued"}); err != nil {
			return err
		}
		if err := bodies.SnapshotStorage(func() error { return nil }); err == nil {
			t.Fatal("backup entered uncommitted outer transaction")
		}
		return aborted
	})
	if !errors.Is(err, aborted) {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&taskcenter.TaskRun{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("task escaped rollback", count, err)
	}
	if err := db.Model(&Record{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("body metadata escaped rollback", count, err)
	}
	// Reusing the caller's run must not try to insert the rolled-back content FK.
	if err := taskcenter.NewRepository(db, bodies).CreateWithEvent(ctx, &run, &taskcenter.TaskEvent{Level: "info", Message: "queued"}); err != nil {
		t.Fatal("retry retained uncommitted reference", err)
	}
	if err := bodies.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestTaskDetailsDoNotReadOrRecreateBodyFiles(t *testing.T) {
	bodies, db, _, actor, authority := contentFixture(t)
	ctx := contentContext(t, actor, authority)
	repo := taskcenter.NewRepository(db, bodies)
	run := taskcenter.TaskRun{Actor: actor, TaskType: "sftp_upload", SourceType: "transfer_job", Title: "missing file", PayloadJSON: strings.Repeat("input", 10000)}
	if err := repo.CreateWithEvent(ctx, &run, &taskcenter.TaskEvent{Level: "info", Message: "queued"}); err != nil {
		t.Fatal(err)
	}
	detail, err := repo.Details(ctx, run.ID)
	if err != nil || detail.Content.Content == nil {
		t.Fatal(err)
	}
	ref := *detail.Content.Content
	if err := bodies.files.Remove(ref.ID); err != nil {
		t.Fatal(err)
	}
	detail, err = repo.Details(ctx, run.ID)
	if err != nil || detail.Content.Content == nil || *detail.Content.Content != ref {
		t.Fatal("detail tried to restore file", err)
	}
	if _, err := repo.GetAny(ctx, run.ID); err == nil {
		t.Fatal("executor accepted a missing body")
	}
	if _, err := bodies.Read(ctx, ref.ID, protocol.ContentReadInput{Sha256: ref.Sha256}); err == nil {
		t.Fatal("GET regenerated the missing file")
	}
}
