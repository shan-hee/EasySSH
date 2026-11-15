package app

import (
	"github.com/easyssh/shared/aitools"
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
		err := aitools.ValidateServerReference(desktopAISharedScope(record.Scope), spec.Parameters, aichatui.LatestServerReferences(toAichatUIMessages(record.Messages)), map[string]any{"server_id": id})
		allowed := id == "a" || id == "b"
		if (err == "") != allowed {
			t.Fatalf("unexpected validation for %q: %s", id, err)
		}
	}
}

func TestDesktopAIScopeAdapters(t *testing.T) {
	for _, tt := range []struct {
		name  string
		scope *DesktopAISessionScope
	}{
		{name: "nil"},
		{name: "empty", scope: &DesktopAISessionScope{}},
		{name: "all fields without normalization", scope: &DesktopAISessionScope{Kind: " TERMINAL ", TerminalSessionID: "terminal", ServerID: "server", ServerName: "name", Host: "host", Port: 22, Username: "user"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			shared := desktopAISharedScope(tt.scope)
			roundtrip := desktopAIScopeFromShared(shared)
			if tt.scope == nil {
				if shared != nil || roundtrip != nil {
					t.Fatal("nil must stay nil")
				}
				return
			}
			if roundtrip == nil || *roundtrip != *tt.scope {
				t.Fatalf("scope fields changed: %+v", roundtrip)
			}
			if shared.Kind != tt.scope.Kind || shared.TerminalSessionID != tt.scope.TerminalSessionID || shared.ServerID != tt.scope.ServerID || shared.ServerName != tt.scope.ServerName || shared.Host != tt.scope.Host || shared.Port != tt.scope.Port || shared.Username != tt.scope.Username {
				t.Fatalf("incorrect protocol mapping: %+v", shared)
			}
			shared.ServerID = "changed"
			if tt.scope.ServerID == "changed" || roundtrip.ServerID == "changed" {
				t.Fatal("adapter aliased input")
			}
		})
	}
}
