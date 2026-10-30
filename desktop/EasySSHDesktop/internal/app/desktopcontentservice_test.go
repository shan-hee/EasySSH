package app

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/easyssh/shared/aiwire"
	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
)

func TestDesktopPublicAIContentExcludesPrivatePayloadAndFollowsCurrentReference(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Messages[0].Content = strings.Repeat("message", 10000)
	record.Tasks = []DesktopAITaskView{{ID: "tool", ToolName: "create_artifact", Status: DesktopAITaskSucceeded,
		CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt, Result: strings.Repeat("result", 10000),
		Artifact: &aiworkspace.FileArtifact{Content: "private artifact"}, Arguments: map[string]any{"content": "private artifact"}}}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	content := &DesktopContentService{database: ai.database}
	input := protocol.AIHistoryInput{Kind: "tasks"}
	page, err := ai.History(record.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := aiwire.ValidateHistoryPage(record.ID, input, page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Content == nil {
		t.Fatal("missing public content reference", page)
	}
	ref := *page.Items[0].Content
	got, err := content.GetContent(context.Background(), ref.ID.String())
	if err != nil || got != ref {
		t.Fatal("reference mismatch", got, err)
	}
	query := protocol.ContentReadInput{Sha256: ref.Sha256, Limit: contentstore.MaxReadBytes}
	chunk, err := content.ReadContent(context.Background(), ref.ID.String(), query)
	if err != nil {
		t.Fatal(err)
	}
	if err := contentstore.ValidateChunk(ref, query, chunk); err != nil {
		t.Fatal(err)
	}
	raw, err := base64.StdEncoding.DecodeString(chunk.Data)
	if err != nil || strings.Contains(string(raw), "private artifact") || strings.Contains(string(raw), `"execution"`) || !strings.Contains(string(raw), record.Tasks[0].Result) {
		t.Fatal("invalid public tool projection", err)
	}
	var privateID string
	if err := ai.db.QueryRow(`SELECT content_id FROM desktop_ai_session_tasks WHERE session_id=?`, record.ID).Scan(&privateID); err != nil {
		t.Fatal(err)
	}
	if _, err := content.GetContent(context.Background(), privateID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("private task exposed", err)
	}
	binding := reflect.TypeFor[DesktopContentService]().PkgPath() + ".DesktopContentService."
	if desktopRemoteBindingAllowed(binding+"GetContent") || desktopRemoteBindingAllowed(binding+"ReadContent") {
		t.Fatal("remote window can read local content")
	}
	record.Tasks[0].Result = "small"
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if _, err := content.GetContent(context.Background(), ref.ID.String()); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("replaced public version remained readable", err)
	}
	if err := cleanupDesktopContent(context.Background(), ai.db); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := ai.db.QueryRow(`SELECT COUNT(*) FROM desktop_content_objects WHERE id=?`, ref.ID.String()).Scan(&count); err != nil || count != 0 {
		t.Fatal("detached public body retained", count, err)
	}
}

func TestDesktopPersistedHistoryDoesNotReadLargeFiles(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	record.Messages[0].Content = strings.Repeat("message", 10000)
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	page, err := ai.History(record.ID, protocol.AIHistoryInput{Kind: "messages"})
	if err != nil || len(page.Items) != 1 || page.Items[0].Content == nil {
		t.Fatal("missing content reference", page, err)
	}
	ref := *page.Items[0].Content
	files, err := openDesktopContent(ai.db)
	if err != nil {
		t.Fatal(err)
	}
	if err := files.Remove(ref.ID); err != nil {
		t.Fatal(err)
	}
	if err := files.Close(); err != nil {
		t.Fatal(err)
	}
	// Missing body bytes must not cause the listing to restore an entire item.
	// Actual content reads still report the missing file as an error.
	page, err = ai.History(record.ID, protocol.AIHistoryInput{Kind: "messages"})
	if err != nil || page.Items[0].Content == nil || *page.Items[0].Content != ref {
		t.Fatal("history loaded body", page, err)
	}
	content := &DesktopContentService{database: ai.database}
	if _, err := content.ReadContent(context.Background(), ref.ID.String(), protocol.ContentReadInput{Sha256: ref.Sha256}); err == nil {
		t.Fatal("missing file returned as readable")
	}
}
