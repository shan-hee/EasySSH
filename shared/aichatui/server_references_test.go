package aichatui

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestServerReferencesResolveIdentityAndIgnoreClientSnapshot(t *testing.T) {
	servers := map[string]ServerReference{
		"a": {ServerID: "a", Name: "prod", Host: "first", Port: 22},
		"b": {ServerID: "b", Name: "prod", Host: "second", Port: 22},
	}
	calls := 0
	refs, err := ResolveServerReferences([]ServerReference{
		{ServerID: "a", Name: "forged", Host: "wrong"},
		{ServerID: "b"}, {ServerID: "a"},
	}, func(id string) (ServerReference, error) { calls++; return servers[id], nil })
	if err != nil || calls != 2 || !reflect.DeepEqual(refs, []ServerReference{servers["a"], servers["b"], servers["a"]}) {
		t.Fatalf("unexpected references: %+v, calls=%d, error=%v", refs, calls, err)
	}
	servers["a"] = ServerReference{ServerID: "a", Name: "renamed", Host: "first", Port: 22}
	refs, err = ResolveServerReferences(refs, func(id string) (ServerReference, error) { return servers[id], nil })
	if err != nil || refs[0].ServerID != "a" || refs[0].Name != "renamed" {
		t.Fatalf("rename lost identity: %+v, %v", refs, err)
	}
}

func TestServerReferencesRejectMissingOrInaccessibleTarget(t *testing.T) {
	for _, id := range []string{"", "deleted", "forbidden"} {
		refs, err := ResolveServerReferences([]ServerReference{{ServerID: id}}, func(string) (ServerReference, error) {
			return ServerReference{}, errors.New("unavailable")
		})
		if !errors.Is(err, ErrServerReferenceUnavailable) || refs != nil {
			t.Fatalf("invalid target was accepted: %q, %+v, %v", id, refs, err)
		}
	}
}

func TestServerReferencesSurviveMessagePersistenceAndUIConversion(t *testing.T) {
	message := MessageView{ID: "msg", Role: "user", Content: "检查磁盘", ServerReferences: []ServerReference{{ServerID: "a", Name: "prod [EU].1+"}}}
	data, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	var restored MessageView
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	ui, ok := Message(restored, false)
	if !ok || !reflect.DeepEqual(ui.Metadata["serverReferences"], message.ServerReferences) {
		t.Fatalf("UI lost references: %+v", ui)
	}
	content := ContentWithServerReferences(restored.Content, restored.ServerReferences)
	if !strings.Contains(content, `"server_id":"a"`) || restored.Content != "检查磁盘" {
		t.Fatalf("invalid provider content: %s", content)
	}
}

func TestRepeatedServerReferencesPreserveLabelsAndOffsets(t *testing.T) {
	input := []ServerReference{
		{ServerID: "a", Label: "prod", Offset: 0},
		{ServerID: "b", Label: "prod", Offset: 12},
		{ServerID: "a", Label: "prod", Offset: 24},
	}
	refs, err := ResolveServerReferences(input, func(id string) (ServerReference, error) {
		return ServerReference{ServerID: id, Name: "renamed", Host: "trusted"}, nil
	})
	if err != nil || len(refs) != 3 {
		t.Fatalf("lost an occurrence: %+v, %v", refs, err)
	}
	for i, ref := range refs {
		if ref.ServerID != input[i].ServerID || ref.Label != input[i].Label || ref.Offset != input[i].Offset || ref.Name != "renamed" {
			t.Fatalf("reference changed: %+v", ref)
		}
	}
	data, err := json.Marshal(refs[0])
	if err != nil || !strings.Contains(string(data), `"offset":0`) {
		t.Fatalf("first reference must retain offset zero: %s, %v", data, err)
	}
}
