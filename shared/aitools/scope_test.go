package aitools

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/easyssh/shared/aiprovider"
	"github.com/easyssh/shared/protocol"
)

func serverParameters() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{"server_id": map[string]any{"type": "string", "description": "original"}, "path": map[string]any{"type": "string"}}, "required": []string{"server_id"}}
}

func TestHasServerIDParameter(t *testing.T) {
	for _, tt := range []struct {
		name       string
		parameters map[string]any
		want       bool
	}{
		{name: "nil"}, {name: "no properties", parameters: map[string]any{}},
		{name: "invalid properties", parameters: map[string]any{"properties": "invalid"}},
		{name: "no server", parameters: map[string]any{"properties": map[string]any{"path": nil}}},
		{name: "server", parameters: serverParameters(), want: true},
		{name: "key with nil schema", parameters: map[string]any{"properties": map[string]any{"server_id": nil}}, want: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := HasServerIDParameter(tt.parameters); got != tt.want {
				t.Fatalf("got %v", got)
			}
		})
	}
}

func TestPinServerIDParameter(t *testing.T) {
	for _, tt := range []struct {
		name       string
		parameters map[string]any
		pin        bool
	}{
		{name: "nil"}, {name: "invalid properties", parameters: map[string]any{"properties": "invalid"}},
		{name: "server", parameters: serverParameters(), pin: true},
		{name: "nil field schema", parameters: map[string]any{"properties": map[string]any{"server_id": nil}}, pin: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			before, _ := json.Marshal(tt.parameters)
			got := PinServerIDParameter(tt.parameters, "a")
			if tt.pin {
				properties := got["properties"].(map[string]any)
				field := properties["server_id"].(map[string]any)
				if field["const"] != "a" || field["default"] != "a" {
					t.Fatalf("not pinned: %#v", field)
				}
				if strings.Contains(field["description"].(string), "除非") {
					t.Fatal("prompt must not suggest bypassing scope")
				}
				field["type"] = "changed"
				properties["extra"] = true
			}
			got["extra"] = true
			after, _ := json.Marshal(tt.parameters)
			if string(before) != string(after) {
				t.Fatal("mutated shared schema")
			}
		})
	}
}

func TestShallowCopyMap(t *testing.T) {
	for _, input := range []map[string]any{nil, {}, {"key": "value"}} {
		got := shallowCopyMap(input)
		if len(got) != len(input) {
			t.Fatal("lost entries")
		}
		for k, v := range input {
			if got[k] != v {
				t.Fatal("changed value")
			}
		}
		got["new"] = true
		if _, ok := input["new"]; ok {
			t.Fatal("mutated original")
		}
	}
}

func TestScopedParameters(t *testing.T) {
	for _, tt := range []struct {
		name, tool      string
		scope           *protocol.AISessionScope
		parameters      map[string]any
		visible, pinned bool
	}{
		{name: "global list", tool: "list_servers", visible: true},
		{name: "unresolved terminal", tool: "list_servers", scope: &protocol.AISessionScope{Kind: "terminal"}, visible: true},
		{name: "hide list", tool: "list_servers", scope: &protocol.AISessionScope{ServerID: "a"}},
		{name: "pin server", tool: "read_file", scope: &protocol.AISessionScope{ServerID: " a "}, parameters: serverParameters(), visible: true, pinned: true},
		{name: "local tool", tool: "create_artifact", scope: &protocol.AISessionScope{ServerID: "a"}, parameters: map[string]any{}, visible: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, visible := ScopedParameters(tt.scope, tt.tool, tt.parameters)
			if visible != tt.visible {
				t.Fatalf("visible %v", visible)
			}
			if tt.pinned && got["properties"].(map[string]any)["server_id"].(map[string]any)["const"] != "a" {
				t.Fatal("missing scope constraint")
			}
		})
	}
}

func TestScopeToolCall(t *testing.T) {
	for _, tt := range []struct {
		name, raw, want string
		scope           *protocol.AISessionScope
		parameters      map[string]any
	}{
		{name: "global unchanged", raw: `{"server_id":"b"}`, want: `{"server_id":"b"}`},
		{name: "terminal without target", raw: `{"server_id":"b"}`, want: `{"server_id":"b"}`, scope: &protocol.AISessionScope{Kind: "terminal"}},
		{name: "overwrite", raw: `{"server_id":"b","command":"pwd"}`, want: `{"command":"pwd","server_id":"a"}`, scope: &protocol.AISessionScope{ServerID: " a "}},
		{name: "wrong type", raw: `{"server_id":12}`, want: `{"server_id":"a"}`, scope: &protocol.AISessionScope{ServerID: "a"}},
		{name: "no target argument local tool", raw: `{"name":"x"}`, want: `{"name":"x"}`, scope: &protocol.AISessionScope{ServerID: "a"}},
		{name: "missing target remote tool", raw: `{}`, want: `{"server_id":"a"}`, scope: &protocol.AISessionScope{ServerID: "a"}, parameters: serverParameters()},
		{name: "null remote arguments", raw: `null`, want: `{"server_id":"a"}`, scope: &protocol.AISessionScope{ServerID: "a"}, parameters: serverParameters()},
		{name: "malformed remote arguments", raw: `invalid`, want: `invalid`, scope: &protocol.AISessionScope{ServerID: "a"}, parameters: serverParameters()},
		{name: "array remote arguments", raw: `[]`, want: `[]`, scope: &protocol.AISessionScope{ServerID: "a"}, parameters: serverParameters()},
		{name: "empty remote arguments", scope: &protocol.AISessionScope{ServerID: "a"}, parameters: serverParameters()},
		{name: "malformed remains inspectable", raw: `invalid`, want: `invalid`, scope: &protocol.AISessionScope{ServerID: "a"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			call := aiprovider.ToolCall{ID: "id", Name: "tool", Arguments: json.RawMessage(tt.raw)}
			got := ScopeToolCall(tt.scope, call, tt.parameters)
			if got.ID != call.ID || got.Name != call.Name || string(got.Arguments) != tt.want {
				t.Fatalf("got %+v (%s), want %s", got, got.Arguments, tt.want)
			}
			if string(call.Arguments) != tt.raw {
				t.Fatal("mutated input")
			}
		})
	}
}

