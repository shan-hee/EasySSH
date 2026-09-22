package main

import (
	"testing"

	"github.com/easyssh/shared/aichatui"
)

func TestDesktopAIRejectsTargetsOutsideCurrentMessage(t *testing.T) {
	record := desktopAISessionRecord{Messages: []DesktopAIMessageView{
		{Role: "user", ServerReferences: []aichatui.ServerReference{{ServerID: "old"}}},
		{Role: "user", ServerReferences: []aichatui.ServerReference{{ServerID: "a"}, {ServerID: "b"}}},
	}}
	spec := desktopAIToolSpec{Parameters: map[string]interface{}{"properties": map[string]interface{}{"server_id": map[string]interface{}{"type": "string"}}}}
	for _, id := range []string{"a", "b", "c", "old", ""} {
		err := desktopAIValidateServerReference(record, spec, map[string]any{"server_id": id})
		allowed := id == "a" || id == "b"
		if (err == "") != allowed {
			t.Fatalf("unexpected validation for %q: %s", id, err)
		}
	}
}
