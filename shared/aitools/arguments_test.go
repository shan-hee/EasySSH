package aitools

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestDecodeArguments(t *testing.T) {
	for _, tt := range []struct {
		raw  string
		want map[string]any
	}{
		{"", map[string]any{}}, {"null", map[string]any{}}, {"{}", map[string]any{}},
		{`{"server_id":"a","n":1}`, map[string]any{"server_id": "a", "n": float64(1)}},
		{"invalid", map[string]any{"_raw": "invalid"}}, {"[]", map[string]any{"_raw": "[]"}},
		{`{"command":`, map[string]any{"_raw": `{"command":`}},
	} {
		t.Run(tt.raw, func(t *testing.T) {
			got := DecodeArguments(json.RawMessage(tt.raw))
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %#v, want %#v", got, tt.want)
			}
			got["writable"] = true
		})
	}
}

func TestSummarizeTask(t *testing.T) {
	for _, tt := range []struct {
		name string
		args map[string]any
		want string
	}{
		{name: "nil", want: "tool"}, {name: "unrecognized", args: map[string]any{"other": "x"}, want: "tool"},
		{name: "priority", args: map[string]any{"command": "pwd", "path": "/", "server_id": "a"}, want: "pwd"},
		{name: "path", args: map[string]any{"path": "/tmp", "server_id": "a"}, want: "/tmp"},
		{name: "server", args: map[string]any{"server_id": "a"}, want: "a"},
		{name: "non string", args: map[string]any{"command": 12}, want: "12"},
		{name: "boundary", args: map[string]any{"command": strings.Repeat("a", 48)}, want: strings.Repeat("a", 48)},
		{name: "ascii truncate", args: map[string]any{"command": strings.Repeat("a", 49)}, want: strings.Repeat("a", 48) + "..."},
		{name: "unicode truncate", args: map[string]any{"command": strings.Repeat("界🙂", 25)}, want: strings.Repeat("界🙂", 24) + "..."},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := SummarizeTask("tool", tt.args)
			if got != tt.want || !utf8.ValidString(got) {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}
