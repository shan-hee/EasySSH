package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/taskprotocol"
)

func readDesktopTaskBody(t *testing.T, s *DesktopTaskService, descriptor protocol.TaskContent) protocol.TaskBody {
	t.Helper()
	if err := taskprotocol.ValidateContent(descriptor); err != nil {
		t.Fatal(err)
	}
	raw := descriptor.Data
	if descriptor.Content != nil {
		ref := *descriptor.Content
		service := DesktopContentService{database: s.database}
		input := protocol.ContentReadInput{Sha256: ref.Sha256, Limit: 4093}
		for {
			chunk, err := service.ReadContent(context.Background(), ref.ID.String(), input)
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
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != descriptor.Hash || len(raw) != descriptor.Bytes {
		t.Fatal("mixed body versions")
	}
	var body protocol.TaskBody
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestDesktopTaskOverviewOmitsBodiesAndDetailsRestoreThem(t *testing.T) {
	s, id := desktopTaskFixture(t)
	result := strings.Repeat("result<&界", 10000)
	title := strings.Repeat("title", 300)
	if _, err := s.db.Exec("UPDATE desktop_task_runs SET title=? WHERE id=?", title, id); err != nil {
		t.Fatal(err)
	}
	if err := s.setPayload(id, map[string]string{"input": result}); err != nil {
		t.Fatal(err)
	}
	before, err := s.Get(id)
	if err != nil || before.Content.Content == nil {
		t.Fatal("missing persisted reference", err)
	}
	if err := s.updateProgress(id, 50, "progress", 100, 200, 0, 0); err != nil {
		t.Fatal(err)
	}
	after, err := s.Get(id)
	if err != nil || after.Content.Content == nil || *after.Content.Content != *before.Content.Content {
		t.Fatal("progress rewrote body", err)
	}
	if err := s.complete(id, "succeeded", result, "", "", 1, 0); err != nil {
		t.Fatal(err)
	}
	list, err := s.List(DesktopTaskListInput{})
	if err != nil || len(list.Runs) != 1 {
		t.Fatal("missing task", err)
	}
	raw, err := json.Marshal(list)
	if err != nil || strings.Contains(string(raw), "result_json") || strings.Contains(string(raw), "payload_json") || len(list.Runs[0].Title) > taskprotocol.MaxOverviewTextBytes || len(list.Runs[0].TruncatedFields) != 1 {
		t.Fatal("list leaked body or hid preview", err)
	}
	detail, err := s.Get(id)
	if err != nil || detail.Content.Content == nil || len(detail.Content.Data) != 0 || detail.Run.Title != title || len(detail.Run.TruncatedFields) != 0 {
		t.Fatal("invalid task detail", err)
	}
	body := readDesktopTaskBody(t, s, detail.Content)
	var payload map[string]string
	if err := json.Unmarshal([]byte(body.PayloadJSON), &payload); err != nil || payload["input"] != result || body.ResultJSON != result || body.TaskRunID.String() != id {
		t.Fatal("task body truncated", err)
	}
	run, err := s.getRun(id)
	if err != nil || run.ResultJSON != body.ResultJSON || run.PayloadJSON != body.PayloadJSON {
		t.Fatal("executor cannot restore body", err)
	}
	var activityID string
	if err := s.db.QueryRow(`SELECT id FROM activity_logs WHERE source_table='desktop_task_runs' AND source_id=?`, id).Scan(&activityID); err != nil {
		t.Fatal(err)
	}
	activity := &ActivityLogService{db: s.db}
	activityDetail, err := activity.GetById(activityID)
	if err != nil || activityDetail.TaskContent == nil || *activityDetail.TaskContent != *detail.Content.Content || activityDetail.Detail != "" {
		t.Fatal("activity duplicated or lost task body", err)
	}
	activityList, err := activity.List(DesktopActivityLogListParams{})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range activityList.Items {
		if item.Detail != "" || item.TaskContent != nil {
			t.Fatal("activity list included a detail body")
		}
	}
	var inlineBytes int
	if err := s.db.QueryRow(`SELECT length(description)+length(payload_json)+length(result_json)+length(progress_json) FROM desktop_task_runs WHERE id=?`, id).Scan(&inlineBytes); err != nil || inlineBytes != 0 {
		t.Fatal("duplicate body in database", inlineBytes, err)
	}
	content := DesktopContentService{database: s.database}
	if _, err := content.GetContent(context.Background(), before.Content.Content.ID.String()); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("replaced reference readable", err)
	}
	if _, err := s.db.Exec(`DELETE FROM desktop_task_runs WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	if err := cleanupDesktopContent(context.Background(), s.db); err != nil {
		t.Fatal(err)
	}
	readDesktopTaskBody(t, s, detail.Content)
	if _, err := content.GetContent(context.Background(), detail.Content.Content.ID.String()); err != nil {
		t.Fatal("task cleanup removed activity history", err)
	}
	if _, err := s.db.Exec(`DELETE FROM activity_logs WHERE source_table='desktop_task_runs' AND source_id=?`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := content.GetContent(context.Background(), detail.Content.Content.ID.String()); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("unreferenced task body readable", err)
	}
	if err := cleanupDesktopContent(context.Background(), s.db); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM desktop_content_objects WHERE source_type='task_run'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("orphan body retained", count, err)
	}
}

func TestDesktopTaskRecoveryPreservesExternalBody(t *testing.T) {
	s, id := desktopTaskFixture(t)
	if err := s.setPayload(id, strings.Repeat("input", 10000)); err != nil {
		t.Fatal(err)
	}
	before, err := s.Get(id)
	if err != nil || before.Content.Content == nil {
		t.Fatal(err)
	}
	if err := s.recoverInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, err := s.Get(id)
	if err != nil || after.Run.Status != "unknown" || after.Content.Content == nil || *after.Content.Content != *before.Content.Content {
		t.Fatal("recovery replaced body", err)
	}
	if _, err := s.getRun(id); err != nil {
		t.Fatal("recovery lost execution context", err)
	}
}

func TestDesktopTaskFailedCompletionKeepsPreviousBody(t *testing.T) {
	s, id := desktopTaskFixture(t)
	if err := s.setPayload(id, strings.Repeat("input", 10000)); err != nil {
		t.Fatal(err)
	}
	before, err := s.Get(id)
	if err != nil || before.Content.Content == nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`CREATE TRIGGER reject_task_body_completion BEFORE INSERT ON desktop_task_events WHEN NEW.message='任务执行完成' BEGIN SELECT RAISE(ABORT,'event unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.persistCompletion(context.Background(), id, desktopTaskCompletion{Status: "succeeded", ResultJSON: strings.Repeat("output", 10000), FinishedAt: desktopTaskNow()}); err == nil {
		t.Fatal("completion should fail")
	}
	after, err := s.Get(id)
	if err != nil || after.Run.Status != "running" || after.Content.Content == nil || *after.Content.Content != *before.Content.Content {
		t.Fatal("failed completion replaced body", err)
	}
	if err := cleanupDesktopContent(context.Background(), s.db); err != nil {
		t.Fatal(err)
	}
	readDesktopTaskBody(t, s, after.Content)
}
