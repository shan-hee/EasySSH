package taskprotocol

import (
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/contentstore"
	"github.com/easyssh/shared/protocol"
	"strings"
	"unicode/utf8"
)

const MaxEventPageBytes = 512 << 10
const MaxInlineEventBytes = MaxInlineContentBytes

var ErrEventQuery = errors.New("invalid task event query")

func NormalizeEventInput(input protocol.TaskEventInput) (protocol.TaskEventInput, error) {
	if input.Limit == 0 {
		input.Limit = DefaultEventLimit
	}
	if input.Limit < 1 || input.Limit > MaxEventLimit || uint64(input.AfterID) > 1<<63-1 {
		return input, ErrEventQuery
	}
	return input, nil
}

func ValidEventRunID(id string) bool {
	if id == "" || len(id) > 256 || !utf8.ValidString(id) {
		return false
	}
	for _, r := range id {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}
func validEventIdentity(event protocol.TaskEvent, runID string) bool {
	return ValidEventRunID(runID) && event.TaskRunID == runID && event.ID > 0 && uint64(event.ID) <= 1<<63-1 && !event.CreatedAt.IsZero() && len(event.Level) > 0 && len(event.Level) <= 20 && utf8.ValidString(event.Level) && !strings.ContainsAny(event.Level, "\x00\r\n")
}

// The reader consumes at most limit+1 rows, one at a time. A row that does not
// fit is not included in NextAfterID and will be read again on the next page.
func BuildEventPage(runID string, input protocol.TaskEventInput, read func() (protocol.TaskEvent, bool, error)) (*protocol.TaskEventPage, error) {
	input, err := NormalizeEventInput(input)
	if err != nil || !ValidEventRunID(runID) {
		return nil, ErrEventQuery
	}
	page := &protocol.TaskEventPage{TaskRunID: runID, Events: []protocol.TaskEvent{}, NextAfterID: input.AfterID}
	used := 4096
	for {
		event, ok, err := read()
		if err != nil {
			return nil, err
		}
		if !ok {
			return page, nil
		}
		if !validEventIdentity(event, runID) || event.ID <= page.NextAfterID {
			return nil, ErrEventQuery
		}
		if len(page.Events) == input.Limit {
			page.HasMore = true
			return page, nil
		}
		raw, err := json.Marshal(event)
		if err != nil {
			return nil, err
		}
		if len(raw) > MaxInlineEventBytes || event.Content != nil && !validEventContent(event) {
			return nil, ErrEventQuery
		}
		if used+len(raw)+1 > MaxEventPageBytes {
			page.HasMore = true
			return page, nil
		}
		page.Events = append(page.Events, event)
		page.NextAfterID = event.ID
		used += len(raw) + 1
	}
}

func ValidateEventPage(runID string, input protocol.TaskEventInput, page protocol.TaskEventPage) error {
	input, err := NormalizeEventInput(input)
	if err != nil || !ValidEventRunID(runID) || page.TaskRunID != runID || len(page.Events) > input.Limit || page.HasMore && len(page.Events) == 0 {
		return ErrEventQuery
	}
	previous := input.AfterID
	for _, event := range page.Events {
		if !validEventIdentity(event, runID) || event.ID <= previous {
			return ErrEventQuery
		}
		raw, err := json.Marshal(event)
		if err != nil || len(raw) > MaxInlineEventBytes {
			return ErrEventQuery
		}
		if event.Content != nil && (!validEventContent(event)) {
			return ErrEventQuery
		}
		previous = event.ID
	}
	if page.NextAfterID != previous {
		return ErrEventQuery
	}
	raw, err := json.Marshal(page)
	if err != nil || len(raw) > MaxEventPageBytes {
		return ErrEventQuery
	}
	return nil
}

func validEventContent(event protocol.TaskEvent) bool {
	return event.Content != nil && contentstore.ValidateReference(*event.Content) == nil && event.Content.MediaType == "application/json" && event.Content.Size > MaxInlineEventBytes && event.Message == "" && event.DataJSON == ""
}