func TestEnforceScopedArguments(t *testing.T) {
	for _, tt := range []struct {
		name                   string
		scope                  *protocol.AISessionScope
		parameters, args, want map[string]any
	}{
		{name: "global", parameters: serverParameters(), args: map[string]any{"server_id": "b"}, want: map[string]any{"server_id": "b"}},
		{name: "no target", scope: &protocol.AISessionScope{Kind: "terminal"}, parameters: serverParameters()},
		{name: "local tool", scope: &protocol.AISessionScope{ServerID: "a"}, args: map[string]any{"name": "x"}, want: map[string]any{"name": "x"}},
		{name: "insert", scope: &protocol.AISessionScope{ServerID: " a "}, parameters: serverParameters(), want: map[string]any{"server_id": "a"}},
		{name: "overwrite", scope: &protocol.AISessionScope{ServerID: "a"}, parameters: serverParameters(), args: map[string]any{"server_id": "b", "path": "/"}, want: map[string]any{"server_id": "a", "path": "/"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			before, _ := json.Marshal(tt.args)
			got := EnforceScopedArguments(tt.scope, tt.parameters, tt.args)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %#v, want %#v", got, tt.want)
			}
			after, _ := json.Marshal(tt.args)
			if string(before) != string(after) {
				t.Fatal("mutated original")
			}
		})
	}
}

func TestValidateServerReference(t *testing.T) {
	refs := []protocol.AIServerReference{{ServerID: "a"}, {ServerID: "b"}, {ServerID: "123"}}
	for _, tt := range []struct {
		name       string
		scope      *protocol.AISessionScope
		parameters map[string]any
		refs       []protocol.AIServerReference
		args       map[string]any
		errorText  string
	}{
		{name: "local tool", refs: refs},
		{name: "no references", parameters: serverParameters()},
		{name: "single reference bound by host", parameters: serverParameters(), refs: refs[:1]},
		{name: "first allowed", parameters: serverParameters(), refs: refs, args: map[string]any{"server_id": "a"}},
		{name: "second allowed", parameters: serverParameters(), refs: refs, args: map[string]any{"server_id": "b"}},
		{name: "trim", parameters: serverParameters(), refs: refs, args: map[string]any{"server_id": " a "}},
		{name: "missing", parameters: serverParameters(), refs: refs, errorText: "必须明确提供"},
		{name: "empty", parameters: serverParameters(), refs: refs, args: map[string]any{"server_id": " "}, errorText: "必须明确提供"},
		{name: "numeric cannot impersonate string", parameters: serverParameters(), refs: refs, args: map[string]any{"server_id": 123}, errorText: "必须明确提供"},
		{name: "null", parameters: serverParameters(), refs: refs, args: map[string]any{"server_id": nil}, errorText: "必须明确提供"},
		{name: "outside", parameters: serverParameters(), refs: refs, args: map[string]any{"server_id": "old"}, errorText: "不在本条消息引用"},
		{name: "scoping cannot bypass reference restriction", scope: &protocol.AISessionScope{ServerID: "outside"}, parameters: serverParameters(), refs: refs, args: map[string]any{"server_id": "a"}, errorText: "不在本条消息引用"},
		{name: "retain original rejection even if pin would fix", scope: &protocol.AISessionScope{ServerID: "a"}, parameters: serverParameters(), refs: refs, args: map[string]any{"server_id": "outside"}, errorText: "不在本条消息引用"},
		{name: "missing still rejected before approval", scope: &protocol.AISessionScope{ServerID: "a"}, parameters: serverParameters(), refs: refs, errorText: "必须明确提供"},
		{name: "both targets allowed", scope: &protocol.AISessionScope{ServerID: "b"}, parameters: serverParameters(), refs: refs, args: map[string]any{"server_id": "a"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := ValidateServerReference(tt.scope, tt.parameters, tt.refs, tt.args)
			if tt.errorText == "" && got != "" || tt.errorText != "" && !strings.Contains(got, tt.errorText) {
				t.Fatalf("got %q, want %q", got, tt.errorText)
			}
		})
	}
}
