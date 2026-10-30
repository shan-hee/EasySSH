package taskprotocol

import (
	"github.com/easyssh/shared/protocol"
	"github.com/google/uuid"
	"strings"
	"testing"
	"time"
)

func eventSliceReader(events []protocol.TaskEvent) func() (protocol.TaskEvent, bool, error) {
	index := 0
	return func() (protocol.TaskEvent, bool, error) {
		if index == len(events) {
			return protocol.TaskEvent{}, false, nil
		}
		event := events[index]
		index++
		return event, true, nil
	}
}
func TestEventPageByteBudgetDoesNotConsumeTheNextEvent(t *testing.T) {
	events := make([]protocol.TaskEvent, 60)
	for i := range events {
		events[i] = protocol.TaskEvent{ID: uint(i + 1), TaskRunID: "run", Level: "info", Message: strings.Repeat("界<&", 2000), CreatedAt: time.Now()}
	}
	input := protocol.TaskEventInput{Limit: 100}
	seen, pages := 0, 0
	for {
		page, err := BuildEventPage("run", input, eventSliceReader(events[seen:]))
		if err != nil {
			t.Fatal(err)
		}
		if err := ValidateEventPage("run", input, *page); err != nil {
			t.Fatal(err)
		}
		for _, event := range page.Events {
			seen++
			if event.ID != uint(seen) || event.Content != nil {
				t.Fatal("unseen event consumed by byte budget")
			}
		}
		pages++
		if !page.HasMore {
			break
		}
		input.AfterID = page.NextAfterID
	}
	if pages < 2 || seen != len(events) {
		t.Fatalf("incomplete traversal: %d pages %d events", pages, seen)
	}
}
func TestLargeEventRequiresStoredReference(t *testing.T) {
	event := protocol.TaskEvent{ID: 7, TaskRunID: "run", Level: "info", CreatedAt: time.Now(), Message: strings.Repeat("output", 10000)}
	if _, err := BuildEventPage("run", protocol.TaskEventInput{}, eventSliceReader([]protocol.TaskEvent{event})); err == nil {
		t.Fatal("invented a reference for an unpersisted body")
	}
	event.Message = ""
	event.Content = &protocol.ContentReference{ID: uuid.New(), Size: 60000, Sha256: strings.Repeat("a", 64), MediaType: "application/json"}
	page, err := BuildEventPage("run", protocol.TaskEventInput{}, eventSliceReader([]protocol.TaskEvent{event}))
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateEventPage("run", protocol.TaskEventInput{}, *page); err != nil {
		t.Fatal(err)
	}
	page.Events[0].DataJSON = "must not be both inline and referenced"
	if ValidateEventPage("run", protocol.TaskEventInput{}, *page) == nil {
		t.Fatal("accepted ambiguous body")
	}
}
func TestEventQueriesRejectWrongParentAndFalseCursor(t *testing.T) {
	event := protocol.TaskEvent{ID: 2, TaskRunID: "run", Level: "info", Message: "event", CreatedAt: time.Now()}
	if _, err := BuildEventPage("other", protocol.TaskEventInput{}, eventSliceReader([]protocol.TaskEvent{event})); err == nil {
		t.Fatal("cross-task event accepted")
	}
	if _, err := BuildEventPage("run", protocol.TaskEventInput{AfterID: 2}, eventSliceReader([]protocol.TaskEvent{event})); err == nil {
		t.Fatal("non-advancing ID accepted")
	}
	page, err := BuildEventPage("run", protocol.TaskEventInput{AfterID: 2}, eventSliceReader(nil))
	if err != nil || page.NextAfterID != 2 || page.HasMore {
		t.Fatal("bad empty page", err)
	}
	page.HasMore = true
	if err := ValidateEventPage("run", protocol.TaskEventInput{AfterID: 2}, *page); err == nil {
		t.Fatal("empty advancing page accepted")
	}
	for _, input := range []protocol.TaskEventInput{{Limit: -1}, {Limit: 101}} {
		if _, err := NormalizeEventInput(input); err == nil {
			t.Fatal("invalid limit accepted")
		}
	}
}
