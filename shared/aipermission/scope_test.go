package aipermission

import (
	"reflect"
	"testing"

	"github.com/easyssh/shared/protocol"
)

func TestNormalizeScope(t *testing.T) {
	for _, tt := range []struct {
		name  string
		input []protocol.AISessionScope
		want  protocol.AISessionScope
	}{
		{name: "absent"},
		{name: "empty", input: []protocol.AISessionScope{{}}},
		{name: "unknown", input: []protocol.AISessionScope{{Kind: "global", Host: "host"}}},
		{name: "terminal without server", input: []protocol.AISessionScope{{Kind: " TERMINAL "}}, want: protocol.AISessionScope{Kind: "terminal"}},
		{name: "server implies terminal", input: []protocol.AISessionScope{{ServerID: " a "}}, want: protocol.AISessionScope{Kind: "terminal", ServerID: "a"}},
		{name: "terminal ID implies terminal", input: []protocol.AISessionScope{{Kind: "unknown", TerminalSessionID: " t "}}, want: protocol.AISessionScope{Kind: "terminal", TerminalSessionID: "t"}},
		{name: "trim all fields and use first", input: []protocol.AISessionScope{{Kind: " Terminal ", TerminalSessionID: " t ", ServerID: " a ", ServerName: " name ", Host: " host ", Username: " user ", Port: 22}, {ServerID: "ignored"}}, want: protocol.AISessionScope{Kind: "terminal", TerminalSessionID: "t", ServerID: "a", ServerName: "name", Host: "host", Username: "user", Port: 22}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := NormalizeScope(tt.input...); got != tt.want {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestNormalizeScopePointer(t *testing.T) {
	for _, tt := range []struct {
		name  string
		input *protocol.AISessionScope
		want  *protocol.AISessionScope
	}{
		{name: "nil"}, {name: "empty", input: &protocol.AISessionScope{}},
		{name: "inferred", input: &protocol.AISessionScope{ServerID: " a "}, want: &protocol.AISessionScope{Kind: "terminal", ServerID: "a"}},
		{name: "terminal", input: &protocol.AISessionScope{Kind: "terminal"}, want: &protocol.AISessionScope{Kind: "terminal"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var before protocol.AISessionScope
			if tt.input != nil {
				before = *tt.input
			}
			got := NormalizeScopePointer(tt.input)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			if tt.input != nil && *tt.input != before {
				t.Fatal("mutated input")
			}
			if got != nil && got == tt.input {
				t.Fatal("must return independent scope")
			}
		})
	}
}

func TestDecodeScope(t *testing.T) {
	for _, tt := range []struct {
		raw  string
		want *protocol.AISessionScope
	}{
		{"", nil}, {"{}", nil}, {"null", nil}, {"[]", nil}, {"invalid", nil},
		{`{"kind":"global"}`, nil},
		{`{"kind":" TERMINAL ","server_id":" a "}`, &protocol.AISessionScope{Kind: "terminal", ServerID: "a"}},
		{`{"server_id":"a"}`, &protocol.AISessionScope{Kind: "terminal", ServerID: "a"}},
		{`{"terminal_session_id":"t"}`, &protocol.AISessionScope{Kind: "terminal", TerminalSessionID: "t"}},
	} {
		t.Run(tt.raw, func(t *testing.T) {
			if got := DecodeScope(tt.raw); !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestScopeMatches(t *testing.T) {
	for _, tt := range []struct {
		name           string
		target, filter protocol.AISessionScope
		want           bool
	}{
		{name: "empty filter", target: protocol.AISessionScope{ServerID: "a"}, want: true},
		{name: "global cannot match terminal", filter: protocol.AISessionScope{Kind: "terminal"}},
		{name: "normalize both", target: protocol.AISessionScope{ServerID: " a "}, filter: protocol.AISessionScope{Kind: " TERMINAL ", ServerID: "a"}, want: true},
		{name: "different server", target: protocol.AISessionScope{ServerID: "a"}, filter: protocol.AISessionScope{ServerID: "b"}},
		{name: "different terminal", target: protocol.AISessionScope{TerminalSessionID: "t"}, filter: protocol.AISessionScope{TerminalSessionID: "other"}},
		{name: "matching terminal", target: protocol.AISessionScope{TerminalSessionID: "t", ServerID: "a"}, filter: protocol.AISessionScope{TerminalSessionID: "t"}, want: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := ScopeMatches(tt.target, tt.filter); got != tt.want {
				t.Fatalf("got %v", got)
			}
		})
	}
}

func TestSupportsMode(t *testing.T) {
	for _, tt := range []struct {
		name, mode string
		supported  []string
		want       bool
	}{
		{name: "unrestricted", mode: "custom", want: true},
		{name: "listed", mode: ModeReadonly, supported: []string{ModeReadonly, ModeBalanced}, want: true},
		{name: "excluded", mode: ModeReadonly, supported: []string{ModeBalanced}},
		{name: "do not broaden custom policy", mode: " READONLY ", supported: []string{ModeReadonly}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := SupportsMode(tt.mode, tt.supported); got != tt.want {
				t.Fatalf("got %v", got)
			}
		})
	}
}
