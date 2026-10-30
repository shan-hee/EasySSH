package app

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/easyssh/shared/aiworkspace"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
)

func TestDesktopArtifactReferenceRestoresSnapshotAndUsesGenericReads(t *testing.T) {
	ai, record := desktopAISnapshotFixture(t)
	file, err := aiworkspace.PrepareWrite("server", "/tmp/report.txt", strings.Repeat("<>&\n", 10000), strings.Repeat("汉字", 20000), true)
	if err != nil {
		t.Fatal(err)
	}
	record.Tasks = []DesktopAITaskView{{ID: "file", ToolName: "write_file", Status: DesktopAITaskSucceeded,
		CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt, File: &file.FileSummary, Artifact: file}}
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	var privateID sql.NullString
	var payload string
	if err := ai.db.QueryRow(`SELECT content_id,payload FROM desktop_ai_session_tasks WHERE session_id=?`, record.ID).Scan(&privateID, &payload); err != nil {
		t.Fatal(err)
	}
	if privateID.Valid || strings.Contains(payload, `"artifact"`) {
		t.Fatal("artifact still embedded in private task")
	}
	ref, err := ai.GetTaskFile(record.ID, "file")
	if err != nil {
		t.Fatal(err)
	}
	service := &DesktopContentService{database: ai.database}
	var raw []byte
	for int64(len(raw)) < ref.Size {
		input := protocol.ContentReadInput{Sha256: ref.Sha256, Offset: int64(len(raw)), Limit: 65537}
		chunk, err := service.ReadContent(context.Background(), ref.ID.String(), input)
		if err != nil {
			t.Fatal(err)
		}
		if err := contentstore.ValidateChunk(ref, input, chunk); err != nil {
			t.Fatal(err)
		}
		data, err := base64.StdEncoding.DecodeString(chunk.Data)
		if err != nil || len(data) == 0 {
			t.Fatal("invalid content bytes", err)
		}
		raw = append(raw, data...)
	}
	if aiworkspace.Hash(string(raw)) != ref.Sha256 {
		t.Fatal("mixed artifact versions")
	}
	var restored aiworkspace.FileArtifact
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(file, &restored) {
		t.Fatal("file or baseline changed")
	}
	loaded, err := ai.taskFile(record.ID, "file")
	if err != nil || !reflect.DeepEqual(loaded, file) {
		t.Fatal("native execution snapshot not restored", err)
	}
	record.Tasks[0].Summary = "updated summary"
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	same, err := ai.GetTaskFile(record.ID, "file")
	if err != nil || same != ref {
		t.Fatal("unchanged artifact was rewritten", same, err)
	}
	record.Tasks[0].Artifact = nil
	if err := ai.saveSessionRaw(context.Background(), record); err != nil {
		t.Fatal(err)
	}
	if _, err := ai.GetTaskFile(record.ID, "file"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("removed artifact remained discoverable", err)
	}
	if _, err := service.GetContent(context.Background(), ref.ID.String()); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal("removed reference remained readable", err)
	}
	if err := cleanupDesktopContent(context.Background(), ai.db); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := ai.db.QueryRow(`SELECT COUNT(*) FROM desktop_content_objects WHERE id=?`, ref.ID.String()).Scan(&count); err != nil || count != 0 {
		t.Fatal("detached artifact retained", count, err)
	}
}
