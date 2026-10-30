package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/syncdata"
	"github.com/google/uuid"
)

func desktopContentFiles(t *testing.T, db *sql.DB) []uuid.UUID {
	t.Helper()
	desktopInstanceFilesMu.RLock()
	defer desktopInstanceFilesMu.RUnlock()
	files, err := openDesktopContent(db)
	if err != nil {
		t.Fatal(err)
	}
	defer files.Close()
	var result []uuid.UUID
	if err := files.Scan(func(ids []uuid.UUID) error { result = append(result, ids...); return nil }); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestDesktopLargeAIItemsUseFilesAndUnchangedSaveReusesThem(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	large := strings.Repeat("large history ", 5000)
	record.Messages[0].Content = large
	record.Tasks = []DesktopAITaskView{{ID: "tool", ToolName: "create_artifact", Status: DesktopAITaskSucceeded,
		CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt, Artifact: &aiworkspace.FileArtifact{Content: large}}}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"desktop_ai_messages", "desktop_ai_session_tasks"} {
		var id sql.NullString
		var payload string
		column := "content_id"
		if table == "desktop_ai_session_tasks" {
			column = "artifact_content_id"
		}
		if err := ai.db.QueryRow("SELECT "+column+",payload FROM "+table+" WHERE session_id=?", record.ID).Scan(&id, &payload); err != nil || !id.Valid || strings.Contains(payload, large) {
			t.Fatal("large item retained in database", table, id, err)
		}
		if table == "desktop_ai_messages" && payload != "null" {
			t.Fatal("message retained body")
		}
	}
	before := desktopContentFiles(t, ai.db)
	if len(before) != 2 {
		t.Fatal("missing content files", before)
	}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if after := desktopContentFiles(t, ai.db); len(after) != len(before) {
		t.Fatal("identical save wrote new files", after)
	}
	loaded, err := ai.loadSession(record.ID)
	if err != nil || loaded.Messages[0].Content != large || loaded.Tasks[0].Artifact.Content != large {
		t.Fatal("file restoration failed", err)
	}
	history := readDesktopAIHistory(t, ai, record.ID)
	if len(history.Messages) != 1 || history.Messages[0].Content != large || history.Tasks[0].Artifact != nil {
		t.Fatal("public history lost content or exposed artifact")
	}
	record.Messages[0].Content, record.Tasks = "small", nil
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if err := cleanupDesktopContent(context.Background(), ai.db); err != nil {
		t.Fatal(err)
	}
	if files := desktopContentFiles(t, ai.db); len(files) != 0 {
		t.Fatal("unreferenced bodies retained", files)
	}
	var count int
	if err := ai.db.QueryRow(`SELECT COUNT(*) FROM desktop_content_objects`).Scan(&count); err != nil || count != 0 {
		t.Fatal("unreferenced metadata retained", count, err)
	}
	loaded, err = ai.loadSession(record.ID)
	if err != nil || loaded.Messages[0].Content != "small" {
		t.Fatal("inline replacement failed", err)
	}
}

func TestDesktopFailedAITransactionLeavesOnlyCollectableOrphan(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Messages[0].Content = strings.Repeat("large", 10000)
	record.Messages = append(record.Messages, record.Messages[0])
	if err := ai.saveSessionRaw(context.Background(), record); err == nil {
		t.Fatal("duplicate identity committed")
	}
	var count int
	if err := ai.db.QueryRow(`SELECT COUNT(*) FROM desktop_content_objects`).Scan(&count); err != nil || count != 0 {
		t.Fatal("file reference escaped rollback", count, err)
	}
	if len(desktopContentFiles(t, ai.db)) == 0 {
		t.Fatal("fixture did not leave an orphan")
	}
	loaded, err := ai.loadSession(record.ID)
	if err != nil || loaded.Messages[0].Content != "question" {
		t.Fatal("failed write replaced committed history", err)
	}
	if err := cleanupDesktopContent(context.Background(), ai.db); err != nil {
		t.Fatal(err)
	}
	if len(desktopContentFiles(t, ai.db)) != 0 {
		t.Fatal("orphan survived cleanup")
	}
}

func TestDesktopContentTransactionExcludesBackupAndCleanup(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	err := func() error {
		desktopInstanceFilesMu.RLock()
		defer desktopInstanceFilesMu.RUnlock()
		tx, err := ai.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err := putDesktopAIContent(context.Background(), tx, record.ID, []byte(`{"content":"uncommitted"}`)); err != nil {
			return err
		}
		if desktopInstanceFilesMu.TryLock() {
			desktopInstanceFilesMu.Unlock()
			t.Fatal("backup could enter an uncommitted content transaction")
		}
		// Must defer without querying a second DB connection while tx is open.
		return cleanupDesktopContent(context.Background(), ai.db)
	}()
	if err != nil {
		t.Fatal(err)
	}
	if len(desktopContentFiles(t, ai.db)) != 1 {
		t.Fatal("cleanup removed an active transaction's file")
	}
	if err := cleanupDesktopContent(context.Background(), ai.db); err != nil {
		t.Fatal(err)
	}
	if len(desktopContentFiles(t, ai.db)) != 0 {
		t.Fatal("rolled-back file retained")
	}
}

func TestDesktopContentReferencesCannotCrossConversations(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Messages[0].Content = strings.Repeat("private", 10000)
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if _, err := ai.db.Exec(`UPDATE desktop_content_objects SET source_id='another-session'`); err != nil {
		t.Fatal(err)
	}
	if _, err := ai.loadSession(record.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("foreign source accepted", err)
	}
	if _, err := ai.db.Exec(`UPDATE desktop_content_objects SET source_id=?,sha256=?`, record.ID, strings.Repeat("0", 64)); err != nil {
		t.Fatal(err)
	}
	if _, err := ai.loadSession(record.ID); !errors.Is(err, contentstore.ErrChanged) {
		t.Fatal("mismatched hash accepted", err)
	}
}

func TestDesktopSyncRestoresLargeItemsWithoutCopyingNativeAuthority(t *testing.T) {
	ai, record := desktopAIExecutionFixture(t)
	record.Messages[0].Content = strings.Repeat("message", 10000)
	record.Tasks[0].Status, record.Tasks[0].Result = DesktopAITaskSucceeded, strings.Repeat("result", 10000)
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	service := &DesktopSyncService{ai: ai}
	err := func() error {
		desktopInstanceFilesMu.RLock()
		defer desktopInstanceFilesMu.RUnlock()
		tx, err := ai.db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		payload, err := service.captureLocalVault(tx, DesktopVaultState{Kind: "ai_session", SpaceID: "local", LocalID: record.ID})
		if err != nil {
			return err
		}
		if err := service.applyLocalVault(tx, DesktopVaultState{Kind: "ai_session", SpaceID: "local", LocalID: "imported"}, syncdata.VaultPayload{Kind: "ai_session", Conversation: payload.Conversation}, "sync"); err != nil {
			return err
		}
		return tx.Commit()
	}()
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := ai.loadSession("imported")
	if err != nil || loaded.Messages[0].Content != record.Messages[0].Content || loaded.Tasks[0].Result != record.Tasks[0].Result || len(loaded.ExecutionOrigins) != 0 {
		t.Fatal("sync corrupted large history or native provenance", err)
	}
	var count int
	if err := ai.db.QueryRow(`SELECT COUNT(*) FROM desktop_ai_tool_executions`).Scan(&count); err != nil || count != 1 {
		t.Fatal("sync forged a local execution", count, err)
	}
}
