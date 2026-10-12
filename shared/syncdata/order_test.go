package syncdata

import (
	"reflect"
	"testing"
)

func TestServerOrderPreservesOtherSpaceSlots(t *testing.T) {
	got, err := ProjectServerSlots(
		[]string{"private", "local-a", "other-space", "local-b", "tail"},
		[]string{"remote-b", "remote-a"},
		map[string]string{"remote-a": "local-a", "remote-b": "local-b"},
	)
	want := []string{"private", "local-b", "other-space", "local-a", "tail"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("order=%v error=%v, want %v", got, err, want)
	}
	if _, err := ProjectServerSlots([]string{"local-a", "private"}, []string{"foreign"}, map[string]string{"remote-a": "local-a"}); err == nil {
		t.Fatal("accepted an ID outside this space")
	}
}

func TestServerOrderFiltersDeletionAndStabilizesConcurrentAdditions(t *testing.T) {
	a := "10000000-0000-4000-8000-000000000001"
	b := "20000000-0000-4000-8000-000000000002"
	c := "30000000-0000-4000-8000-000000000003"
	deleted := "40000000-0000-4000-8000-000000000004"
	snapshot := Snapshot{
		ServerOrderKey: {"ids": JSON([]string{deleted, c})},
		"server/" + b:  {}, "server/" + c: {}, "server/" + a: {},
	}
	got, err := OrderedServers(snapshot)
	if err != nil || !reflect.DeepEqual(got, []string{c, a, b}) {
		t.Fatalf("order=%v error=%v", got, err)
	}
	for _, invalid := range []string{"null", "{}", JSON([]string{a, a}), JSON([]string{"not-a-uuid"})} {
		if _, err := ParseServerOrder(invalid); err == nil {
			t.Fatalf("accepted invalid order %q", invalid)
		}
	}
}
