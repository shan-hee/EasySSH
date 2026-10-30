package aiwire

import (
	"github.com/easyssh/shared/protocol"
	"strings"
	"unicode/utf8"
)

const MaxStreamChunkBytes = 128 << 10
const MaxTextDeltaBytes = 8 << 10

// OutputDeltas sends bounded live progress. It does not create a readable body
// or promise durability; only a successful host commit sends AIHistoryChange.
func OutputDeltas(sessionID, taskID, previous, current string, emit func(protocol.AITaskOutputDelta) error) error {
	if previous == current {
		return nil
	}
	offset, reset := len(previous), false
	if previous == "" || !strings.HasPrefix(current, previous) {
		offset, reset = 0, true
	}
	remaining := current[offset:]
	for remaining != "" || reset {
		head, tail := NextTextChunk(remaining)
		delta := protocol.AITaskOutputDelta{SessionID: sessionID, TaskID: taskID, Offset: offset, NextOffset: offset + len(head), Text: head, Reset: reset}
		if err := emit(delta); err != nil {
			return err
		}
		offset, remaining, reset = delta.NextOffset, tail, false
	}
	return nil
}

func ValidateTaskOutputDelta(sessionID string, delta protocol.AITaskOutputDelta) error {
	if delta.SessionID != sessionID || !ValidHistoryID(delta.TaskID) || delta.Offset < 0 || delta.NextOffset < delta.Offset || delta.NextOffset-delta.Offset != len(delta.Text) || len(delta.Text) > MaxTextDeltaBytes || !utf8.ValidString(delta.Text) || delta.Reset && delta.Offset != 0 || delta.Text == "" && !delta.Reset {
		return ErrHistoryQuery
	}
	return nil
}

func ValidateHistoryChange(sessionID string, change protocol.AIHistoryChange) error {
	if change.SessionID != sessionID || change.UpdatedAt.IsZero() {
		return ErrHistoryQuery
	}
	return nil
}

// NextTextChunk reserves enough headroom for worst-case JSON escaping and
// never cuts a valid UTF-8 rune. It returns slices of the existing string.
func NextTextChunk(text string) (head, tail string) {
	end := min(len(text), MaxTextDeltaBytes)
	for end < len(text) && end > 0 && !utf8.RuneStart(text[end]) {
		end--
	}
	if end == 0 {
		end = min(len(text), MaxTextDeltaBytes)
	}
	return text[:end], text[end:]
}
