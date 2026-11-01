package content

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/easyssh/server/internal/domain/taskcenter"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"github.com/easyssh/shared/taskprotocol"
	"github.com/google/uuid"
)

func TestTaskEventBodyFollowsParentVisibilityAndReferenceLifetime(t *testing.T) {
	bodies, db, _, actor, authority := contentFixture(t)
	ctx := contentContext(t, actor, authority)
	repo := taskcenter.NewRepository(db, bodies)
	run := taskcenter.TaskRun{Actor: actor, TaskType: "command", Title: "observed command"}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	text := strings.Repeat("observed 界<&", 10000)
	event := taskcenter.TaskEvent{TaskRunID: run.ID, Level: "info", Message: text}
	if err := repo.AppendEvent(ctx, &event); err != nil {
		t.Fatal(err)
	}
	page, err := repo.ListEvents(ctx, run.ID, protocol.TaskEventInput{})
	if err != nil || len(page.Events) != 1 || page.Events[0].Content == nil {
		t.Fatal("missing body reference", err)
	}
	if err := taskprotocol.ValidateEventPage(run.ID.String(), protocol.TaskEventInput{}, *page); err != nil {
		t.Fatal(err)
	}
	var stored taskcenter.TaskEvent
	if err := db.First(&stored, "id=?", event.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Message != "" || stored.DataJSON != "" {
		t.Fatal("large body still stored inline")
	}
	ref := *page.Events[0].Content
	input := protocol.ContentReadInput{Sha256: ref.Sha256, Limit: 4093}
	var raw []byte
	for {
		chunk, err := bodies.Read(ctx, ref.ID, input)
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
	var decoded protocol.TaskEvent
	if err := json.Unmarshal(raw, &decoded); err != nil || decoded.ID != event.ID || decoded.TaskRunID != run.ID.String() || decoded.Message != text {
		t.Fatal("event body changed", err)
	}
	other := actor
	other.ID = uuid.NewString()
	other.SessionID = other.ID
	if _, err := bodies.Reference(contentContext(t, other, authority), ref.ID); err == nil {
		t.Fatal("other visitor read the event")
	}
	authority.revoked = true
	if _, err := bodies.Read(ctx, ref.ID, input); err == nil {
		t.Fatal("revoked visitor read the event")
	}
	authority.revoked = false
	if err := db.Delete(&taskcenter.TaskEvent{}, "id=?", event.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := bodies.Reference(ctx, ref.ID); err == nil {
		t.Fatal("deleted event reference remained readable")
	}
	if err := bodies.Cleanup(context.Background()); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&Record{}).Where("id=?", ref.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatal("orphan retained", err)
	}
}
