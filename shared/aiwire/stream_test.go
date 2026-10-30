package aiwire

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/easyssh/shared/protocol"
)

func TestOutputDeltasAppendResetAndBoundUTF8(t *testing.T) {
	var restored string
	calls := 0
	emit := func(delta protocol.AITaskOutputDelta) error {
		t.Helper()
		if err := ValidateTaskOutputDelta("session", delta); err != nil {
			t.Fatal(err)
		}
		if delta.Reset {
			restored = ""
		}
		if delta.Offset != len(restored) {
			t.Fatal("output gap")
		}
		restored += delta.Text
		calls++
		return nil
	}
	previous := ""
	for _, current := range []string{strings.Repeat("界<&", 10000), strings.Repeat("界<&", 10000) + "end", "replacement", ""} {
		if err := OutputDeltas("session", "task", previous, current, emit); err != nil {
			t.Fatal(err)
		}
		if restored != current {
			t.Fatal("lost output")
		}
		before := calls
		if err := OutputDeltas("session", "task", current, current, emit); err != nil || calls != before {
			t.Fatal("repeated output", err)
		}
		previous = current
	}
	sentinel := errors.New("disconnected")
	if err := OutputDeltas("session", "task", "", "output", func(protocol.AITaskOutputDelta) error { return sentinel }); !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
}

func TestStreamMetadataRejectsWrongSessionAndOffsets(t *testing.T) {
	valid := protocol.AITaskOutputDelta{SessionID: "session", TaskID: "task", Offset: 0, NextOffset: 3, Text: "界", Reset: true}
	if err := ValidateTaskOutputDelta("session", valid); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*protocol.AITaskOutputDelta){
		func(d *protocol.AITaskOutputDelta) { d.SessionID = "other" },
		func(d *protocol.AITaskOutputDelta) { d.TaskID = "" },
		func(d *protocol.AITaskOutputDelta) { d.NextOffset = 1 },
		func(d *protocol.AITaskOutputDelta) { d.Offset = 1; d.NextOffset = 4 },
	} {
		invalid := valid
		change(&invalid)
		if ValidateTaskOutputDelta("session", invalid) == nil {
			t.Fatal("accepted invalid delta")
		}
	}
	if ValidateHistoryChange("session", protocol.AIHistoryChange{SessionID: "other", UpdatedAt: time.Now()}) == nil || ValidateHistoryChange("session", protocol.AIHistoryChange{SessionID: "session"}) == nil {
		t.Fatal("accepted invalid commit notification")
	}
}
