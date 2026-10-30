package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"strings"
	"testing"

	"github.com/easyssh/shared/taskprotocol"
)

func TestDesktopTaskEventsPageIndependentlyOfDetailsAndReferenceLargeRows(t *testing.T) {
	s, id := desktopTaskFixture(t)
	ctx := context.Background()
	text := strings.Repeat("large observed result 界<&", 5000)
	if err := s.appendObservation(ctx, id, "info", text, ""); err != nil {
		t.Fatal(err)
	}
	content := &DesktopContentService{database: s.database}

	input := protocol.TaskEventInput{Limit: 1}
	count := 0
	for {
		page, err := s.ListEvents(ctx, id, input)
		if err != nil {
			t.Fatal(err)
		}
		if err := taskprotocol.ValidateEventPage(id, input, *page); err != nil {
			t.Fatal(err)
		}
		for _, event := range page.Events {
			count++
			if event.Content == nil {
				continue
			}
			query := protocol.ContentReadInput{Sha256: event.Content.Sha256, Limit: 4093}
			var raw []byte
			for {
				chunk, err := content.ReadContent(ctx, event.Content.ID.String(), query)
				if err != nil {
					t.Fatal(err)
				}
				if err := contentstore.ValidateChunk(*event.Content, query, chunk); err != nil {
					t.Fatal(err)
				}
				data, err := base64.StdEncoding.DecodeString(chunk.Data)
				if err != nil {
					t.Fatal(err)
				}
				raw = append(raw, data...)
				if chunk.NextOffset == chunk.Size {
					break
				}
				query.Offset = chunk.NextOffset
			}
			var restored protocol.TaskEvent
			if err := json.Unmarshal(raw, &restored); err != nil || restored.Message != text {
				t.Fatal("large event lost", err)
			}
			if _, err := s.db.Exec("DELETE FROM desktop_task_events WHERE id=?", event.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := content.ReadContent(ctx, event.Content.ID.String(), query); err == nil {
				t.Fatal("removed event retained read authority")
			}

		}
		if !page.HasMore {
			break
		}
		input.AfterID = page.NextAfterID
	}
	if count != 3 {
		t.Fatalf("expected create, start and diagnostic; got %d", count)
	}
	detail, err := s.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(detail)
	if err != nil || strings.Contains(string(raw), `"events"`) {
		t.Fatal("detail still loads event history", err)
	}
}
