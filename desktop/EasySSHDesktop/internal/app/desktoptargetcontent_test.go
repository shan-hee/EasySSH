package app

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/easyssh/shared/protocol"
)

func persistTargetFixture(s *DesktopTaskService, target desktopBatchTaskResult) error {
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := saveDesktopTaskTarget(tx, target); err != nil {
		return err
	}
	return tx.Commit()
}

func TestDesktopTargetOutputSharesActivityBodyAndRetention(t *testing.T) {
	tasks, id := desktopBatchCompletionFixture(t)
	now := desktopTaskNow()
	target := desktopBatchTaskResult{ID: "target", TaskID: id, ServerID: "11111111-1111-4111-8111-111111111111", ServerName: "observed server", Status: "failed", StartedAt: now, CompletedAt: now, Output: strings.Repeat("命令输出\n", 4000), ErrorMessage: "nonzero exit"}
	for range 2 {
		if err := persistTargetFixture(tasks, target); err != nil {
			t.Fatal(err)
		}
	}
	var inline, contentID string
	if err := tasks.db.QueryRow(`SELECT output,output_content_id FROM desktop_batch_task_results WHERE id=?`, target.ID).Scan(&inline, &contentID); err != nil || inline != "" || contentID == "" {
		t.Fatal("source retained duplicate output", inline, contentID, err)
	}
	item, err := scanDesktopActivity(tasks.db.QueryRow(desktopActivitySelectSQL+` WHERE source_table='desktop_batch_task_results' AND source_id=?`, target.ID))
	if err != nil || item.DetailContent == nil || item.DetailContent.ID.String() != contentID || item.Detail != "" || item.ErrorMessage != target.ErrorMessage {
		t.Fatal("activity lost output/error separation", item, err)
	}
	var count int
	if err := tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_content_objects WHERE source_type='task_target'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("retry created another body", count, err)
	}
	changed := target
	changed.Output += "changed"
	if err := persistTargetFixture(tasks, changed); err == nil {
		t.Fatal("immutable target changed")
	}
	summary, err := scanDesktopActivity(tasks.db.QueryRow(desktopActivitySummarySQL+` WHERE id=?`, item.ID))
	if err != nil || summary.Detail != "" || summary.DetailContent != nil || summary.ErrorMessage != target.ErrorMessage {
		t.Fatal("summary contains body or lost error", summary, err)
	}
	content := &DesktopContentService{database: func() (*sql.DB, error) { return tasks.db, nil }}
	ref := *item.DetailContent
	var raw []byte
	for offset := int64(0); offset < ref.Size; {
		chunk, err := content.ReadContent(context.Background(), contentID, protocol.ContentReadInput{Offset: offset, Limit: 4096, Sha256: ref.Sha256})
		if err != nil {
			t.Fatal(err)
		}
		part, err := base64.StdEncoding.DecodeString(chunk.Data)
		if err != nil {
			t.Fatal(err)
		}
		raw = append(raw, part...)
		offset = chunk.NextOffset
	}
	if string(raw) != target.Output {
		t.Fatal("output was truncated or incorrectly decoded")
	}
	if _, err := tasks.db.Exec(`DELETE FROM desktop_task_runs WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	if err := cleanupDesktopContent(context.Background(), tasks.db); err != nil {
		t.Fatal(err)
	}
	if _, err := content.GetContent(context.Background(), contentID); err != nil {
		t.Fatal("task cleanup removed activity output", err)
	}
	if _, err := tasks.db.Exec(`DELETE FROM activity_logs WHERE id=?`, item.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := content.GetContent(context.Background(), contentID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("removed activity retained read access", err)
	}
	if err := cleanupDesktopContent(context.Background(), tasks.db); err != nil {
		t.Fatal(err)
	}
	if err := tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_batch_task_results WHERE id=?`, target.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("orphaned target source retained", count, err)
	}
	if err := tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_content_objects WHERE id=?`, contentID).Scan(&count); err != nil || count != 0 {
		t.Fatal("orphaned output retained", count, err)
	}
}

func TestDesktopTargetBodyRollsBackWithActivity(t *testing.T) {
	tasks, id := desktopBatchCompletionFixture(t)
	now := desktopTaskNow()
	target := desktopBatchTaskResult{ID: "target", TaskID: id, ServerID: "11111111-1111-4111-8111-111111111111", ServerName: "observed server", Status: "success", StartedAt: now, CompletedAt: now, Output: strings.Repeat("observed", 5000)}
	if _, err := tasks.db.Exec(`CREATE TRIGGER reject_target_activity BEFORE INSERT ON activity_logs WHEN NEW.source_table='desktop_batch_task_results' BEGIN SELECT RAISE(ABORT,'unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if err := persistTargetFixture(tasks, target); err == nil {
		t.Fatal("accepted failed projection")
	}
	var count int
	if err := tasks.db.QueryRow(`SELECT COUNT(*) FROM desktop_content_objects WHERE source_type='task_target'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("body metadata escaped rollback", count, err)
	}
	if err := cleanupDesktopContent(context.Background(), tasks.db); err != nil {
		t.Fatal(err)
	}
	if _, err := tasks.db.Exec(`DROP TRIGGER reject_target_activity`); err != nil {
		t.Fatal(err)
	}
	if err := persistTargetFixture(tasks, target); err != nil {
		t.Fatal(err)
	}
}
